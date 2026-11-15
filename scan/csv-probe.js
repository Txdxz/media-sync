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
  // 先试 /status 判断 udpxy
  const s = await request(`${row.link}/status`, { timeoutMs, maxBytes: 8192 });
  const stxt = (s.body || Buffer.alloc(0)).toString('utf8');
  const isU = s.ok && s.status === 200 && /udpxy|Multicast|clients=/i.test(stxt);
  // 再试频道表
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
  return { ...row, alive: isU || channels.length > 0, udpxy: isU, channelCount: channels.length, sample: channels.slice(0, 2) };
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
        const r = await probeOne(row, 4000);
        if (r.alive) { alive++; console.log(`✅ ${row.province||'?'} ${row.city||''} ${row.ip}:${row.port} ch=${r.channelCount} udpxy=${r.udpxy}`); }
        results.push(r);
      } catch (e) { results.push({ ...row, alive: false, error: e.message }); }
    }
  }
  await Promise.all(Array.from({ length: 25 }, worker));
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), total: results.length, alive, results }, null, 2));
  console.log(`[csv-probe] 存活 ${alive}/${results.length}, 写入 ${OUT}`);
})().catch(e => { console.error('[csv-probe] 失败:', e.message); process.exit(1); });
