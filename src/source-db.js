/**
 * source-db.js — 源库（复刻 cqshushu 的核心数据结构）
 * 一个源 = 一条可播放的 IPTV 源，含元数据与状态；
 * 支持从"本地 M3U 文件 / 扫描结果 / 远端站点"三种方式灌入，统一后续选源逻辑复用。
 */
const fs = require('fs');
const path = require('path');
const { parseSourceType } = require('./selector');
const { parseChannelList } = require('../scan/channels');

function makeSourceId(ip, port, type) {
  const crypto = require('crypto');
  return crypto.createHash('md5').update(`${ip}:${port}|${type}`).digest('hex').slice(0, 12);
}

/**
 * 从本地 M3U 文件构建源库条目（适合内网 udpxy：整份列表 → 一个"源"）
 */
function fromLocalM3u(filePath, meta = {}) {
  if (!fs.existsSync(filePath)) return null;
  const text = fs.readFileSync(filePath, 'utf8');
  const channels = parseChannelList(text, { sourceLabel: meta.label || filePath });
  if (!channels.length) return null;

  const groups = {};
  for (const ch of channels) {
    const g = ch.group || meta.displayType || '本地备用';
    groups[g] = (groups[g] || 0) + 1;
  }
  const group = Object.keys(groups)[0] || '本地备用';
  const parsed = parseSourceType(group);
  return {
    id: makeSourceId(meta.host || 'local', meta.port || 0, group),
    ip: meta.ip || '127.0.0.1',
    port: meta.port || 0,
    realHost: meta.host || 'local',
    t: meta.t || 'multicast',
    type: group,
    parsed,
    channelCount: channels.length,
    channels,
    status: '本地可用',
    updateTime: new Date().toISOString(),
    origin: 'local-file',
    filePath
  };
}

/**
 * 从扫描结果（scan_pool.json 的 top 分组）构建源库条目
 */
function fromScanPool(poolPath) {
  if (!fs.existsSync(poolPath)) return [];
  let pool;
  try { pool = JSON.parse(fs.readFileSync(poolPath, 'utf8')); } catch (e) { return []; }
  return (pool.top || []).map((s) => ({
    id: makeSourceId(s.source, 0, s.group),
    ip: String(s.source || '').split(':')[0],
    port: Number(String(s.source || '').split(':')[1]) || 0,
    t: s.isMulticast ? 'multicast' : 'other',
    type: s.group,
    parsed: s.parsed || parseSourceType(s.group),
    channelCount: s.count || 0,
    status: '扫描可用',
    updateTime: pool.generated_at || new Date().toISOString(),
    origin: 'scan',
    score: s.score
  }));
}

/**
 * 合并多来源源库，按 id 去重（后到的覆盖先到的）
 */
function mergeSourceDb(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const s of list || []) {
      if (!s || !s.id) continue;
      map.set(s.id, s);
    }
  }
  return Array.from(map.values());
}

/**
 * 持久化源库
 */
function saveSourceDb(db, filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    count: db.length,
    sources: db
  }, null, 2), 'utf8');
}

function loadSourceDb(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')).sources || [];
  } catch (e) { return []; }
}

module.exports = { makeSourceId, fromLocalM3u, fromScanPool, mergeSourceDb, saveSourceDb, loadSourceDb };
