/**
 * daily-collect.js — 每日采集主流程（复刻 cqshushu 的核心能力）
 *
 * 流程：
 *   1. 从公开源库收集候选 udpxy 端点，合并进端点池
 *   2. 对端点池并发探活（udpxy 识别）
 *   3. 对存活端点抓频道表
 *   4. 频道 → 按"省份/城市/运营商/类型"打标签，聚合成源
 *   5. 与上一版源库合并（按 id），保留历史可用源
 *   6. 写入 data/source_db.json
 *
 * 用法：node scan/daily-collect.js
 */
const path = require('path');
const fs = require('fs');
const { fetchList, PUBLIC_LISTS, extractEndpoints } = require('./collect');
const { probeMany } = require('./probe');
const { request } = require('./http');
const { parseChannelList } = require('./channels');
const { buildTypeString, inferSourceType } = require('./tagger');
const { loadPool, savePool, mergeEndpoints } = require('./endpoint-pool');
const { makeSourceId, loadSourceDb, saveSourceDb, mergeSourceDb } = require('../src/source-db');
const { parseSourceType } = require('../src/selector');

const ROOT = path.resolve(__dirname, '..');
const DB_FILE = path.join(ROOT, 'data/source_db.json');

async function channelsFromEndpoint(host, port) {
  const paths = ['/channels', '/list.m3u', '/m3u', '/iptv.m3u', '/rtp.m3u', '/', '/status'];
  for (const p of paths) {
    const r = await request(`http://${host}:${port}${p}`, { timeoutMs: 6000, maxBytes: 3 * 1024 * 1024 });
    if (!r.ok || r.status !== 200) continue;
    const t = r.body.toString('utf8');
    if (t.trim().startsWith('#EXTM3U')) {
      const chs = parseChannelList(t, { sourceLabel: `${host}:${port}` });
      if (chs.length) return chs;
    }
  }
  return [];
}

function groupIntoSources(host, port, channels) {
  // 按"省份+城市+运营商+类型"聚合
  const buckets = new Map();
  for (const ch of channels) {
    const groupName = ch.group || '';
    let parsed = parseSourceType(groupName);
    // 分组名没有地域信息时，尝试从 endpoint 元数据或留空
    const typeStr = parsed.province ? buildTypeString(groupName) : (groupName || `未分组 ${host}:${port}`);
    const key = typeStr;
    if (!buckets.has(key)) buckets.set(key, { typeStr, parsed: parseSourceType(typeStr), channels: [] });
    buckets.get(key).channels.push(ch);
  }
  const out = [];
  for (const [key, b] of buckets) {
    out.push({
      id: makeSourceId(`${host}:${port}`, key),
      ip: host, port, t: inferSourceType(key, b.channels[0] && b.channels[0].url),
      type: key,
      parsed: b.parsed,
      channelCount: b.channels.length,
      status: '扫描可用',
      origin: 'endpoint-scan',
      updateTime: new Date().toISOString(),
      channels: b.channels
    });
  }
  return out;
}

(async () => {
  // 1) 收集候选端点
  const publicChannels = [];
  for (const u of PUBLIC_LISTS) {
    const r = await fetchList(u);
    if (r.ok) publicChannels.push(...r.channels);
  }
  const fromLists = extractEndpoints(publicChannels);
  const pool = mergeEndpoints(loadPool().endpoints, fromLists);
  savePool({ endpoints: pool });
  console.log(`[daily] 端点池=${pool.length}（公开源库抽出 ${fromLists.length}）`);

  // 2) 探活
  const alive = [];
  await probeMany(pool, {
    concurrency: 8, timeoutMs: 5000,
    onResult: (r) => { if (r.alive) alive.push(r); }
  });
  console.log(`[daily] 存活端点=${alive.length}/${pool.length}`);

  // 3) 抓频道 + 聚合
  const scanned = [];
  for (const ep of alive) {
    const chs = await channelsFromEndpoint(ep.host, ep.port);
    if (!chs.length) { console.log(`  ${ep.host}:${ep.port} 无频道表`); continue; }
    const srcs = groupIntoSources(ep.host, ep.port, chs);
    scanned.push(...srcs);
    console.log(`  ${ep.host}:${ep.port} 频道=${chs.length} 聚合源=${srcs.length}`);
  }

  // 4) 合并旧库（保留历史，避免一次扫描失败丢掉全部）
  const prev = loadSourceDb(DB_FILE);
  const merged = mergeSourceDb(prev, scanned);
  // 清理：只保留有频道的
  const finalDb = merged.filter((s) => (s.channels && s.channels.length) || s.channelCount > 0);
  saveSourceDb(finalDb, DB_FILE);
  console.log(`[daily] 源库=${finalDb.length} 条（本次扫描 ${scanned.length}，历史 ${prev.length}），总频道=${finalDb.reduce((a, s) => a + (s.channelCount || 0), 0)}`);

  // 5) 统计按省份
  const byProv = {};
  for (const s of finalDb) {
    const p = (s.parsed && s.parsed.province) || '未标注';
    byProv[p] = (byProv[p] || 0) + 1;
  }
  console.log('[daily] 省份分布:', JSON.stringify(byProv));
})().catch((e) => { console.error('[daily] 失败:', e.message); process.exit(1); });
