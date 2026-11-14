/**
 * endpoints.js — 端点来源
 * 1) 手工字典：scan/endpoints.json（{ "hosts": [{host,port}] }）
 * 2) 公开组播表：从配置的 URL 拉取，正则抽出 IP:PORT
 */
const fs = require('fs');
const path = require('path');
const { request } = require('./http');

function loadManual(file = path.join(__dirname, 'endpoints.json')) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (data.hosts || []).map((h) => ({ host: h.host, port: Number(h.port) || 8080, tag: h.tag || 'manual' }));
  } catch (e) {
    return [];
  }
}

async function loadFromPublicLists(urls = []) {
  const found = [];
  for (const u of urls) {
    const r = await request(u, { timeoutMs: 8000, maxBytes: 512 * 1024 });
    if (!r.ok || r.status !== 200) continue;
    const text = r.body.toString('utf8');
    const re = /\b(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b/g;
    let m;
    while ((m = re.exec(text))) {
      found.push({ host: m[1], port: Number(m[2]), tag: u });
    }
  }
  return found;
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((e) => {
    const k = `${e.host}:${e.port}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function collectEndpoints({ publicListUrls = [] } = {}) {
  const manual = loadManual();
  const pub = await loadFromPublicLists(publicListUrls);
  return dedupe([...manual, ...pub]);
}

module.exports = { loadManual, loadFromPublicLists, collectEndpoints, dedupe };
