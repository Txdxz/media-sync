/**
 * channel-sort.js — 频道标准化命名 + 排序
 * 规则：央视按 CCTV1..17（含5+）顺序排最前；卫视按省份常见顺序；凤凰最后。
 * 同时把频道名标准化为统一格式（便于电视端显示与去重）。
 */

// 央视标准名
const CCTV_NAMES = {
  1: 'CCTV-1 综合', 2: 'CCTV-2 财经', 3: 'CCTV-3 综艺', 4: 'CCTV-4 中文国际',
  5: 'CCTV-5 体育', 6: 'CCTV-6 电影', 7: 'CCTV-7 国防军事', 8: 'CCTV-8 电视剧',
  9: 'CCTV-9 纪录', 10: 'CCTV-10 科教', 11: 'CCTV-11 戏曲', 12: 'CCTV-12 社会与法',
  13: 'CCTV-13 新闻', 14: 'CCTV-14 少儿', 15: 'CCTV-15 音乐', 16: 'CCTV-16 奥林匹克',
  17: 'CCTV-17 农业农村'
};

// 卫视常见排序（中央→主要→其他），未列出的按拼音补后
const SAT_ORDER = ['北京','东方','湖南','浙江','江苏','广东','深圳','天津','山东','安徽','湖北','河南','河北','山西','陕西','辽宁','吉林','黑龙江','江西','福建','东南','四川','重庆','云南','贵州','广西','甘肃','青海','宁夏','新疆','西藏','内蒙古','内蒙','海南','三沙','延边','兵团','农林','大湾区','海峡','厦门','康巴','安多','莲花','星空','澳门','香港'];

function parseCctv(name) {
  const n = String(name || '').toUpperCase();
  if (!/CCTV/i.test(n)) return null;
  const m = n.match(/CCTV-?\s*(\d{1,2})(\s*\+)?/);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  const isPlus = !!m[2];
  return { num, isPlus };
}

function classify(name) {
  const n = String(name || '');
  if (/凤凰/.test(n)) return { group: '凤凰', order: 3 };
  if (/CCTV|CGTN|央视/i.test(n)) return { group: '央视', order: 1 };
  if (/卫视/.test(n)) return { group: '卫视', order: 2 };
  return { group: '其他', order: 4 };
}

/**
 * 标准化频道名
 */
function standardName(name) {
  const n = String(name || '').trim();
  const cctv = parseCctv(n);
  if (cctv) {
    if (cctv.isPlus && cctv.num === 5) return 'CCTV-5+ 体育赛事';
    if (CCTV_NAMES[cctv.num]) return CCTV_NAMES[cctv.num];
    return `CCTV-${cctv.num}`;
  }
  if (/CGTN/i.test(n)) return 'CGTN';
  // 凤凰：去掉分辨率后缀，保留台别
  if (/凤凰/.test(n)) {
    let ph = n.replace(/\s*\(\d+p\)/gi, '').replace(/(高清|超清|蓝光|HD|SD|4K|8K|UHD|FHD)/gi, '').trim();
    return ph;
  }
  // 卫视：去掉后缀，统一 XX卫视
  let sat = n.replace(/(高清|超清|超高清|蓝光|HD|SD|4K|8K|UHD|FHD|\s*\(.*?\))/gi, '').trim();
  const m = sat.match(/([\u4e00-\u9fa5]{2,}卫视)/);
  if (m) return m[1];
  if (/卫视/.test(sat)) return sat;
  return n;
}

// 排除明显不是电视频道的条目
function isNonChannel(name) {
  // 明确的影视剧/非直播条目，直接排除
  if (/特种兵|电视剧|剧场|小说|游戏|音乐榜/i.test(name)) return true;
  return false;
}

/**
 * 计算排序键（数字越小越靠前）
 */
function sortKey(name) {
  const n = String(name || '');
  const cctv = parseCctv(n);
  if (cctv) {
    // 央视排最前：CCTV1..17，5+ 紧跟在 5 后
    return ['1', String(cctv.num).padStart(3, '0') + (cctv.isPlus ? 'b' : 'a')];
  }
  if (/凤凰/.test(n)) {
    return ['3', n];
  }
  if (/央视|CGTN/i.test(n)) {
    // 央视非 CCTV 频道（CGTN/央视台球等）排在 CCTV-17 之后
    return ['1', '999' + n];
  }
  if (/卫视/.test(n)) {
    const base = n.replace(/(高清|超清|超高清|蓝光|HD|SD|4K|8K|UHD|FHD|\s*\(.*?\))/gi, '').trim();
    let idx = SAT_ORDER.findIndex(p => base.startsWith(p) || base.includes(p));
    if (idx === -1) idx = 999;
    return ['2', String(idx).padStart(3, '0') + base];
  }
  return ['4', n];
}

function compareChannels(a, b) {
  const ka = sortKey(a.name), kb = sortKey(b.name);
  if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
  return ka[1] < kb[1] ? -1 : (ka[1] > kb[1] ? 1 : 0);
}

module.exports = { standardName, sortKey, compareChannels, classify, parseCctv, isNonChannel };
