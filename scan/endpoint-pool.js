/**
 * endpoint-pool.js — udpxy 端点池的构建与持久化
 * 从多渠道收集候选端点（公开源库中出现的、手工字典、历史存活），
 * 持久化为 data/endpoint_pool.json，供每日探活复用。
 */
const fs = require('fs');
const path = require('path');
const { extractEndpoints } = require('./collect');

const ROOT = path.resolve(__dirname, '..');
const POOL_FILE = path.join(ROOT, 'data/endpoint_pool.json');

function loadPool() {
  try { return JSON.parse(fs.readFileSync(POOL_FILE, 'utf8')); } catch (e) { return { endpoints: [] }; }
}

function savePool(pool) {
  const dir = path.dirname(POOL_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(POOL_FILE, JSON.stringify({ updatedAt: new Date().toISOString(), endpoints: pool.endpoints || [] }, null, 2), 'utf8');
}

function mergeEndpoints(...lists) {
  const map = new Map();
  for (const list of lists) {
    for (const e of list || []) {
      if (!e || !e.host || !e.port) continue;
      const key = `${e.host}:${e.port}`;
      const prev = map.get(key) || { host: e.host, port: e.port, hits: 0, sources: [] };
      prev.hits += (e.hits || 1);
      if (e.from && !prev.sources.includes(e.from)) prev.sources.push(e.from);
      map.set(key, prev);
    }
  }
  return Array.from(map.values());
}

module.exports = { loadPool, savePool, mergeEndpoints, POOL_FILE };
