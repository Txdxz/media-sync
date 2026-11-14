/**
 * probe-endpoints.js — 云端探活端点库，标记每个端点当前是否可用
 * 输出 data/endpoint_probe.json：{ endpoint, alive, udpxy, latencyMs, error }
 */
const fs = require('fs');
const path = require('path');
const { loadEndpointDb } = require('./endpoint-db');
const { probeEndpoint } = require('./probe');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/endpoint_probe.json');

(async () => {
  const db = loadEndpointDb();
  console.log(`[probe] 端点 ${db.length}`);
  const results = [];
  // 端点多为域名，逐个探（限并发由分批实现）
  for (const s of db) {
    const r = await probeEndpoint(s.ip, s.port, { timeoutMs: 6000 });
    results.push({ endpoint: `${s.ip}:${s.port}`, province: s.province, alive: r.alive, udpxy: r.udpxy, latencyMs: r.latencyMs, error: r.error });
    console.log(`${r.alive ? 'ALIVE' : 'dead '} ${s.ip}:${s.port} ${r.error || (r.latencyMs + 'ms')}`);
  }
  const alive = results.filter((r) => r.alive).length;
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), total: results.length, alive, results }, null, 2), 'utf8');
  console.log(`[probe] 存活 ${alive}/${results.length}，写入 ${OUT}`);
})().catch((e) => { console.error('[probe] 失败:', e.message); process.exit(1); });
