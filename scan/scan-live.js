/**
 * scan-live.js — 中范围扫描活 udpxy 端点（真正的"自己找源"）
 * 目标：按省采样的公网 IP × 常见 udpxy 端口 → 识别 udpxy → 抓频道表
 * 输出：data/live_endpoints.json
 *
 * 用法：
 *   node scan/scan-live.js --per-segment 24 --concurrency 40 --timeout 3000
 */
const fs = require('fs');
const path = require('path');
const { buildScanTargets, UDPXY_PORTS } = require('./ip-ranges');
const { request } = require('./http');
const { parseChannelList } = require('./channels');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/live_endpoints.json');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const UDPXY_RE = /udpxy|Multicast|clients=/i;

async function isUdpxy(ip, port, timeoutMs) {
  const r = await request(`http://${ip}:${port}/status`, { timeoutMs, maxBytes: 8192 });
  if (!r.ok) return null;
  if (r.status !== 200) return null;
  const text = (r.body || Buffer.alloc(0)).toString('utf8');
  if (!UDPXY_RE.test(text)) return null;
  return { ip, port, statusText: text.slice(0, 200) };
}

async function fetchChannels(ip, port, timeoutMs) {
  const paths = ['/channels', '/list.m3u', '/rtp.m3u', '/m3u', '/'];
  for (const p of paths) {
    const r = await request(`http://${ip}:${port}${p}`, { timeoutMs: Math.max(timeoutMs, 4000), maxBytes: 2 * 1024 * 1024 });
    if (!r.ok || r.status !== 200) continue;
    const t = (r.body || Buffer.alloc(0)).toString('utf8');
    if (t.trim().startsWith('#EXTM3U')) {
      const chs = parseChannelList(t, { sourceLabel: `${ip}:${port}` });
      if (chs.length) return chs;
    }
  }
  return [];
}

(async () => {
  const perSegment = Number(arg('--per-segment', '24'));
  const concurrency = Number(arg('--concurrency', '40'));
  const timeoutMs = Number(arg('--timeout', '3000'));

  const targets = buildScanTargets({ perSegment });
  console.log(`[scan-live] 目标 IP=${targets.length} 端口=${UDPXY_PORTS.length} 组合=${targets.length * UDPXY_PORTS.length}`);

  const found = [];
  const tasks = [];
  for (const t of targets) {
    for (const port of UDPXY_PORTS) tasks.push({ ip: t.ip, port, province: t.province });
  }

  let idx = 0, done = 0;
  async function worker() {
    while (idx < tasks.length) {
      const task = tasks[idx++];
      const u = await isUdpxy(task.ip, task.port, timeoutMs);
      done++;
      if (done % 500 === 0) console.log(`[scan-live] 进度 ${done}/${tasks.length} 命中=${found.length}`);
      if (u) {
        const chs = await fetchChannels(task.ip, task.port, timeoutMs);
        console.log(`[scan-live] ✅ UDPXY ${task.ip}:${task.port} (${task.province}) 频道=${chs.length}`);
        found.push({ ...task, channels: chs, channelCount: chs.length });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), targets: targets.length, alive: found.length, endpoints: found }, null, 2), 'utf8');
  console.log(`[scan-live] 完成：命中 ${found.length} 个 udpxy，写入 ${OUT}`);
})().catch((e) => { console.error('[scan-live] 失败:', e.message); process.exit(1); });
