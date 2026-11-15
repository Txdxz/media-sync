/**
 * hotel-to-m3u.js — 把可用酒店源转换成发布用 M3U（只保留央视/卫视/凤凰）
 * 逐个拉详情+M3U，失败的跳过；合并去重；输出 data/hotel_playlist.json（含每源统计）
 */
const fs = require('fs');
const path = require('path');
const SourceClient = require('../src/client');
const { filterM3u } = require('./channel-filter');

const ROOT = path.resolve(__dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const HOTEL = path.join(ROOT, 'data/hotel_db.json');
const OUT = path.join(ROOT, 'data/hotel_playlist.json');

(async () => {
  const c = new SourceClient({ ...CFG.site, rate_limit_retry_count: 0, request_timeout_ms: 12000, logger: () => {} });
  const db = JSON.parse(fs.readFileSync(HOTEL, 'utf8'));
  const results = [];
  const allChannels = [];
  // 每省最多取 2 个源，控制请求量；不足则顺延
  const perProv = {};
  const limited = db.sources.filter(s => {
    const k = s.parsed.province || '?';
    perProv[k] = (perProv[k] || 0) + 1;
    return perProv[k] <= 2;
  });
  console.log(`[hotel-m3u] 总源 ${db.sources.length}，每省取2个后 ${limited.length}`);
  for (const s of limited) {
    try {
      const detail = await c.fetchSourceDetail(s.p, s.t);
      const m3u = await c.fetchM3UContent(detail.s, detail.t);
      const f = filterM3u(m3u);
      if (f.kept > 0) {
        // 解析过滤后的频道，标记来源省份
        const lines = f.text.split('\n');
        let inf = null;
        for (const line of lines) {
          if (line.startsWith('#EXTINF')) { inf = line; continue; }
          if (line.startsWith('#') || !inf) continue;
          const name = inf.slice(inf.lastIndexOf(',') + 1);
          allChannels.push({ name, inf, url: line, province: s.parsed.province, srcType: s.type });
          inf = null;
        }
        results.push({ type: s.type, province: s.parsed.province, ip: s.ip, channels: f.kept, status: 'ok' });
        console.log(`✓ ${s.type} ${s.ip}: 保留 ${f.kept} 个央视/卫视/凤凰`);
      } else {
        results.push({ type: s.type, province: s.parsed.province, ip: s.ip, channels: 0, status: 'no_wanted' });
      }
    } catch (e) {
      results.push({ type: s.type, province: s.parsed.province, ip: s.ip, channels: 0, status: 'fail', error: e.message.slice(0, 50) });
    }
    await new Promise(r => setTimeout(r, 800 + Math.floor(Math.random() * 600)));
  }
  // 按频道名去重（保留第一个）
  const seen = new Set();
  const deduped = [];
  for (const ch of allChannels) {
    const k = ch.name.replace(/\s+/g, '');
    if (seen.has(k)) continue;
    seen.add(k); deduped.push(ch);
  }
  fs.writeFileSync(OUT, JSON.stringify({
    updatedAt: new Date().toISOString(),
    sourcesOk: results.filter(r => r.status === 'ok').length,
    sourcesTotal: results.length,
    channelCount: deduped.length,
    results,
    channels: deduped
  }, null, 2), 'utf8');
  console.log(`[hotel-m3u] 成功源 ${results.filter(r=>r.status==='ok').length}/${results.length}，去重后频道 ${deduped.length}`);
  const byProv = {};
  for (const ch of deduped) byProv[ch.province] = (byProv[ch.province] || 0) + 1;
  console.log('[hotel-m3u] 各省贡献频道:', JSON.stringify(byProv));
})().catch(e => { console.error('[hotel-m3u] 失败:', e.message); process.exit(1); });
