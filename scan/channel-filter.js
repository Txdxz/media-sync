/**
 * channel-filter.js — 只保留：央视频道 + 各省卫视 + 凤凰卫视，并按频道去重。
 */

const PHOENIX_RE = /凤凰/;
// 央视频道：CCTV、CCTV-1、CCTV5+、CGTN、央视
const CCTV_RE = /(^|\s)(CCTV-?\d{1,2}\+?|CGTN|央视)/i;
// 卫视
const SATELLITE_RE = /卫视/;

function isWantedChannel(name) {
  const n = String(name || '').replace(/\s+/g, '').trim();
  if (!n) return false;
  return PHOENIX_RE.test(n) || CCTV_RE.test(n) || SATELLITE_RE.test(n);
}

/**
 * 归一化频道名做去重 key：
 *  - CCTV-1 / CCTV1 / CCTV-1高清 / CCTV1HD → cctv1
 *  - CCTV5+ → cctv5plus
 *  - 湖南卫视 / 湖南卫视4K / 湖南卫视高清 → 湖南卫视
 *  - 凤凰卫视资讯台 / 凤凰资讯 → 凤凰（保留不同凤凰台区分）
 */
function dedupeKey(name) {
  let n = String(name || '').replace(/\s+/g, '').trim();
  // 去高清/4K/8K等后缀
  n = n.replace(/(高清|超清|超高清|蓝光|HD|SD|4K|8K|UHD|FHD)+$/i, '');
  // CCTV 归一
  const cctv = n.match(/^CCTV-?(\d{1,2})(\+)?/i);
  if (cctv) return `cctv${cctv[1]}${cctv[2] ? 'plus' : ''}`;
  if (/CGTN/i.test(n)) return 'cgtn';
  // 卫视归一：XX卫视（去掉后面附加内容）
  const sat = n.match(/^(.+?卫视)/);
  if (sat) return sat[1];
  // 凤凰：保留具体台
  if (/凤凰/.test(n)) return n;
  return n;
}

/**
 * 过滤 + 去重：每个归一化 key 只保留第一条（优先 http 直连、其次按出现顺序）
 */
function filterM3u(m3uText) {
  if (!m3uText || !m3uText.trim().startsWith('#EXTM3U')) return { text: m3uText, kept: 0, removed: 0, total: 0 };
  const lines = m3uText.split(/\r?\n/);
  const out = [lines[0]];
  const seen = new Set();
  let kept = 0, removed = 0, total = 0;
  let inf = null;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) { inf = line; continue; }
    if (line.startsWith('#')) { if (inf) out.push(line); continue; }
    if (!inf) continue;
    total++;
    const name = inf.slice(inf.lastIndexOf(',') + 1).trim();
    if (!isWantedChannel(name)) { removed++; inf = null; continue; }
    const key = dedupeKey(name);
    if (seen.has(key)) { removed++; inf = null; continue; }
    seen.add(key);
    // 统一分组：央视 / 卫视 / 凤凰
    let grp = '卫视';
    if (/CCTV|CGTN|央视/i.test(name)) grp = '央视';
    else if (/凤凰/.test(name)) grp = '凤凰';
    let newInf;
    if (/group-title="[^"]*"/.test(inf)) {
      newInf = inf.replace(/group-title="[^"]*"/, `group-title="${grp}"`);
    } else {
      // 无 group-title 则插入到 #EXTINF:-1 之后
      newInf = inf.replace(/^(#EXTINF:-1)/, `$1 group-title="${grp}"`);
    }
    out.push(newInf); out.push(line);
    kept++;
    inf = null;
  }
  return { text: out.join('\n'), kept, removed, total };
}

module.exports = { isWantedChannel, dedupeKey, filterM3u };
