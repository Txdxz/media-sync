/**
 * http.js — 极简 HTTP 客户端（支持直连/代理），零依赖
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

function request(urlStr, { timeoutMs = 5000, maxBytes = 64 * 1024, headers = {} } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return resolve({ ok: false, error: 'bad_url' }); }
    const lib = u.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; resolve(r); } };
    const req = lib.request(u, {
      method: 'GET',
      timeout: timeoutMs,
      headers: { 'User-Agent': 'Mozilla/5.0', ...headers }
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        chunks.push(c); size += c.length;
        if (size >= maxBytes) { try { req.destroy(); } catch (e) {} done({ ok: true, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }); }
      });
      res.on('end', () => done({ ok: true, status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', (e) => done({ ok: false, error: e.code || e.message }));
    });
    req.on('timeout', () => { try { req.destroy(); } catch (e) {} done({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => done({ ok: false, error: e.code || e.message }));
    req.end();
  });
}

module.exports = { request };
