/**
 * intel-sources.js — 公开情报源清单（持续更新的 IPTV 聚合仓库）
 * 这些仓库每天自动采集+测速，里面的 m3u 就是"活源"的高价值入口。
 */
const INTEL_SOURCES = [
  { name: 'wnhhh/iptv-list', url: 'https://raw.githubusercontent.com/wnhhh/iptv-list/main/iptv.m3u', status: 'https://raw.githubusercontent.com/wnhhh/iptv-list/main/status.json' },
  { name: 'Guovin/iptv-api', url: 'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u' },
  { name: 'suxuang/myIPTV', url: 'https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u' },
  { name: 'vbskycn/iptv', url: 'https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u' },
  { name: 'Supprise0901/TVBox_live', url: 'https://raw.githubusercontent.com/Supprise0901/TVBox_live/main/live.txt' },
  { name: 'zilong7728/Collect-IPTV', url: 'https://raw.githubusercontent.com/zilong7728/Collect-IPTV/main/live.m3u' },
  { name: 'iptv-org/cn', url: 'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u' },
  { name: 'pro0x400gg/IPTV', url: 'https://raw.githubusercontent.com/pro0x400gg/IPTV/main/IPTV.m3u' },
  { name: 'wangkezun/bj-mobile-iptv', url: 'https://raw.githubusercontent.com/wangkezun/bj-mobile-iptv/main/iptv.m3u' },
  { name: 'shippomx/iptv-udpxy', url: 'https://raw.githubusercontent.com/shippomx/iptv-udpxy/main/iptv.m3u' }
];

module.exports = { INTEL_SOURCES };
