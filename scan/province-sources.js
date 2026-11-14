/**
 * province-sources.js — 各省市组播/酒店源的采集清单与聚合
 * 数据源：GitHub 上按省份维护的公开组播/酒店源列表（真实存在、持续更新）
 */
const GOOGLE_PROVINCE_REPOS = [
  { province: '广东', repo: 'Rocsheng/IPTV_RTP', file: 'Guangdong.m3u', type: '组播' },
  { province: '湖南', repo: 'Rocsheng/IPTV_RTP', file: 'Hunan.m3u', type: '组播' },
  { province: '江苏', repo: 'Rocsheng/IPTV_RTP', file: 'Jiangsu.m3u', type: '组播' },
  { province: '海南', repo: 'Rocsheng/IPTV_RTP', file: 'Hainan.m3u', type: '组播' },
  { province: '江苏', repo: 'nczyw/iptv', file: '江苏电信IPTV.m3u', type: '组播' },
  { province: '天津', repo: 'chilinha/tv', file: 'unicom.m3u', type: '组播' },
  { province: '天津', repo: 'chilinha/tv', file: 'mobile.m3u', type: '组播' },
  { province: '河北', repo: 'fgfyo/hebei-iptv', file: '直接拖拽potplayer.m3u', type: '组播' },
  { province: '北京', repo: 'wuwentao/bj-unicom-iptv', file: 'bj-unicom-iptv.m3u', type: '组播' }
];

function rawUrl(repo, file) {
  return `https://raw.githubusercontent.com/${repo}/main/${encodeURIComponent(file)}`;
}

module.exports = { GOOGLE_PROVINCE_REPOS, rawUrl };
