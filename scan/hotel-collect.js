/**
 * hotel-collect.js — 从 cqshushu 拉各省酒店源（电信/联通/移动），按省份入库
 * 只收状态为「新上线/存活N天」的，按频道数排序，输出 data/hotel_db.json
 */
const fs = require('fs');
const path = require('path');
const SourceClient = require('../src/client');
const { parseSourceType } = require('../src/selector');

const ROOT = path.resolve(__dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const OUT = path.join(ROOT, 'data/hotel_db.json');

// 站点省份代码（来自 config 与探测）
const PROVINCES = {
  '山西': 'sx', '天津': 'tj', '北京': 'bj', '上海': 'sh', '陕西': 'sn',
  '河南': 'ha', '吉林': 'jl', '内蒙古': 'nm', '江苏': 'js', '安徽': 'ah', '广东': 'gd',
  '浙江': 'zj', '山东': 'sd', '四川': 'sc', '湖北': 'hb', '湖南': 'hn', '河北': 'he',
  '福建': 'fj', '江西': 'jx', '辽宁': 'ln', '黑龙江': 'hl', '广西': 'gx', '云南': 'yn',
  '贵州': 'gz', '甘肃': 'gs', '海南': 'hi', '宁夏': 'nx', '青海': 'qh', '新疆': 'xj',
  '西藏': 'xz', '重庆': 'cq'
};

function isAlive(status) { return status === '新上线' || /^存活\d+天$/.test(status || ''); }

(async () => {
  // 关闭内部重试，避免 429 时反复重试拖时间；改为外层跳过
  const c = new SourceClient({ ...CFG.site, rate_limit_retry_count: 0, request_timeout_ms: 12000, logger: () => {} });
  const all = [];
  for (const [prov, code] of Object.entries(PROVINCES)) {
    let collected = [];
    // 每省只拉第 1 页（30 个省级别通常够用），减少请求量避免 429
    try {
      const r = await c.fetchSourceList({ province: code, type: 'hotel', limit: 30, page: 1 });
      for (const s of (r.sources || [])) {
        const parsed = parseSourceType(s.type);
        if (parsed.province !== prov) continue;
        if (!isAlive(s.status)) continue;
        collected.push({ ...s, parsed });
      }
    } catch (e) {
      console.log(`[hotel] ${prov}(${code}) 失败: ${e.message.slice(0,50)}`);
    }
    if (collected.length) {
      console.log(`[hotel] ${prov}: ${collected.length} 个可用酒店源`);
      all.push(...collected);
    }
    // 增量保存，防止中途超时丢失
    try {
      fs.mkdirSync(path.dirname(OUT), { recursive: true });
      fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), provinces: new Set(all.map(s=>s.parsed.province)).size, total: all.length, sources: all }, null, 2), 'utf8');
    } catch (e) { /* ignore */ }
    // 省间随机延时 2.5~4s，避开风控
    await new Promise(res => setTimeout(res, 2500 + Math.floor(Math.random()*1500)));
  }
  // 按省份+运营商聚合
  const byProv = {};
  for (const s of all) {
    const key = s.parsed.province;
    if (!byProv[key]) byProv[key] = [];
    byProv[key].push(s);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    updatedAt: new Date().toISOString(),
    provinces: Object.keys(byProv).length,
    total: all.length,
    sources: all
  }, null, 2), 'utf8');
  console.log(`[hotel] 合计 ${all.length} 个可用酒店源，覆盖 ${Object.keys(byProv).length} 省`);
  console.log('[hotel] 各省:', JSON.stringify(Object.fromEntries(Object.entries(byProv).map(([k,v])=>[k,v.length]))));
})().catch(e => { console.error('[hotel] 失败:', e.message); process.exit(1); });
