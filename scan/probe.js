/**
 * probe.js — udpxy 端点探活
 * 判定依据：HTTP 200 + 页面含 udpxy 特征（"udpxy" 或 "Multicast"）或 /status 可解析
 */
const { request } = require('./http');

const UDPXY_HINTS = ['udpxy', 'udpxy status', 'Multicast', 'rtp/', 'udp/'];

async function probeEndpoint(host, port, opts = {}) {
  const timeoutMs = opts.timeoutMs || 4000;
  const base = `http://${host}:${port}`;
  const result = { host, port, alive: false, udpxy: false, channels: null, latencyMs: null, error: null };

  const t0 = Date.now();
  const statusRes = await request(`${base}/status`, { timeoutMs, maxBytes: 32 * 1024 });
  const rootRes = statusRes.ok && statusRes.status === 200
    ? statusRes
    : await request(`${base}/`, { timeoutMs, maxBytes: 32 * 1024 });
  result.latencyMs = Date.now() - t0;

  if (!rootRes.ok) { result.error = rootRes.error; return result; }
  if (rootRes.status !== 200) { result.error = `http_${rootRes.status}`; return result; }

  result.alive = true;
  const text = (rootRes.body || Buffer.alloc(0)).toString('utf8');
  result.udpxy = UDPXY_HINTS.some((h) => text.includes(h));
  // udpxy /status 中 "clients=..." 或 "Multicast" 表可拿频道数（不同版本格式不同）
  const m = text.match(/clients=(\d+)/);
  if (m) result.channels = null; // 仅活跃客户端数，非频道数
  return result;
}

/**
 * 并发探活：受 limit 控制，避免被当成攻击
 */
async function probeMany(endpoints, { concurrency = 8, timeoutMs = 4000, onResult } = {}) {
  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < endpoints.length) {
      const cur = endpoints[idx++];
      const r = await probeEndpoint(cur.host, cur.port, { timeoutMs });
      results.push(r);
      if (typeof onResult === 'function') onResult(r);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, endpoints.length) }, worker));
  return results;
}

module.exports = { probeEndpoint, probeMany, UDPXY_HINTS };
