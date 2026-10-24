const http = require('http');
const https = require('https');
const { URL } = require('url');

class M3uValidator {
  constructor(config = {}) {
    this.enableStreamProbe = Boolean(config.enable_stream_probe);
    this.probeChannelsCount = config.probe_channels_count || 3;
    this.probeTimeoutMs = config.probe_timeout_ms || 3000;
    this.minPassChannels = config.min_pass_channels || 1;
    this.minProbeBytes = config.min_probe_bytes || 188;
    // enforce: 探测不通过则丢弃该源；warn: 仅记录告警，仍允许选中
    this.probeMode = config.probe_mode === 'enforce' ? 'enforce' : 'warn';
    // 某些源（如咪咕 CDN）在云端不可达、但家庭网络可播，可按来源名豁免流探测
    this.probeExemptKeywords = Array.isArray(config.probe_exempt_keywords)
      ? config.probe_exempt_keywords.map(k => String(k).trim()).filter(Boolean)
      : [];
    this.minChannelsThreshold = config.min_channels_threshold || 5;
    // 按频道名过滤（如 4K/8K），避免电视端解码压力过大导致卡顿；空数组表示不过滤
    this.excludeNameKeywords = Array.isArray(config.exclude_name_keywords)
      ? config.exclude_name_keywords.map(k => String(k).trim()).filter(Boolean)
      : [];
  }

  async validate(m3uContent, context = {}) {
    if (!m3uContent || typeof m3uContent !== 'string') {
      return { isValid: false, reason: 'M3U 内容为空或格式不正确' };
    }

    const trimmed = m3uContent.trim();

    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.includes('<title>安全验证</title>')) {
      return { isValid: false, reason: '内容为 HTML 网页而非有效 M3U 播放列表' };
    }

    if (!trimmed.startsWith('#EXTM3U')) {
      return { isValid: false, reason: '内容缺少 #EXTM3U 头部标识' };
    }

