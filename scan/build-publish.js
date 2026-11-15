/**
 * build-publish.js — 把自建源库生成可发布的 M3U，输出到 ./public
 * 用于 GitHub Pages：原站挂掉时，电视从自建源更新。
 */
const fs = require('fs');
const path = require('path');
const { loadSourceDb } = require('../src/source-db');
const { loadProvinceDb } = require('./province-db');
const { filterM3u } = require('./channel-filter');

const ROOT = path.resolve(__dirname, '..');
const DB = path.join(ROOT, 'data/source_db.json');

function toM3u(sources) {
  const lines = ['#EXTM3U x-tvg-url="https://live.fanmingming.com/e.xml"'];
  let count = 0;
  for (const s of sources) {
    for (const ch of (s.channels || [])) {
      const name = ch.name || '频道';
      const group = ch.group || s.type || '未分组';
      const tvgId = ch.tvgId ? ` tvg-id="${ch.tvgId}"` : '';
      lines.push(`#EXTINF:-1${tvgId} group-title="${group}",${name}`);
      lines.push(ch.url);
      count++;
    }
  }
  return { text: lines.join('\n'), count };
}

/**
 * 按"可直连"优先 + 频道数 排序，挑出要发布的源
 * 原生 rtp/igmp 无法跨网播放，发布时排除；只发布 http(s) 直链
 */
function playableChannels(sources) {
  const out = [];
  for (const s of sources) {
    for (const ch of (s.channels || [])) {
      if (/^https?:\/\//i.test(ch.url)) out.push(ch);
    }
  }
  return out;
}

/**
 * 去重：同名频道保留一个（优先 http(s)）
 */
function dedupeByName(channels) {
  const seen = new Map();
  for (const ch of channels) {
    const key = (ch.name || '').trim();
    if (!key) continue;
    if (!seen.has(key)) seen.set(key, ch);
  }
  return Array.from(seen.values());
}

const HOTEL_PLAYLIST = path.join(ROOT, 'data/hotel_playlist.json');

function loadHotelChannels() {
  try {
    const d = JSON.parse(fs.readFileSync(HOTEL_PLAYLIST, 'utf8'));
    return d.channels || [];
  } catch (e) { return []; }
}

function build(publishDir = path.join(ROOT, 'public')) {
  const { standardName, compareChannels, isNonChannel } = require('./channel-sort');

  // 1) 收集候选频道：酒店源(优先) + 自建源，各自先过"央视/卫视/凤凰"过滤
  const hotel = loadHotelChannels();
  const db = loadSourceDb(DB);
  const baseChannels = dedupeByName(playableChannels(db));
  const { text: baseRaw } = toM3u([{ channels: baseChannels }]);
  const baseFiltered = filterM3u(baseRaw);

  // 解析成 {name, inf, url} 列表
  function parseM3u(text) {
    const out = [];
    const lines = text.split('\n');
    let inf = null;
    for (const line of lines) {
      if (line.startsWith('#EXTINF')) { inf = line; continue; }
      if (!line || line.startsWith('#')) continue;
      if (!inf) continue;
      const name = inf.slice(inf.lastIndexOf(',') + 1).trim();
      out.push({ name, inf, url: line });
      inf = null;
    }
    return out;
  }

  const candidates = [...hotel, ...parseM3u(baseFiltered.text)];

  // 2) 标准化频道名 + 按标准名去重（酒店源在前，优先保留）
  const seen = new Set();
  const finalChannels = [];
  for (const ch of candidates) {
    if (isNonChannel(ch.name)) continue;
    const std = standardName(ch.name);
    const key = std.replace(/\s+/g, '');
    if (seen.has(key)) continue;
    seen.add(key);
    // 重写 EXTINF 的频道名称为标准名
    const newInf = ch.inf.replace(/,([^,]*)$/, `,${std}`);
    finalChannels.push({ name: std, inf: newInf, url: ch.url });
  }

  // 3) 排序：央视1..17 → 卫视 → 凤凰
  finalChannels.sort(compareChannels);

  // 4) 输出
  const m3uLines = ['#EXTM3U x-tvg-url="https://live.fanmingming.com/e.xml"'];
  for (const ch of finalChannels) { m3uLines.push(ch.inf, ch.url); }
  const text = m3uLines.join('\n');
  const count = finalChannels.length;
  if (!fs.existsSync(publishDir)) fs.mkdirSync(publishDir, { recursive: true });

  // 自建源只写 _self 文件（备用），绝不写主文件——主订阅始终以 cqshushu 为主。
  const key = (process.env.SUBSCRIBE_KEY || 'feed').replace(/\.m3u$/i, '');
  const selfKey = `${key}_self`;
  const outFile = path.join(publishDir, `${selfKey}.m3u`);
  fs.writeFileSync(outFile, text, 'utf8');
  fs.writeFileSync(path.join(publishDir, selfKey), text, 'utf8');

  // 404 伪装首页
  fs.writeFileSync(path.join(publishDir, 'index.html'),
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>404 Not Found</title></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:50px;"><h2>404 Not Found</h2></body></html>', 'utf8');

  console.log(`[publish] 自建源库=${db.length} 可发布频道=${count} → ${outFile}`);
  return { count, outFile };
}

if (require.main === module) build();
module.exports = { build, toM3u, playableChannels, dedupeByName };
