/**
 * runner.js — 扫描编排入口
 * 用法：
 *   node scan/runner.js --manual-only
 *   node scan/runner.js --public-list <url1,url2> --limit 200
 * 输出：data/scan_pool.json（候选源池，含频道表与评分）
 */
const fs = require('fs');
const path = require('path');
const { collectEndpoints } = require('./endpoints');
const { probeMany } = require('./probe');
const { request } = require('./http');
const { parseChannelList } = require('./channels');
const { scoreChannels } = require('./score');

const ROOT = path.resolve(__dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

async function fetchChannels(host, port) {
  // 常见 udpxy 频道表路径
  const paths = ['/channels', '/list.m3u', '/m3u', '/iptv.m3u', '/rtp.m3u', '/'];
  for (const p of paths) {
    const r = await request(`http://${host}:${port}${p}`, { timeoutMs: 5000, maxBytes: 2 * 1024 * 1024 });
    if (!r.ok || r.status !== 200) continue;
    const text = r.body.toString('utf8');
    if (text.trim().startsWith('#EXTM3U')) {
      const chs = parseChannelList(text, { sourceLabel: `${host}:${port}` });
      if (chs.length) return chs;
    }
  }
  return [];
}

(async () => {
  const publicList = arg('--public-list', '');
  const limit = Number(arg('--limit', '200'));
  const timeoutMs = Number(arg('--timeout', '4000'));
  const concurrency = Number(arg('--concurrency', '6'));

  console.log(`[scan] 收集端点...`);
  const endpoints = (await collectEndpoints({
    publicListUrls: publicList ? publicList.split(',').map(s => s.trim()).filter(Boolean) : []
  })).slice(0, limit);
  console.log(`[scan] 待探测端点: ${endpoints.length}`);

  const alive = [];
  await probeMany(endpoints, {
    concurrency, timeoutMs,
    onResult: (r) => { if (r.alive) { alive.push(r); console.log(`  ✓ ${r.host}:${r.port} udpxy=${r.udpxy} ${r.latencyMs}ms`); } }
  });
  console.log(`[scan] 存活: ${alive.length}/${endpoints.length}`);

  const allChannels = [];
  for (const ep of alive.slice(0, 30)) {
    const chs = await fetchChannels(ep.host, ep.port);
    console.log(`  ${ep.host}:${ep.port} 频道 ${chs.length}`);
    allChannels.push(...chs);
  }

  const scored = scoreChannels(allChannels, CFG.priorities);
  const outDir = path.join(ROOT, 'data');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'scan_pool.json');
  fs.writeFileSync(outPath, JSON.stringify({
    generated_at: new Date().toISOString(),
    endpoints_total: endpoints.length,
    endpoints_alive: alive.length,
    channels_total: allChannels.length,
    top: scored.slice(0, 50),
    alive_endpoints: alive.map((a) => ({ host: a.host, port: a.port, udpxy: a.udpxy, latencyMs: a.latencyMs }))
  }, null, 2), 'utf8');
  console.log(`[scan] 已写入 ${outPath}，候选组 ${scored.length}`);
  if (scored[0]) console.log('[scan] Top1:', JSON.stringify(scored[0]));
})().catch((e) => { console.error('[scan] 失败:', e.message); process.exit(1); });
