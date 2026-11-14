/**
 * score.js — 按既有优先级体系给扫描到的源打分
 * 复用 src/selector 的解析与匹配，保持与线上选源口径一致
 */
const { parseSourceType, matchPriorityTier, isMulticastSource } = require('../src/selector');

function scoreChannels(channels, priorities) {
  const bySource = new Map();
  for (const ch of channels) {
    const key = ch.source;
    if (!bySource.has(key)) bySource.set(key, []);
    bySource.get(key).push(ch);
  }

  const scored = [];
  for (const [source, list] of bySource) {
    const grouped = {};
    for (const ch of list) {
      const g = ch.group || '未分组';
      if (!grouped[g]) grouped[g] = [];
      grouped[g].push(ch);
    }
    for (const [group, chs] of Object.entries(grouped)) {
      const parsed = parseSourceType(group);
      const tier = matchPriorityTier(parsed, priorities);
      const isMulti = /组播/.test(group) || chs.some((c) => c.isMulticastUrl);
      scored.push({
        source,
        group,
        parsed,
        tierId: tier ? tier.id : null,
        isMulticast: isMulti,
        count: chs.length,
        hdCount: chs.filter((c) => c.isHd).length,
        score: (tier ? (100 - tier.id) * 1000 : 0) + (isMulti ? 500 : 0) + Math.min(chs.length, 400)
      });
    }
  }
  return scored.sort((a, b) => b.score - a.score);
}

module.exports = { scoreChannels };
