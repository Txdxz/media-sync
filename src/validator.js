const http = require('http');
const https = require('https');
const { URL } = require('url');

class M3uValidator {
  constructor(config = {}) {
    this.enableStreamProbe = Boolean(config.enable_stream_probe);
    this.probeChannelsCount = config.probe_channels_count || 3;
    this.probeTimeoutMs = config.probe_timeout_ms || 3000;
    this.minPassChannels = config.min_pass_channels || 1;
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

    if (this.enableStreamProbe) {
      probeResults = await this._probeSampleChannels(channels.slice(0, this.probeChannelsCount));
      if (probeResults.passed < this.minPassChannels) {
        return {
          isValid: false,
          reason: `抽样流探测未通过 (测试 ${probeResults.tested} 个，成功 ${probeResults.passed} 个，最低需要 ${this.minPassChannels} 个)`
        };
      }
    }

    return {
      isValid: true,
      channelCount: channels.length,
      normalizedM3u,
      details: {
        totalChannels: channels.length,
        excludedChannels,
        probe: probeResults
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

  _probeUrl(streamUrl) {
    return new Promise((resolve) => {
      let parsed;
      try {
        parsed = new URL(streamUrl);
      } catch (e) {
        return resolve(false);
      }

      const requester = parsed.protocol === 'https:' ? https : http;
      const req = requester.request(parsed, {
        method: 'GET',
        headers: {
          'User-Agent': 'Lavf/58.76.100',
          'Range': 'bytes=0-1024'
        },
        timeout: this.probeTimeoutMs
      }, (res) => {
        if (res.statusCode >= 200 && res.statusCode < 400) {
          resolve(true);
        } else {
          resolve(false);
        }
        res.destroy();
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });

      req.on('error', () => {
        resolve(false);
      });

      req.end();
    });
  }
}

module.exports = M3uValidator;
