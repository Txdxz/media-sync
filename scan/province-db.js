/**
 * province-db.js — 各省市源库构建（复刻 cqshushu 的"各省酒店/组播源"能力）
 * 输入：GitHub 上按省份维护的公开组播/酒店源列表
 * 输出：data/province_db.json —— 按 省/市/运营商/类型 聚合的源库
 */
const path = require('path');
const fs = require('fs');
const { request } = require('./http');
const { parseChannelList } = require('./channels');
const { buildTypeString, inferSourceType } = require('./tagger');
const { parseSourceType } = require('../src/selector');
const { GOOGLE_PROVINCE_REPOS, rawUrl } = require('./province-sources');
const { makeSourceId } = require('../src/source-db');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data/province_db.json');

function normalizeUrl(u) {
  // igmp:// / rtp:// 是本地组播，保留原样（需本地 udpxy 网关）
  return String(u || '').trim();
}

function canPlayDirectly(u) {
  // 只有 http(s)://host:port/rtp|udp/ 这种"公网 udpxy"式地址才可跨网直连
  return /^https?:\/\/[^/]+:\d+\/(rtp|udp)\//i.test(u);
}

function tagChannels(provinceHint, channels) {
  const buckets = new Map();
  for (const ch of channels) {
    const groupName = ch.group || '';
    let typeStr;
    let parsed = parseSourceType(groupName);
    if (parsed.province) {
      typeStr = buildTypeString(groupName);
    } else {
      // 分组无地域信息时，用文件所属省份兜底
      const srcType = inferSourceType(groupName, ch.url);
      const ispMatch = (groupName.match(/(电信|联通|移动|广电)/) || [])[1] || '';
      typeStr = `${provinceHint}${srcType}${ispMatch ? ' ' + provinceHint + ispMatch : ''}`;
      parsed = parseSourceType(typeStr);
    }
    if (!buckets.has(typeStr)) buckets.set(typeStr, { typeStr, parsed, channels: [] });
    buckets.get(typeStr).channels.push({ ...ch, url: normalizeUrl(ch.url), direct: canPlayDirectly(ch.url) });
  }
  const out = [];
  for (const [key, b] of buckets) {
    const directCount = b.channels.filter((c) => c.direct).length;
    out.push({
      id: makeSourceId(`province:${key}`, key),
      province: b.parsed.province || provinceHint,
      city: b.parsed.city || '',
      isp: b.parsed.isp || '',
      t: inferSourceType(key, b.channels[0] && b.channels[0].url),
      type: key,
      parsed: b.parsed,
      channelCount: b.channels.length,
      directCount,
      playable: directCount > 0 ? 'cross-net' : 'lan-only',
      status: '采集',
      origin: 'province-repo',
      updateTime: new Date().toISOString(),
      channels: b.channels
    });
  }
  return out;
}

async function collectProvinceSources(logger = console.log) {
  const all = [];
  for (const it of GOOGLE_PROVINCE_REPOS) {
    const u = rawUrl(it.repo, it.file);
    const r = await request(u, { timeoutMs: 25000, maxBytes: 4 * 1024 * 1024 });
    if (!r.ok || r.status !== 200) { logger(`[province] FAIL ${it.province} ${it.file} ${r.error || r.status}`); continue; }
    const chs = parseChannelList(r.body.toString('utf8'), { sourceLabel: `${it.province}/${it.file}` });
    const srcs = tagChannels(it.province, chs);
    all.push(...srcs);
    logger(`[province] ${it.province} ${it.file}: ch=${chs.length} 聚合=${srcs.length}`);
  }
  // 按 id 去重（后覆盖前）
  const map = new Map();
  for (const s of all) map.set(s.id, s);
  return Array.from(map.values());
}

function saveProvinceDb(db) {
  const dir = path.dirname(DB_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), count: db.length, sources: db }, null, 2), 'utf8');
}

function loadProvinceDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')).sources || []; } catch (e) { return []; }
}

module.exports = { collectProvinceSources, saveProvinceDb, loadProvinceDb, DB_FILE, canPlayDirectly };

if (require.main === module) {
  collectProvinceSources().then((db) => {
    saveProvinceDb(db);
    const byProv = {};
    for (const s of db) byProv[s.province] = (byProv[s.province] || 0) + s.channelCount;
    console.log(`[province] 写入 ${db.length} 条，频道总数 ${db.reduce((a, s) => a + s.channelCount, 0)}`);
    console.log('[province] 各省频道数:', JSON.stringify(byProv));
  }).catch((e) => { console.error('[province] 失败:', e.message); process.exit(1); });
}
