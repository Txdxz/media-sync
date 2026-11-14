/**
 * site.js — 复刻 cqshushu 的同构查询接口 + 简单网页
 * 目的：当原站宕机时，本服务可在同域名/同路径下返回与 cqshushu 兼容的响应，
 * 使现有 client.js(base_urls) 与电视端订阅可直接指向它。
 *
 * 兼容接口：
 *   GET /index.php?province=xx&limit=10&page=1  → {status:'success', html:'<table>...'}
 *   GET /index.php?p=<id>&t=<type>              → 详情（含 s 参数占位）
 *   GET /index.php?s=<id>&t=<type>&channels=1&format=m3u → M3U 文本
 *   GET /feed/current.m3u                        → 当前订阅
 */
const http = require('http');
const { URL } = require('url');

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

class ReplicaSite {
  constructor({ port = 8090, host = '0.0.0.0', sourceDb = [], m3uProvider = null, logger = console.log } = {}) {
    this.port = port;
    this.host = host;
    this.sourceDb = sourceDb;
    this.m3uProvider = m3uProvider;
    this.logger = logger;
    this.server = null;
  }

  setSourceDb(db) { this.sourceDb = db || []; }

  _rowsForProvince(province) {
    const list = this.sourceDb.filter((s) => {
      if (!province || province === 'all') return true;
      const p = s.parsed || {};
      return p.province === province;
    });
    return list;
  }

  _renderTable(list) {
    const rows = list.map((s) => {
      const statusCls = s.status && s.status.includes('失效') ? 'status-bad' : 'status-new';
      return `<tr>` +
        `<td data-label="IP:"><a href="javascript:void(0)" onclick="gotoIP('${esc(s.id)}','${esc(s.t)}')" class="ip-link"> ${esc(s.ip)} </a></td>` +
        `<td data-label="节目数:"><strong>${esc(s.channelCount)}</strong></td>` +
        `<td data-label="类型:">${esc(s.type)}</td>` +
        `<td data-label="上线时间:">${esc(s.updateTime)}</td>` +
        `<td data-label="更新时间:">${esc(s.updateTime)}</td>` +
        `<td data-label="状态:"><span class="status-badge ${statusCls}">${esc(s.status)}</span></td>` +
        `</tr>`;
    }).join('');
    return `<table><thead><tr><th>IP</th><th>节目数</th><th>类型</th><th>上线时间</th><th>更新时间</th><th>状态</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  _handle(req, res) {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = u.pathname;

    // 订阅文件
    if (p === '/feed/current.m3u' || p === '/current.m3u') {
      const m3u = this.m3uProvider ? this.m3uProvider() : null;
      if (!m3u) { res.writeHead(404); return res.end('no playlist'); }
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(m3u);
    }

    // 兼容 cqshushu 的 index.php
    if (p === '/index.php' || p === '/') {
      const q = u.searchParams;
      // 1) M3U 输出
      if (q.get('s') && q.get('format') === 'm3u') {
        const src = this.sourceDb.find((s) => s.id === q.get('s'));
        if (!src) { res.writeHead(404); return res.end('not found'); }
        const m3u = this.m3uProvider ? this.m3uProvider() : null;
        res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8' });
        return res.end(m3u || '');
      }
      // 2) 详情
      if (q.get('p')) {
        const src = this.sourceDb.find((s) => s.id === q.get('p'));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ status: src ? 'success' : 'error', html: src ? `<div>${esc(src.type)}</div>` : '' }));
      }
      // 3) 列表
      const province = q.get('province') || 'all';
      const list = this._rowsForProvince(province);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ status: 'success', html: this._renderTable(list), title: 'Replica' }));
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this._handle(req, res));
      this.server.on('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.logger(`[ReplicaSite] listening http://${this.host}:${this.port}/index.php (sources=${this.sourceDb.length})`);
        resolve({ port: this.port, host: this.host });
      });
    });
  }

  stop() {
    return new Promise((resolve) => { if (this.server) this.server.close(() => resolve()); else resolve(); });
  }
}

module.exports = { ReplicaSite };
