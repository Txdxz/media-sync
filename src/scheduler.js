/**
 * scheduler.js
 * 负责主调度循环：每日定时筛选、任务锁定、状态更新、通知派发与内置 HTTP 服务启停
 */

const fs = require('fs');
const path = require('path');
const SourceClient = require('./client');
const M3uValidator = require('./validator');
const StorageManager = require('./storage');
const Notifier = require('./notifier');
const M3uServer = require('./server');
const { selectOptimalSource } = require('./selector');
const { describeTierChange } = require('./tier-change');

class SyncScheduler {
  constructor(configPath = path.resolve(__dirname, '../config.json')) {
    this.configPath = configPath;
    this.config = this._loadConfig();

    this.client = new SourceClient(this.config.site);
    this.validator = new M3uValidator(this.config.validation);
    this.storage = new StorageManager(this.config.storage);
    this.notifier = new Notifier(this.config.notification);
    this.server = new M3uServer(this.config.server, this.storage, () => this.runJob('manual_http'));

    this.timer = null;
    this.isRunning = false;
  }

  _loadConfig() {
    if (!fs.existsSync(this.configPath)) {
      throw new Error(`配置文件不存在: ${this.configPath}`);
    }
    const content = fs.readFileSync(this.configPath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * 启动调度器与 HTTP 服务
   */
  async start() {
    console.log('====================================================');
    console.log('🚀 订阅源自动化同步与固定订阅服务启动中...');
    console.log(`⏰ 定时计划: 每日北京时间 ${this.config.schedule.daily_time || '17:00'}`);
    console.log(`📢 Webhook: ${this.notifier.getMaskedUrl()}`);
    console.log('====================================================');

    // 1. 启动 HTTP 订阅服务
    try {
      const serverInfo = await this.server.start();
      console.log(`📺 M3U 固定订阅服务已就绪: http://0.0.0.0:${serverInfo.port}${this.config.server.m3u_route}`);
      console.log(`📊 运行状态监控接口: http://0.0.0.0:${serverInfo.port}${this.config.server.status_route}`);
    } catch (err) {
      console.error(`❌ 启动 HTTP 订阅服务失败: ${err.message}`);
    }

    // 2. 检查首次启动执行
    if (this.config.schedule.run_on_startup) {
      console.log('⚡ 配置了首次启动立即执行，正在触发首轮筛选...');
      await this.runJob('startup');
    }

    // 3. 安排下一次每日定时调度
    this._scheduleNextRun();
  }

  /**
   * 计算距离下一次每日目标时间（如 17:00）的毫秒数
   */
  _scheduleNextRun() {
    if (this.timer) clearTimeout(this.timer);

    const [targetHour, targetMinute] = (this.config.schedule.daily_time || '17:00')
      .split(':')
      .map(n => parseInt(n, 10));

    // 使用北京时间计算
    const now = new Date();
    // 转为 UTC 时间戳然后偏移 +8 小时
    const beijingOffsetMs = 8 * 60 * 60 * 1000;
    const beijingTime = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + beijingOffsetMs);

    const targetDate = new Date(beijingTime);
    targetDate.setHours(targetHour, targetMinute, 0, 0);

    // 如果今天的目标时间已经过去，则排在明天
    if (targetDate <= beijingTime) {
      targetDate.setDate(targetDate.getDate() + 1);
    }

    const delayMs = targetDate.getTime() - beijingTime.getTime();
    const hours = (delayMs / (1000 * 60 * 60)).toFixed(2);
    console.log(`⏱️ 下次自动筛选时间: ${targetDate.toLocaleString('zh-CN')} (约 ${hours} 小时后)`);

    this.timer = setTimeout(async () => {
      await this.runJob('scheduled_cron');
      this._scheduleNextRun();
    }, delayMs);
  }

  /**
   * 停止调度器与服务
   */
  async stop() {
    if (this.timer) clearTimeout(this.timer);
    await this.server.stop();
    console.log('🛑 调度服务已停止。');
  }

  /**
   * 执行单次筛选任务
   */
  async runJob(triggerReason = 'manual') {
    if (this.isRunning) {
      console.log('⚠️ 当前已有正在执行的筛选任务，本次请求跳过。');
      return { skipped: true, reason: 'task_already_running' };
    }

    // 并发文件锁保护
    if (!this.storage.acquireLock()) {
      console.log('⚠️ 检测到其他进程正在执行筛选任务 (task.lock)，跳过本次执行。');
      return { skipped: true, reason: 'locked' };
    }

    this.isRunning = true;
    console.log(`\n▶️ 开始执行订阅源筛选任务 [触发来源: ${triggerReason}]...`);

    const prevState = this.storage.loadState();
    const isFirstSuccess = !prevState.last_success_time;
    const lastSource = prevState.current_source;
    const previousTier = lastSource ? lastSource.tier : null;

    try {
      const result = await selectOptimalSource(
        this.client,
        this.validator,
        this.config.priorities,
        lastSource,
        console.log,
        {
          ...(this.config.selection || {}),
          page_delay_min_ms: this.config.site && this.config.site.page_delay_min_ms,
          page_delay_max_ms: this.config.site && this.config.site.page_delay_max_ms,
          candidate_delay_min_ms: this.config.site && this.config.site.candidate_delay_min_ms,
          candidate_delay_max_ms: this.config.site && this.config.site.candidate_delay_max_ms
        }
      );

      if (!result) {
        throw new Error(`所有 ${this.config.priorities.length} 个优先级档位均未能找到可用的订阅源`);
      }

      const fixedUrl = `http://localhost:${this.config.server.port}${this.config.server.m3u_route}`;

      if (result.isRetained) {
        // 沿用旧源：不重写订阅文件，但必须刷新源状态与最近检查时间
        console.log(`✅ 成功沿用现有可用源: ${result.source.type} (${result.source.ip})`);
        this.storage.recordRetention({
          ip: result.source.ip,
          p: result.source.p,
          t: result.source.t,
          s: result.source.s,
          type: result.source.type,
          count: result.source.count,
          status: result.source.status,
          update_time: result.source.update_time,
          tier: result.tier
        });

        // 发送通知（若配置）
        if (this.notifier.shouldNotify({ type: 'success', isRetained: true })) {
          await this.notifier.notifySuccess({
            source: result.source,
            tier: result.tier,
            isRetained: true,
            reason: result.reason,
            tierChange: describeTierChange(previousTier || result.tier, result.tier, { isRetained: true }),
            fixedSubscribeUrl: fixedUrl,
            rawM3uUrl: result.source.s ? `${this.config.site.base_url}${this.config.site.index_path}?s=${result.source.s}&t=${result.source.t}&channels=1&format=m3u` : null,
            channelCount: result.source.count
          });
        }

        return { success: true, isRetained: true, source: result.source };
      } else {
        // 切换并写入新源
        console.log(`💾 正在原子更新 M3U 播放列表...`);
        const sourceMeta = {
          ip: result.source.ip,
          p: result.source.p,
          t: result.source.t,
          s: result.source.s,
          type: result.source.type,
          count: result.channelCount,
          status: result.source.status,
          update_time: result.source.update_time,
          tier: result.tier
        };

        const updateResult = this.storage.atomicUpdateM3u(result.m3uContent, sourceMeta);
        console.log(`✅ M3U 原子更新完成: ${updateResult.currentPath}`);
        console.log(`📁 备份历史快照: ${updateResult.historyBackup}`);

        // 判断是否为新源发生变化
        const isSourceChanged = !lastSource || lastSource.ip !== result.source.ip;

        // 发送成功通知
        if (this.notifier.shouldNotify({ type: 'success', isFirstSuccess, isSourceChanged, isRetained: false })) {
          const rawM3u = `${this.config.site.base_url}${this.config.site.index_path}?s=${result.source.s}&t=${result.source.t}&channels=1&format=m3u`;
          await this.notifier.notifySuccess({
            source: result.source,
            tier: result.tier,
            isRetained: false,
            reason: '成功发现更高优先级或更新的存活源',
            tierChange: describeTierChange(previousTier, result.tier, { isRetained: false }),
            fixedSubscribeUrl: fixedUrl,
            rawM3uUrl: rawM3u,
            channelCount: result.channelCount
          });
        }

        return { success: true, isRetained: false, source: result.source };
      }
    } catch (err) {
      console.error(`❌ 筛选任务失败: ${err.message}`);
      this.storage.recordFailure(err.message);

      const latestState = this.storage.loadState();
      if (this.notifier.shouldNotify({
        type: 'failure',
        consecutiveFailures: latestState.consecutive_failures
      })) {
        await this.notifier.notifyFailure({
          error: err.message,
          consecutiveFailures: latestState.consecutive_failures,
          lastSuccessTime: latestState.last_success_time,
          currentSource: latestState.current_source
        });
      }

      return { success: false, error: err.message };
    } finally {
      this.storage.releaseLock();
      this.isRunning = false;
    }
  }
}

// 支持直接作为脚本运行
if (require.main === module) {
  const scheduler = new SyncScheduler();
  scheduler.start().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });

  process.on('SIGINT', async () => {
    console.log('\n接收到退出信号，正在关闭服务...');
    await scheduler.stop();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await scheduler.stop();
    process.exit(0);
  });
}

module.exports = SyncScheduler;
