/**
 * tagger.js — 给源打"省份/城市/运营商/类型"标签
 * cqshushu 的 type 形如 "山西太原组播 山西电信"，这里用同样的规则生成。
 */
const { parseSourceType } = require('../src/selector');

// 从频道名/分组名推断类型的已知关键词
const TYPE_KEYWORDS = [
  { type: '组播', re: /组播|\brtp\b|\budp\b/i },
  { type: '酒店', re: /酒店|hotel/i },
  { type: '咪咕', re: /咪咕|migu/i }
];

function inferSourceType(groupName, channelUrl, endpointPath) {
  const text = `${groupName || ''} ${channelUrl || ''} ${endpointPath || ''}`;
  for (const k of TYPE_KEYWORDS) if (k.re.test(text)) return k.type;
  if (/\/rtp\/|\/udp\//i.test(channelUrl || '')) return '组播';
  if (/migu/i.test(channelUrl || '')) return '咪咕';
  return '其他';
}

/**
 * 生成 cqshushu 风格的 type 字符串："{省}{市}{类型} {省}{运营商}"，
 * 若无法解析省份则退回 groupName。
 */
function buildTypeString(groupName) {
  const parsed = parseSourceType(groupName || '');
  if (!parsed.province) return groupName || '未分组';
  const cityPart = parsed.city || '';
  const srcType = parsed.sourceType && parsed.sourceType !== '其他' ? parsed.sourceType : '酒店';
  const ispPart = parsed.isp || '';
  const provIsp = ispPart ? `${parsed.province}${ispPart}` : parsed.province;
  return `${parsed.province}${cityPart}${srcType} ${provIsp}`;
}

module.exports = { inferSourceType, buildTypeString };
