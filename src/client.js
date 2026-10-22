/**
 * client.js
 * 目标站点接口客户端
 * 采用原生 https 模块 + curl 自动回退机制，确保在各种沙箱、NAS 或代理环境中均能稳定请求
 */

const https = require('https');
const http = require('http');
const { execFile } = require('child_process');
const { URL } = require('url');
const { generatePaerToken } = require('./token');

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRandomDelay(min, max) {
  if (min >= max) return min;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

class SourceClient {
  constructor(config = {}) {
    this.baseUrl = config.base_url || 'https://iptv.cqshushu.com';
    this.indexPath = config.index_path || '/index.php';
    this.timeoutMs = config.request_timeout_ms || 15000;
    this.userAgent = config.user_agent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
    this.rateLimitRetryCount = config.rate_limit_retry_count !== undefined ? config.rate_limit_retry_count : 2;
    this.rateLimitRetryDelayMs = config.rate_limit_retry_delay_ms !== undefined ? config.rate_limit_retry_delay_ms : 5000;
    this.logger = config.logger || console.log;
  }

  /**
   * 发起 HTTP/HTTPS 请求
   * 优先尝试 Node.js 原生请求，若受沙箱限制无法解析 DNS 则无缝回退至系统 curl
   */
  async _request(requestUrl, options = {}) {
    const parsedUrl = new URL(requestUrl, this.baseUrl);
    const token = generatePaerToken();
    const headers = {
      'User-Agent': this.userAgent,
      'Referer': `${this.baseUrl}${this.indexPath}`,
      'Accept': options.isJson ? 'application/json, text/javascript, */*; q=0.01' : '*/*',
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-TOKEN': token,
      ...(options.headers || {})
    };

    try {
      return await this._nativeRequest(parsedUrl, headers, options);
    } catch (nativeErr) {
      if (nativeErr.code === 'ENOTFOUND' || nativeErr.message.includes('getaddrinfo') || nativeErr.message.includes('ECONNREFUSED')) {
        return await this._curlRequest(parsedUrl.href, headers, options);
      }
      throw nativeErr;
    }
  }

  /**
   * Node.js 原生 HTTP/HTTPS 请求
   */
  _nativeRequest(parsedUrl, headers, options) {
    const isHttps = parsedUrl.protocol === 'https:';
    const requester = isHttps ? https : http;

    return new Promise((resolve, reject) => {
      const req = requester.request(parsedUrl, {
        method: options.method || 'GET',
        headers,
        timeout: options.timeout || this.timeoutMs
      }, (res) => {
        let chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const body = buffer.toString('utf8');

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body
            });
          } else {
            reject(new Error(`HTTP ${res.statusCode} from ${parsedUrl.pathname}: ${body.substring(0, 200)}`));
          }
        });
      });

      req.on('timeout', () => {
        req.destroy(new Error(`Request to ${parsedUrl.href} timed out after ${this.timeoutMs}ms`));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.end();
    });
  }

  /**
   * curl 回退请求（适配部分受限沙箱环境）
   * 使用 -w 获取 HTTP 状态码，避免代理环境产生多重 HTTP 响应头干扰 body 解析
   */
  _curlRequest(targetUrl, headers, options) {
    return new Promise((resolve, reject) => {
      const statusMarker = '---HTTP_STATUS:';
      const args = [
        '-s',
        '-w', `\n${statusMarker}%{http_code}---`,
        '-m', String(Math.floor(this.timeoutMs / 1000))
      ];

      for (const [key, value] of Object.entries(headers)) {
        args.push('-H', `${key}: ${value}`);
      }
      args.push(targetUrl);

      execFile('curl', args, { maxBuffer: 15 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          return reject(new Error(`curl request failed: ${err.message}`));
        }

        const markerIdx = stdout.lastIndexOf(`\n${statusMarker}`);
        if (markerIdx === -1) {
          return resolve({ statusCode: 200, body: stdout });
        }

        const body = stdout.substring(0, markerIdx);
        const markerPart = stdout.substring(markerIdx + statusMarker.length + 1);
        const codeMatch = markerPart.match(/^(\d+)---/);
        const statusCode = codeMatch ? parseInt(codeMatch[1], 10) : 200;

        if (statusCode >= 200 && statusCode < 300) {
          resolve({ statusCode, body });
        } else {
          reject(new Error(`HTTP ${statusCode} (via curl): ${body.substring(0, 200)}`));
        }
      });
    });
  }

  /**
   * 拉取指定省份与分页的源列表 (带频率限制自动退避重试机制)
   */
  async fetchSourceList({ province = 'all', type = 'all', limit = 10, page = 1 } = {}) {
    const searchParams = new URLSearchParams({
      t: type,
      province,
      limit: String(limit),
      page: String(page)
    });

    const targetUrl = `${this.baseUrl}${this.indexPath}?${searchParams.toString()}`;
    const maxAttempts = 1 + Math.max(0, this.rateLimitRetryCount);
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const response = await this._request(targetUrl, { isJson: true });

        let data;
        try {
          data = JSON.parse(response.body);
        } catch (e) {
          throw new Error(`Failed to parse JSON list response: ${e.message}, body preview: ${response.body.substring(0, 150)}`);
        }

        if (data.status !== 'success') {
          const errMsg = data.message || data.status || 'unknown';
          const isRateLimit = errMsg.includes('频繁') || errMsg.includes('稍后') || errMsg.includes('rate');
          if (isRateLimit && attempts < maxAttempts) {
            const jitter = getRandomDelay(500, 1500);
            const waitTime = this.rateLimitRetryDelayMs * attempts + jitter;
            if (this.logger) {
              this.logger(`[Client] ⚠️ 触发网站频率限制【${errMsg}】，正在退避休眠 ${waitTime}ms 后重试 (第 ${attempts}/${maxAttempts - 1} 次重试)...`);
            }
            await sleep(waitTime);
            continue;
          }
          throw new Error(`Site returned error status: ${errMsg}`);
        }

        const html = data.html || '';
        const sources = this._parseTableRows(html);
        const pagination = this._parsePagination(html, page);

        return {
          sources,
          pagination,
          title: data.title
        };
      } catch (err) {
        const isRateLimit = err.message && (err.message.includes('频繁') || err.message.includes('429'));
        if (isRateLimit && attempts < maxAttempts) {
          const jitter = getRandomDelay(500, 1500);
          const waitTime = this.rateLimitRetryDelayMs * attempts + jitter;
          if (this.logger) {
            this.logger(`[Client] ⚠️ 请求异常触发频率限制【${err.message}】，正在退避休眠 ${waitTime}ms 后重试 (第 ${attempts}/${maxAttempts - 1} 次重试)...`);
          }
          await sleep(waitTime);
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * 解析 HTML 表格行
   */
  _parseTableRows(html) {
    const sources = [];
    const rows = html.match(/<tr[\s\S]*?<\/tr>/g) || [];

    for (const row of rows) {
      if (row.includes('<th>')) continue;

      const ipMatch = row.match(/class=["']ip-link["'][^>]*>\s*([0-9.]+)/);
      const onclickMatch = row.match(/onclick=["']gotoIP\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)/);
      const countMatch = row.match(/<td data-label=["']节目数:['"]><strong[^>]*>([0-9]+)<\/strong>/);
      const typeMatch = row.match(/<td data-label=["']类型:['"]>\s*([^<]+?)\s*<\/td>/);
      const onlineTimeMatch = row.match(/<td data-label=["']上线时间:['"]>\s*([^<]+?)\s*<\/td>/);
      const updateTimeMatch = row.match(/<td data-label=["']更新时间:['"]>\s*([^<]+?)\s*<\/td>/);
      const statusMatch = row.match(/<td data-label=["']状态:['"]>[\s\S]*?<span[^>]*class=["']status-badge[^"']*["'][^>]*>\s*([^<]+?)\s*<\/span>/);

      if (ipMatch && onclickMatch) {
        sources.push({
          ip: ipMatch[1].trim(),
          p: onclickMatch[1].trim(),
          t: onclickMatch[2].trim(),
          count: countMatch ? parseInt(countMatch[1].trim(), 10) : 0,
          type: typeMatch ? typeMatch[1].trim() : '',
          online_time: onlineTimeMatch ? onlineTimeMatch[1].trim() : '',
          update_time: updateTimeMatch ? updateTimeMatch[1].trim() : '',
          status: statusMatch ? statusMatch[1].trim() : '未知'
        });
      }
    }

    return sources;
  }

  /**
   * 解析分页信息
   */
  _parsePagination(html, currentPage) {
    const hasNextPage = html.includes('class="pagination-btn">下一页</a>') || html.includes(`page=${currentPage + 1}`);
    const pageMatches = html.match(/page=(\d+)/g) || [];
    let maxPage = currentPage;
    for (const m of pageMatches) {
      const num = parseInt(m.replace('page=', ''), 10);
      if (num > maxPage) maxPage = num;
    }
    return {
      current_page: currentPage,
      max_page: maxPage,
      has_next_page: hasNextPage
    };
  }

  /**
   * 拉取源详情，并提取 s 参数 (带频率限制自动退避重试机制)
   */
  async fetchSourceDetail(p, t) {
    const targetUrl = `${this.baseUrl}${this.indexPath}?p=${encodeURIComponent(p)}&t=${encodeURIComponent(t)}`;
    const maxAttempts = 1 + Math.max(0, this.rateLimitRetryCount);
    let attempts = 0;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const response = await this._request(targetUrl, { isJson: true });

        let data;
        try {
          data = JSON.parse(response.body);
        } catch (e) {
          throw new Error(`Failed to parse JSON detail response: ${e.message}`);
        }

        if (data.status !== 'success' && data.message) {
          const errMsg = data.message;
          const isRateLimit = errMsg.includes('频繁') || errMsg.includes('稍后') || errMsg.includes('rate');
          if (isRateLimit && attempts < maxAttempts) {
            const jitter = getRandomDelay(500, 1500);
            const waitTime = this.rateLimitRetryDelayMs * attempts + jitter;
            if (this.logger) {
              this.logger(`[Client] ⚠️ 获取源详情触发频率限制【${errMsg}】，正在退避休眠 ${waitTime}ms 后重试 (第 ${attempts}/${maxAttempts - 1} 次重试)...`);
            }
            await sleep(waitTime);
            continue;
          }
        }

        const html = data.html || '';
        const match = html.match(/\?s=([^&'"]+)&t=([^&'"]+)/);
        if (!match) {
          throw new Error(`Channel list parameter 's' not found in detail page for p=${p}`);
        }

        const sParam = match[1];
        const tParam = match[2];

        const statusMatch = html.match(/<span class=["']status-badge[^"']*["']>\s*([^<]+?)\s*<\/span>/);
        const status = statusMatch ? statusMatch[1].trim() : null;

        return {
          s: sParam,
          t: tParam,
          status,
          html
        };
      } catch (err) {
        const isRateLimit = err.message && (err.message.includes('频繁') || err.message.includes('429'));
        if (isRateLimit && attempts < maxAttempts) {
          const jitter = getRandomDelay(500, 1500);
          const waitTime = this.rateLimitRetryDelayMs * attempts + jitter;
          if (this.logger) {
            this.logger(`[Client] ⚠️ 获取源详情异常触发频率限制【${err.message}】，正在退避休眠 ${waitTime}ms 后重试...`);
          }
          await sleep(waitTime);
          continue;
        }
        throw err;
      }
    }
  }

  /**
   * 直接下载指定源的完整 M3U 播放列表
   */
  async fetchM3UContent(s, t) {
    const targetUrl = `${this.baseUrl}${this.indexPath}?s=${encodeURIComponent(s)}&t=${encodeURIComponent(t)}&channels=1&format=m3u`;
    const response = await this._request(targetUrl, { isJson: false });
    return response.body;
  }

  /**
   * 检查先前选中的源是否依然存活
   */
  async checkSourceStillAlive(p, t) {
    try {
      const detail = await this.fetchSourceDetail(p, t);
      if (!detail.status) return false;
      if (detail.status === '暂时失效') return false;
      const isAlive = detail.status === '新上线' || /^存活\d+天$/.test(detail.status);
      return { isAlive, status: detail.status, s: detail.s, t: detail.t };
    } catch (e) {
      return { isAlive: false, error: e.message };
    }
  }
}

SourceClient.sleep = sleep;
SourceClient.getRandomDelay = getRandomDelay;

module.exports = SourceClient;
