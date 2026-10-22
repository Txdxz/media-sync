const https = require('https');
const { execFile } = require('child_process');
const { URL } = require('url');

class Notifier {
  constructor(config = {}) {
    this.enabled = Boolean(config.enabled);
    this.webhookUrl = process.env.QYWX_WEBHOOK_URL || config.webhook_url || '';
    this.notifyOnFirstSuccess = config.notify_on_first_success !== false;
    this.notifyOnSourceChange = config.notify_on_source_change !== false;
    this.notifyOnAllFailed = config.notify_on_all_failed !== false;
    this.notifyOnConsecutiveFailures = config.notify_on_consecutive_failures || 3;
    this.notifyOnRetainedSame = Boolean(config.notify_on_retained_same);
  }

  getMaskedUrl() {
    if (!this.webhookUrl) return '(未配置)';
    return this.webhookUrl.replace(/key=([a-zA-Z0-9_-]{4})[a-zA-Z0-9_-]+([a-zA-Z0-9_-]{4})/, 'key=$1****$2');
  }

  shouldNotify({ type, isFirstSuccess, isSourceChanged, consecutiveFailures, isRetained }) {
    if (!this.enabled || !this.webhookUrl) return false;

    if (type === 'success') {
      if (isFirstSuccess && this.notifyOnFirstSuccess) return true;
      if (isSourceChanged && this.notifyOnSourceChange) return true;
      if (isRetained && this.notifyOnRetainedSame) return true;
      return false;
    }

    if (type === 'failure') {
      if (this.notifyOnAllFailed) return true;
      if (consecutiveFailures >= this.notifyOnConsecutiveFailures) return true;
      return false;
    }

    return false;
  }

  async notifySuccess(params) {
    const {
      source,
      tier,
      isRetained,
      reason,
      fixedSubscribeUrl,
      rawM3uUrl,
      channelCount
    } = params;

    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const title = isRetained ? '📺 订阅源每日检查：沿用当前可用源' : '🎉 订阅源更新成功：已切换更佳优选源';

    const markdownText = [
      `### ${title}`,
      `> **执行时间**：${timeStr}`,
      `> **更新结果**：${isRetained ? '继续沿用上期源' : '已自动更新并替换'}`,
      '',
      `**【命中优先级】**：<font color="info">${tier ? tier.name : '未知'}</font>`,
      `**【源 IP 端口】**：\`${source.ip || '未知'}\``,
      `**【类型与运营商】**：${source.type || '未知'}`,
      `**【当前状态】**：<font color="comment">${source.status || '正常'}</font>`,
      `**【频道总数】**：**${channelCount || source.count || '未知'}** 个`,
      `**【网站更新时间】**：${source.update_time || '未知'}`,
      '',
      reason ? `> **策略说明**：${reason}\n` : '',
      `**【固定订阅地址】**：`,
      `\`${fixedSubscribeUrl || '请查看服务配置'}\``,
      rawM3uUrl ? `\n[查看原始 M3U 接口](${rawM3uUrl})` : ''
    ].join('\n');

    return this._sendMarkdown(markdownText);
  }

  async notifyFailure(params) {
    const {
      error,
      consecutiveFailures,
      lastSuccessTime,
      currentSource
    } = params;

    const timeStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });

    const markdownText = [
      `### ⚠️ 订阅源自动筛选异常通知`,
      `> **发生时间**：${timeStr}`,
      `> **当前状态**：<font color="warning">所有优先级档位均未能获取有效源</font>`,
      '',
      `**【异常原因】**：${error || '未找到符合条件的存活源'}`,
      `**【连续失败次数】**：${consecutiveFailures} 次`,
      lastSuccessTime ? `**【最后成功时间】**：${new Date(lastSuccessTime).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}` : '**【最后成功时间】**：尚无成功记录',
      currentSource ? `**【当前维持源】**：${currentSource.type || currentSource.ip || '保留历史版本'}` : '',
      '',
      `> 提示：服务已自动保留上一次成功的 M3U 播放列表，未覆盖为空文件。电视端可继续尝试使用原有列表。`
    ].join('\n');

    return this._sendMarkdown(markdownText);
  }

  async _sendMarkdown(content) {
    if (!this.enabled || !this.webhookUrl) return { skipped: true };

    const payload = JSON.stringify({
      msgtype: 'markdown',
      markdown: {
        content
      }
    });

    try {
      return await this._sendNative(payload);
    } catch (nativeErr) {
      return await this._sendViaCurl(payload);
    }
  }

  _sendNative(payload) {
    const parsedUrl = new URL(this.webhookUrl);
    return new Promise((resolve, reject) => {
      const req = https.request(parsedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 8000
      }, (res) => {
        let respData = '';
        res.on('data', chunk => respData += chunk);
        res.on('end', () => {
          resolve({ ok: res.statusCode === 200, response: respData });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Webhook native timeout'));
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(payload);
      req.end();
    });
  }

  _sendViaCurl(payload) {
    return new Promise((resolve) => {
      const args = [
        '-s', '-m', '10',
        '-H', 'Content-Type: application/json',
        '-d', payload,
        this.webhookUrl
      ];

      execFile('curl', args, (err, stdout) => {
        if (err) {
          resolve({ ok: false, error: err.message });
        } else {
          resolve({ ok: true, response: stdout });
        }
      });
    });
  }
}

module.exports = Notifier;