    const lines = trimmed.split(/\r?\n/);
    const channels = [];
    const excludedLineIndexes = new Set();
    const excludeKeywords = this.excludeNameKeywords.map(k => k.toLowerCase());
    let excludedChannels = 0;
    let currentInf = null;
    let currentInfIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('#EXTINF:')) {
        currentInf = line;
        currentInfIndex = i;
      } else if (!line.startsWith('#') && currentInf) {
        const channelName = currentInf.slice(currentInf.lastIndexOf(',') + 1);
        const isExcluded = excludeKeywords.some(k => channelName.toLowerCase().includes(k));
        if (isExcluded) {
          excludedChannels++;
          // 连同 EXTINF 与中间的指令行一起剔除
          for (let j = currentInfIndex; j <= i; j++) excludedLineIndexes.add(j);
        } else {
          channels.push({
            inf: currentInf,
            url: line
          });
        }
        currentInf = null;
        currentInfIndex = -1;
      }
    }

    if (channels.length < this.minChannelsThreshold) {
      return {
        isValid: false,
        reason: `有效频道数量不足 (当前仅 ${channels.length} 个，最低要求 ${this.minChannelsThreshold} 个)`
      };
    }

    const normalizedLines = [];
    normalizedLines.push(lines[0]);

    for (let i = 1; i < lines.length; i++) {
      if (excludedLineIndexes.has(i)) continue;
      const line = lines[i].trim();
      if (!line) {
        normalizedLines.push('');
        continue;
      }

      if (line.startsWith('#')) {
        normalizedLines.push(line);
      } else {
        let fullUrl = line;
        if (!fullUrl.startsWith('http://') && !fullUrl.startsWith('https://') && !fullUrl.startsWith('rtp://') && !fullUrl.startsWith('udp://')) {
          if (context.sourceIp) {
            fullUrl = `http://${context.sourceIp}/${fullUrl.replace(/^\//, '')}`;
          }
        }
        normalizedLines.push(fullUrl);
      }
    }

    const normalizedM3u = normalizedLines.join('\n');

    let probeResults = { tested: 0, passed: 0, skipped: !this.enableStreamProbe };
    let probeWarning = false;

    const probeExempt = this.probeExemptKeywords.some(k => String(context.sourceName || '').includes(k));
    if (probeExempt) {
      probeResults = { tested: 0, passed: 0, skipped: true, exempt: true };
    }
    if (this.enableStreamProbe && !probeExempt) {
      probeResults = await this._probeSampleChannels(channels.slice(0, this.probeChannelsCount));
      if (probeResults.passed < this.minPassChannels) {
        const reason = `抽样流探测未通过 (测试 ${probeResults.tested} 个，成功 ${probeResults.passed} 个，最低需要 ${this.minPassChannels} 个)`;
        if (this.probeMode === 'enforce') {
          return { isValid: false, reason };
        }
        probeWarning = true;
      }
    }

    return {
      isValid: true,
      channelCount: channels.length,
      normalizedM3u,
      details: {
        totalChannels: channels.length,
        excludedChannels,
        probe: probeResults,
        probeExempt,
        probeWarning
      }
    };
  }

  async _probeSampleChannels(samples) {
    let passed = 0;
    for (const item of samples) {
      const ok = await this._probeUrl(item.url);
      if (ok) passed++;
    }
    return {
      tested: samples.length,
      passed,
      skipped: false
    };
  }

  _probeUrl(streamUrl, redirectDepth = 0) {
    return new Promise((resolve) => {
      let parsed;
      try {
        parsed = new URL(streamUrl);
      } catch (e) {
        return resolve(false);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return resolve(false);
      }

      const requester = parsed.protocol === 'https:' ? https : http;
      let settled = false;
      let req = null;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        try { if (req) req.destroy(); } catch (e) { /* ignore */ }
        resolve(ok);
      };

      req = requester.request(parsed, {
        method: 'GET',
        headers: {
          'User-Agent': 'Lavf/58.76.100',
          'Range': `bytes=0-${Math.max(this.minProbeBytes, 188) - 1}`
        },
        timeout: this.probeTimeoutMs
      }, (res) => {
        // 跟随常见 3xx 跳转（咪咕等源会 302 到 HLS 地址）
        if (res.statusCode >= 300 && res.statusCode < 400) {
          const loc = res.headers.location;
          res.resume();
          if (!loc || redirectDepth >= 3) return finish(false);
          let nextUrl;
          try {
            nextUrl = new URL(loc, parsed).toString();
          } catch (e) {
            return finish(false);
          }
          settled = true;
          try { if (req) req.destroy(); } catch (e) { /* ignore */ }
          this._probeUrl(nextUrl, redirectDepth + 1).then(resolve);
          return;
        }
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 400) {
          res.resume();
          return finish(false);
        }
        let buf = Buffer.alloc(0);
        res.on('data', (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          if (buf.length >= this.minProbeBytes) {
            finish(this._isMediaPayload(buf, res.headers['content-type']));
          }
        });
        res.on('end', () => {
          finish(this._isMediaPayload(buf, res.headers['content-type']));
        });
        res.on('error', () => finish(false));
      });

      req.on('timeout', () => finish(false));
      req.on('error', () => finish(false));
      req.end();
    });
  }

  _isMediaPayload(buf, contentType = '') {
    if (!buf || buf.length === 0) return false;
    if (buf[0] === 0x47) return buf.length >= Math.min(this.minProbeBytes, 188); // MPEG-TS sync byte
    const head = buf.slice(0, 16).toString('utf8');
    if (head.startsWith('#EXTM3U')) return true; // HLS playlist
    if (buf.length >= 8 && buf.slice(4, 8).toString('ascii') === 'ftyp') return true; // MP4
    if (buf.length < this.minProbeBytes) return false;
    const ct = String(contentType || '').toLowerCase();
    return ct.includes('mpegurl') || ct.includes('mp2t') || ct.includes('video/mp4');
  }
}

module.exports = M3uValidator;
