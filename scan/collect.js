/**
 * collect.js — 采集器核心（真正的"自己找源"）
 * 步骤：
 *   1) 从多个公开源库拉取已知源（pool 模式）
 *   2) 从这些源里抽取 udpxy 端点指纹（host:port + /rtp/ 组播），归并成端点候选
 *   3) 对端点并发探活 + 抓频道表
 *   4) 把可用频道写入源库
 */
const { request } = require('./http');
const { parseChannelList } = require('./channels');
const { probeEndpoint } = require('./probe');

const PUBLIC_LISTS = [
  'https://raw.githubusercontent.com/Guovin/iptv-api/gd/output/result.m3u',
  'https://raw.githubusercontent.com/suxuang/myIPTV/main/ipv4.m3u',
  'https://raw.githubusercontent.com/vbskycn/iptv/master/tv/iptv4.m3u',
  'https://raw.githubusercontent.com/YanG-1989/m3u/main/Gather.m3u',
  'https://raw.githubusercontent.com/iptv-org/iptv/master/streams/cn.m3u'
];

async function fetchList(url) {
  const r = await request(url, { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 });
  if (!r.ok || r.status !== 200) return { url, ok: false, error: r.error || `http_${r.status}`, channels: [] };
  const text = r.body.toString('utf8');
  return { url, ok: true, channels: parseChannelList(text, { sourceLabel: url }), raw: text };
}

/**
 * 从频道 URL 中抽取 udpxy 端点（host:port）
 * udpxy 特征：/rtp/ 或 /udp/ 路径，前面是 host:port
 */
function extractEndpoints(channels) {
  const eps = new Map();
  for (const ch of channels) {
    const m = ch.url.match(/^(https?):\/\/([^\/:]+):(\d+)\/(rtp|udp)\//i);
    if (m) {
      const key = `${m[2]}:${m[3]}`;
      if (!eps.has(key)) eps.set(key, { host: m[2], port: Number(m[3]), from: ch.source });
    }
  }
  return Array.from(eps.values());
}

module.exports = { PUBLIC_LISTS, fetchList, extractEndpoints };
