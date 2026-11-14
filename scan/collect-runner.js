/**
 * collect-runner.js — 采集并把结果写入源库
 * 输出 data/source_db.json（合并：在线采集 + 本地黄金源）
 */
const path = require('path');
const fs = require('fs');
const { fetchList, extractEndpoints, PUBLIC_LISTS } = require('./collect');
const { probeMany } = require('./probe');
const { request } = require('./http');
const { parseChannelList } = require('./channels');
const { scoreChannels } = require('./score');
const { fromLocalM3u, makeSourceId, mergeSourceDb, saveSourceDb } = require('../src/source-db');

const ROOT = path.resolve(__dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

async function channelsFromEndpoint(host, port) {
  const paths = ['/channels', '/list.m3u', '/m3u', '/iptv.m3u', '/rtp.m3u', '/'];
  for (const p of paths) {
    const r = await request(`http://${host}:${port}${p}`, { timeoutMs: 6000, maxBytes: 3 * 1024 * 1024 });
    if (!r.ok || r.status !== 200) continue;
    const t = r.body.toString('utf8');
    if (t.trim().startsWith('#EXTM3U')) {
      const ch = parseChannelList(t, { sourceLabel: `${host}:${port}` });
      if (ch.length) return { channels: ch, path: p };
    }
  }
  return { channels: [], path: null };
}

(async () => {
  const argPublic = process.argv.indexOf('--public-only') !== -1;

  // 1) 拉公开源库
  const lists = [];
  for (const u of PUBLIC_LISTS) {
    const r = await fetchList(u);
    console.log(`[collect] ${r.ok ? 'OK' : 'FAIL'} ch=${r.channels.length} ${u}`);
    if (r.ok) lists.push(...r.channels);
  }
  console.log(`[collect] 公开源合计频道=${lists.length}`);

  // 2) 抽 udpxy 端点并探活
  const eps = extractEndpoints(lists);
  const alive = [];
  await probeMany(eps, { concurrency: 6, timeoutMs: 5000, onResult: (r) => { if (r.alive) alive.push(r); } });
  console.log(`[collect] udpxy 端点=${eps.length} 存活=${alive.length}`);

  // 3) 抓存活端点的频道表
  const sources = [];
  for (const ep of alive) {
    const { channels, path: p } = await channelsFromEndpoint(ep.host, ep.port);
    if (!channels.length) continue;
    const groups = {};
    for (const ch of channels) {
      const g = ch.group || '未分组';
      groups[g] = (groups[g] || 0) + 1;
    }
    for (const [g, n] of Object.entries(groups)) {
      sources.push({
        id: makeSourceId(`${ep.host}:${ep.port}`, g),
        ip: ep.host, port: ep.port, t: 'multicast',
        type: g, channelCount: n, status: '扫描可用',
        origin: 'endpoint-scan', updateTime: new Date().toISOString(),
        channels: channels.filter((c) => (c.group || '未分组') === g)
      });
    }
  }

  // 3.5) 直接收录公开源库中的 HLS/HTTP 频道（这些本身是已验证的可用源，不依赖 udpxy 探活）
  const directChannels = lists.filter((c) => /^https?:\/\//i.test(c.url) && !/\/(rtp|udp)\//i.test(c.url));
  const directGroups = {};
  for (const ch of directChannels) {
    const g = ch.group || '公开源';
    (directGroups[g] = directGroups[g] || []).push(ch);
  }
  for (const [g, chs] of Object.entries(directGroups)) {
    // 只收录有明确地域/运营商分组的，或大分组，避免噪声
    sources.push({
      id: makeSourceId(`public:${g}`, g),
      ip: '', port: 0, t: 'hls',
      type: g, channelCount: chs.length, status: '公开采集',
      origin: 'public-list', updateTime: new Date().toISOString(),
      channels: chs
    });
  }
  console.log(`[collect] 公开直链频道=${directChannels.length}，分组=${Object.keys(directGroups).length}`);

  // 4) 合并本地黄金源（除非 --public-only）
  let local = null;
  if (!argPublic) {
    const localFile = path.resolve(ROOT, (CFG.site && CFG.site.backup_m3u_file) || 'data/backup/playlist.m3u');
    local = fromLocalM3u(localFile, { host: 'local', ip: '127.0.0.1', t: 'multicast' });
  }

  const db = mergeSourceDb(sources, local ? [local] : []);
  saveSourceDb(db, path.join(ROOT, 'data/source_db.json'));
  console.log(`[collect] 写入源库: ${db.length} 条（扫描=${sources.length}, 本地=${local ? 1 : 0}）`);
})().catch((e) => { console.error('[collect] 失败:', e.message); process.exit(1); });
