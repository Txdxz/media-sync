/**
 * build-publish.js — 把自建源库生成可发布的 M3U，输出到 ./public
 * 用于 GitHub Pages：原站挂掉时，电视从自建源更新。
 */
const fs = require('fs');
const path = require('path');
const { loadSourceDb } = require('../src/source-db');
const { loadProvinceDb } = require('./province-db');

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

function build(publishDir = path.join(ROOT, 'public')) {
  const db = loadSourceDb(DB);
  const channels = dedupeByName(playableChannels(db));
  const { text, count } = toM3u([{ channels }]);
  if (!fs.existsSync(publishDir)) fs.mkdirSync(publishDir, { recursive: true });

  // 自建源同时写两个名字：
  //  - ${key}.m3u      主订阅地址（原站长期宕机时作为兜底，内容=自建源）
  //  - ${key}_self.m3u 明确的自建源地址
  // 说明：主文件是否用自建源覆盖，由 workflow 决定；这里只负责生成文件。
  const key = (process.env.SUBSCRIBE_KEY || 'feed').replace(/\.m3u$/i, '');
  const selfKey = `${key}_self`;
  const outFile = path.join(publishDir, `${selfKey}.m3u`);
  fs.writeFileSync(outFile, text, 'utf8');
  fs.writeFileSync(path.join(publishDir, selfKey), text, 'utf8');
  // 若显式要求回填主文件（origin 长期宕机时）
  if (process.env.FILL_MAIN === '1') {
    fs.writeFileSync(path.join(publishDir, `${key}.m3u`), text, 'utf8');
    fs.writeFileSync(path.join(publishDir, `${key}`), text, 'utf8');
    console.log('[publish] 已回填主订阅文件（FILL_MAIN=1）');
  }

  // 404 伪装首页
  fs.writeFileSync(path.join(publishDir, 'index.html'),
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>404 Not Found</title></head>' +
    '<body style="font-family:sans-serif;text-align:center;padding:50px;"><h2>404 Not Found</h2></body></html>', 'utf8');

  console.log(`[publish] 自建源库=${db.length} 可发布频道=${count} → ${outFile}`);
  return { count, outFile };
}

if (require.main === module) build();
module.exports = { build, toM3u, playableChannels, dedupeByName };
