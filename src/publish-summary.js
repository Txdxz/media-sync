/**
 * publish-summary.js — 统计"实际发布的自建源"摘要，供通知展示
 */
const fs = require('fs');
const { loadSourceDb } = require('./source-db');
const { filterM3u } = require('../scan/channel-filter');
const { toM3u, playableChannels, dedupeByName } = require('../scan/build-publish');

function buildPublishSummary(dbFile) {
  try {
    const db = loadSourceDb(dbFile);
    const channels = dedupeByName(playableChannels(db));
    const { text } = toM3u([{ channels }]);
    const filtered = filterM3u(text);
    // 统计分组
    const groups = {};
    const lines = filtered.text.split('\n');
    for (const l of lines) {
      const m = l.match(/group-title="([^"]*)"/);
      if (m && l.startsWith('#EXTINF')) groups[m[1]] = (groups[m[1]] || 0) + 1;
    }
    // 统计覆盖省份
    const provinces = new Set();
    for (const s of db) if (s.parsed && s.parsed.province) provinces.add(s.parsed.province);
    return {
      channelCount: filtered.kept,
      groups,
      provinceCount: provinces.size,
      provinces: Array.from(provinces)
    };
  } catch (e) {
    return null;
  }
}

module.exports = { buildPublishSummary };
