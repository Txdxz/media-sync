/**
 * endpoint-db.js — 以"udpxy 端点"为单位的源库（复刻 cqshushu 的源粒度）
 * cqshushu 的每个"源"= 一个 IP:port 的 udpxy 网关 + 它承载的一组频道。
 * 这里从各省公开 m3u 中抽出所有 http-udpxy 端点，每个端点聚成一个源，
 * 并记录它来自哪个省、承载多少频道、是否跨网可直连。
 */
const fs = require('fs');
const path = require('path');
const { request } = require('./http');
const { parseChannelList } = require('./channels');
const { GOOGLE_PROVINCE_REPOS, rawUrl } = require('./province-sources');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data/endpoint_db.json');

const ISP_RANGES = {
  // 仅粗判（不精确），用于给端点打运营商标签
  '电信': [[1.180, 1.255], [14.16, 14.63], [27.184, 27.191], [36.96, 36.127], [59.32, 59.63], [106.80, 106.127], [110.176, 110.191], [113.64, 113.127], [119.32, 119.63], [121.8, 121.63], [125.64, 125.127], [171.8, 171.15], [180.96, 180.127], [182.80, 182.127], [183.0, 183.63], [202.96, 202.127], [218.0, 218.127], [219.128, 219.255], [220.160, 220.191], [222.240, 222.255]],
  '联通': [[14.128, 14.255], [27.128, 27.183], [36.128, 36.255], [58.240, 58.255], [60.0, 60.255], [61.128, 61.191], [110.240, 110.255], [112.0, 112.127], [113.128, 113.255], [116.0, 116.255], [117.32, 117.127], [119.0, 119.31], [120.0, 120.63], [121.192, 121.255], [122.0, 122.127], [123.0, 123.127], [124.64, 124.127], [125.32, 125.63], [171.208, 171.255], [175.0, 175.63], [182.128, 182.255], [183.192, 183.255], [202.96, 202.127], [210.12, 210.63], [211.136, 211.191], [218.64, 218.95], [221.192, 221.255]],
  '移动': [[27.192, 27.255], [36.0, 36.31], [39.128, 39.255], [111.0, 111.63], [112.128, 112.255], [117.128, 117.255], [120.192, 120.255], [183.224, 183.255], [211.136, 211.191], [218.200, 218.255], [223.64, 223.127]]
};

function ipToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => isNaN(n))) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

function guessIsp(ip) {
  const v = ipToInt(ip);
  if (v === null) return '';
  const b2 = v >>> 16;
  for (const [isp, ranges] of Object.entries(ISP_RANGES)) {
    for (const [lo, hi] of ranges) {
      const loI = (Math.floor(lo) << 16) + ((lo % 1) * 256 << 8);
      const hiI = (Math.floor(hi) << 16) + (((hi % 1) * 256 + 255) << 8) + 255;
      // 简化：按前两段判断
      const seg = Math.floor(lo);
      const prefixInt = (seg << 16);
      if ((v & 0xffff0000) >= prefixInt && (v & 0xffff0000) <= ((Math.floor(hi) << 16))) return isp;
    }
  }
  return '';
}

function extractEndpointsFromChannels(province, channels) {
  const map = new Map();
  for (const ch of channels) {
    const m = ch.url.match(/^https?:\/\/([^\/:]+):(\d+)\/(rtp|udp)\//i);
    if (!m) continue;
    const key = `${m[1]}:${m[2]}`;
    if (!map.has(key)) map.set(key, { host: m[1], port: Number(m[2]), province, channels: [] });
    map.get(key).channels.push(ch);
  }
  return Array.from(map.values());
}

async function collectEndpointDb(logger = console.log) {
  const all = [];
  const seen = new Set();
  for (const it of GOOGLE_PROVINCE_REPOS) {
    const u = rawUrl(it.repo, it.file);
    const r = await request(u, { timeoutMs: 25000, maxBytes: 4 * 1024 * 1024 });
    if (!r.ok || r.status !== 200) { logger(`[endpoint] FAIL ${it.province} ${it.file} ${r.error || r.status}`); continue; }
    const chs = parseChannelList(r.body.toString('utf8'), { sourceLabel: `${it.province}/${it.file}` });
    const eps = extractEndpointsFromChannels(it.province, chs);
    logger(`[endpoint] ${it.province} ${it.file}: ch=${chs.length} http端点=${eps.length}`);
    for (const ep of eps) {
      const key = `${ep.host}:${ep.port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isp = guessIsp(ep.host);
      const typeStr = `${ep.province}组播${isp ? ' ' + ep.province + isp : ''}`;
      all.push({
        id: key,
        ip: ep.host,
        port: ep.port,
        province: ep.province,
        city: '',
        isp,
        t: 'multicast',
        type: typeStr,
        channelCount: ep.channels.length,
        status: '已采集',
        origin: 'province-repo',
        updateTime: new Date().toISOString(),
        channels: ep.channels
      });
    }
  }
  return all;
}

function saveEndpointDb(db) {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), count: db.length, sources: db }, null, 2), 'utf8');
}

function loadEndpointDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')).sources || []; } catch (e) { return []; }
}

module.exports = { collectEndpointDb, saveEndpointDb, loadEndpointDb, extractEndpointsFromChannels, guessIsp, DB_FILE };

if (require.main === module) {
  collectEndpointDb().then((db) => {
    saveEndpointDb(db);
    const byProv = {};
    for (const s of db) byProv[s.province] = (byProv[s.province] || 0) + 1;
    console.log(`[endpoint] 写入 ${db.length} 个端点源`);
    console.log('[endpoint] 各省端点:', JSON.stringify(byProv));
  }).catch((e) => { console.error('[endpoint] 失败:', e.message); process.exit(1); });
}
