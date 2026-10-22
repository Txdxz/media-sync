const http = require('http');
const { URL } = require('url');

class M3uServer {
  constructor(config = {}, storageManager = null, onTriggerUpdate = null) {
    this.port = config.port || 8088;
    this.host = config.host || '0.0.0.0';
    this.m3uRoute = config.m3u_route || '/feed/current.m3u';
    this.statusRoute = config.status_route || '/feed/status';
    this.authToken = config.auth_token || '';
    this.cacheControl = config.cache_control || 'no-cache, no-store, must-revalidate';
    this.storage = storageManager;
    this.onTriggerUpdate = onTriggerUpdate;
    this.server = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this._handleRequest(req, res);
      });

      this.server.listen(this.port, this.host, () => {
        resolve({
          host: this.host,
          port: this.port,
          m3uUrl: `http://localhost:${this.port}${this.m3uRoute}`
        });
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  _handleRequest(req, res) {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (this.authToken) {
      const providedToken = parsedUrl.searchParams.get('token') || req.headers['x-auth-token'];
      if (providedToken !== this.authToken) {
        res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('401 Unauthorized: 无效或缺失订阅访问 Token');
        return;
      }
    }

    if (pathname === this.m3uRoute) {
      const m3uContent = this.storage ? this.storage.getCurrentM3u() : null;
      if (!m3uContent) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('尚无可用播放列表。服务可能处于初次启动或正在筛选中，请稍后重试。');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        'Cache-Control': this.cacheControl,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(m3uContent);
      return;
    }

    if (pathname === this.statusRoute) {
      const state = this.storage ? this.storage.loadState() : {};
      const historyFiles = this.storage ? this.storage.listHistoryFiles() : [];

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(JSON.stringify({
        status: 'running',
        current_state: state,
        available_history_snapshots: historyFiles,
        server_info: {
          m3u_endpoint: this.m3uRoute,
          port: this.port
        }
      }, null, 2));
      return;
    }

    if (pathname === '/feed/trigger') {
      if (typeof this.onTriggerUpdate === 'function') {
        this.onTriggerUpdate()
          .then((result) => {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: true, message: '手动更新完成', result }));
          })
          .catch((err) => {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ success: false, error: err.message }));
          });
        return;
      }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  }
}

module.exports = M3uServer;
