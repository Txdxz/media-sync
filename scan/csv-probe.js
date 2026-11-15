/**
 * csv-probe.js — 云端验证 CSV 端点是否真能出流（udpxy /status 或频道表）
 * 输出 data/csv_probe.json
 */
const fs = require('fs');
const path = require('path');
const { fetchCsvSources } = require('./csv-sources');
const { request } = require('./http');
const { parseChannelList } = require('./channels');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/csv_probe.json');

async function probeOne(row, timeoutMs) {
  // 阶段1：单请求快速筛（/status），非 udpxy 直接判死
  const s = await request(`${row.link}/status`, { timeoutMs, maxBytes: 8192 });
  if (!s.ok || s.status !== 200) return { ...row, alive: false, error: s.error || `http_${s.status}` };
  const stxt = (s.body || Buffer.alloc(0)).toString('utf8');
  const isU = /udpxy|Multicast|clients=/i.test(stxt);
  if (!isU) return { ...row, alive: false, error: 'not_udpxy' };
  // 阶段2：仅对活的 udpxy 抓频道表
  let channels = [];
  for (const p of ['/channels', '/list.m3u', '/rtp.m3u', '/']) {
    const r = await request(`${row.link}${p}`, { timeoutMs, maxBytes: 1024 * 1024 });
    if (!r.ok || r.status !== 200) continue;
    const t = (r.body || Buffer.alloc(0)).toString('utf8');
    if (t.trim().startsWith('#EXTM3U')) {
      channels = parseChannelList(t, { sourceLabel: row.link });
      if (channels.length) break;
    }
  }
  return { ...row, alive: true, udpxy: isU, channelCount: channels.length, sample: channels.slice(0, 3) };
}

(async () => {
  const rows = await fetchCsvSources();
  console.log(`[csv-probe] 待测 ${rows.length}`);
  const results = [];
  let idx = 0, alive = 0;
  async function worker() {
    while (idx < rows.length) {
      const row = rows[idx++];
      try {
        const r = await probeOne(row, 2500);
        if (r.alive) { alive++; console.log(`✅ ${row.province||'?'} ${row.city||''} ${row.ip}:${row.port} ch=${r.channelCount} udpxy=${r.udpxy}`); }
        results.push(r);
      } catch (e) { results.push({ ...row, alive: false, error: e.message }); }
    }
  }
  await Promise.all(Array.from({ length: 50 }, worker));
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), total: results.length, alive, results }, null, 2));
  console.log(`[csv-probe] 存活 ${alive}/${results.length}, 写入 ${OUT}`);
})().catch(e => { console.error('[csv-probe] 失败:', e.message); process.exit(1); });
