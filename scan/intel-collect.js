/**
 * intel-collect.js — 公开情报源聚合（复刻 cqshushu 的"自己找源"能力）
 *
 * 思路（不用盲扫 IP 段）：
 *   1. 抓取多个持续维护的 IPTV 聚合仓库（它们每天自动采集+测速）
 *   2. 解析成频道列表，按省份/城市/运营商打标签
 *   3. 抽样验证真实可达性（HTTP 状态 + 内容特征）
 *   4. 输出按省份的源库 data/intel_db.json
 *
 * 用法：node scan/intel-collect.js [--verify]
 */
const fs = require('fs');
const path = require('path');
const { INTEL_SOURCES } = require('./intel-sources');
const { request } = require('./http');
const { parseChannelList } = require('./channels');
const { buildTypeString, inferSourceType } = require('./tagger');
const { parseSourceType } = require('../src/selector');
const { makeSourceId } = require('../src/source-db');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data/intel_db.json');

// 常见 txt 格式也解析（"频道名,url" 或 "频道名,url#分组"）
function parseAnything(text, label) {
  const t = text.trim();
  if (t.startsWith('#EXTM3U')) return parseChannelList(t, { sourceLabel: label });
  // txt: 每行 "名称,url" 或 "名称,url,分组"
  const out = [];
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(',');
    if (parts.length < 2) continue;
    const name = parts[0].trim();
    const url = parts[1].trim();
    if (!/^[a-z]+:\/\//i.test(url)) continue;
    out.push({ name, url, group: parts[2] ? parts[2].trim() : '', source: label, isMulticastUrl: /\/rtp\/|\/udp\//i.test(url), isHd: /HD|高清|4K|8K/i.test(name), is4K: /4K|8K|超高清|UHD/i.test(name) });
  }
  return out;
}

function groupAndTag(allChannels) {
  // 按"类型串"聚合；类型串优先从 group-title 推断，否则归到该来源
  const buckets = new Map();
  for (const ch of allChannels) {
    const groupName = ch.group || '';
    let typeStr;
    const parsed = parseSourceType(groupName);
    if (parsed.province) {
      typeStr = buildTypeString(groupName);
    } else {
      typeStr = `${ch.source.split('/').pop()} · ${groupName || '未分组'}`;
    }
    const key = typeStr;
    if (!buckets.has(key)) buckets.set(key, { typeStr, parsed: parseSourceType(typeStr), channels: [], sources: new Set() });
    buckets.get(key).channels.push(ch);
    buckets.get(key).sources.add(ch.source);
  }
  const out = [];
  for (const [key, b] of buckets) {
    out.push({
      id: makeSourceId(key, key),
      type: key,
      province: b.parsed.province || '',
      city: b.parsed.city || '',
      isp: b.parsed.isp || '',
      t: inferSourceType(key, b.channels[0] && b.channels[0].url),
      channelCount: b.channels.length,
      origins: Array.from(b.sources),
      updateTime: new Date().toISOString(),
      channels: b.channels
    });
  }
  return out.sort((a, b) => b.channelCount - a.channelCount);
}

async function verifyChannels(channels, sampleN = 3) {
  let ok = 0, tested = 0;
  for (const ch of channels.slice(0, sampleN)) {
    tested++;
    const r = await request(ch.url, { timeoutMs: 6000, maxBytes: 4096 });
    const body = (r.body || Buffer.alloc(0)).toString('utf8');
    if (r.ok && r.status >= 200 && r.status < 400 && (body.length > 0)) ok++;
  }
  return { tested, ok };
}

(async () => {
  const doVerify = process.argv.includes('--verify');
  const all = [];
  for (const s of INTEL_SOURCES) {
    const r = await request(s.url, { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 });
    if (!r.ok || r.status !== 200) { console.log(`[intel] FAIL ${s.name} ${r.error || r.status}`); continue; }
    const chs = parseAnything(r.body.toString('utf8'), s.name);
    console.log(`[intel] ${s.name}: ${chs.length} 频道`);
    all.push(...chs);
  }
  console.log(`[intel] 合计 ${all.length} 频道`);

  const groups = groupAndTag(all);
  console.log(`[intel] 聚合为 ${groups.length} 个源组`);

  if (doVerify) {
    for (const g of groups.slice(0, 15)) {
      const v = await verifyChannels(g.channels, 3);
      g.verified = v;
      console.log(`[verify] ${g.type}: ${v.ok}/${v.tested}`);
    }
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({ updatedAt: new Date().toISOString(), totalChannels: all.length, groups: groups }, null, 2), 'utf8');
  const byProv = {};
  for (const g of groups) if (g.province) byProv[g.province] = (byProv[g.province] || 0) + g.channelCount;
  console.log(`[intel] 写入 ${OUT}，有省份标签的频道:`, JSON.stringify(byProv));
})().catch((e) => { console.error('[intel] 失败:', e.message); process.exit(1); });
