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
const { buildSubscribeUrl } = require('./subscribe-url');
const { buildPublishSummary } = require('./publish-summary');

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
   * 主源站全部不可用时的最后兜底：拉取预先配置的备用 M3U 列表
   * 仅在选源完全失败时使用，且必须通过格式校验，绝不覆盖为坏文件
   */
  async _loadBackupM3u() {
    const backupValidator = new M3uValidator({ ...(this.config.validation || {}), enable_stream_probe: false });

    // 1) 优先读本地备用文件（适合内网地址，GitHub 拉不到但本机/家用设备能读）
    const localPath = this.config.site && this.config.site.backup_m3u_file;
    if (localPath) {
      try {
        if (fs.existsSync(localPath)) {
          const text = fs.readFileSync(localPath, 'utf8');
          const result = await backupValidator.validate(text, { sourceIp: '', sourceName: '本地备用文件' });
          if (result.isValid) {
            console.log(`[Scheduler] ✅ 主源不可用，使用本地备用文件: ${localPath} (${result.channelCount} 频道)`);
            return { m3u: result.normalizedM3u, count: result.channelCount, url: localPath };
          }
          console.warn(`[Scheduler] 本地备用文件校验未通过 ${localPath}: ${result.reason}`);
        }
      } catch (e) {
        console.warn(`[Scheduler] 本地备用文件读取失败 ${localPath}: ${e.message.slice(0, 100)}`);
      }
    }

    // 2) 再尝试远程备用 M3U 列表
    const urls = (this.config.site && this.config.site.backup_m3u_urls) || [];
    if (!Array.isArray(urls) || urls.length === 0) return null;
    for (const rawUrl of urls) {
      const url = String(rawUrl || '').trim();
      if (!url) continue;
      try {
        const res = await this.client._request(url, { isJson: false });
        const result = await backupValidator.validate(res.body, { sourceIp: '', sourceName: '备用列表' });
        if (result.isValid) {
          console.log(`[Scheduler] ✅ 主源不可用，使用备用 M3U 列表: ${url} (${result.channelCount} 频道)`);
          return { m3u: result.normalizedM3u, count: result.channelCount, url };
        }
        console.warn(`[Scheduler] 备用 M3U 校验未通过 ${url}: ${result.reason}`);
      } catch (e) {
        console.warn(`[Scheduler] 备用 M3U 拉取失败 ${url}: ${e.message.slice(0, 100)}`);
      }
    }
    return null;
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
    // 统计实际发布的自建源摘要（供通知展示）
    let publishSummary = null;
    try { publishSummary = buildPublishSummary(require('path').resolve(__dirname, '../data/source_db.json')); } catch (e) { /* ignore */ }
    const manualUpdate = /^(1|true)$/i.test(String(process.env.MANUAL_UPDATE || '').trim());
    const forceRefresh = manualUpdate || /^(1|true)$/i.test(String(process.env.FORCE_REFRESH || '').trim());
    const previousSource = prevState.current_source;
    // 强制刷新：忽略上期源，走完整重选并重写订阅文件（用于恢复被冲掉的发布文件）
    const lastSource = forceRefresh ? null : previousSource;
    const previousTier = previousSource ? previousSource.tier : null;

    if (manualUpdate) {
      console.log('🔄 手动换源：跳过沿用、排除当前源、忽略偏好，按优先级选下一个可用源。');
    } else if (forceRefresh) {
      console.log('♻️ 已启用强制刷新：忽略上期沿用，执行完整重选。');
    }

    const selectionOptions = {
      ...(this.config.selection || {}),
      page_delay_min_ms: this.config.site && this.config.site.page_delay_min_ms,
      page_delay_max_ms: this.config.site && this.config.site.page_delay_max_ms,
      candidate_delay_min_ms: this.config.site && this.config.site.candidate_delay_min_ms,
      candidate_delay_max_ms: this.config.site && this.config.site.candidate_delay_max_ms
    };

    if (manualUpdate) {
      // 手动更新意味着对当前源不满意：忽略偏好并排除当前源，确保换一个
      selectionOptions.prefer_ips = [];
      selectionOptions.prefer_cities = [];
      if (previousSource) {
        selectionOptions.exclude_source_p = previousSource.p;
        selectionOptions.exclude_source_ip = previousSource.ip;
      }
      // 可选：/update 山西、/update 广东 限定地区
      const manualRegion = String(process.env.REGION || '').trim();
      if (manualRegion) {
        selectionOptions.province_allowlist = [manualRegion];
        console.log(`🎯 手动换源限定地区：${manualRegion}`);
      }
    }

    // 失败源负缓存：24 小时内失败 >=2 次的源跳过
    const rejectedSources = {};
    try {
      const cachedBad = this.storage.getBadSources(24);
      const effectiveBad = {};
      for (const [key, entry] of Object.entries(cachedBad)) {
        if (entry && (entry.failCount || 0) >= 2) effectiveBad[key] = entry;
      }
      selectionOptions.bad_sources = effectiveBad;
    } catch (e) {
      console.warn(`读取失败源缓存出错: ${e.message}`);
    }
    selectionOptions.on_candidate_rejected = (candidate, tier, reason) => {
      if (!candidate || !candidate.p) return;
      rejectedSources[`${candidate.p}|${candidate.t}`] = { ip: candidate.ip, type: candidate.type, reason };
    };
    if (manualUpdate) {
      // 手动换源允许立即切换，不受“升级稳定门槛”限制
      selectionOptions.min_upgrade_stability_days = 0;
    }

    try {
      const result = await selectOptimalSource(
        this.client,
        this.validator,
        this.config.priorities,
        lastSource,
        console.log,
        selectionOptions
      );

      if (!result) {
        // 最后兜底：主源站全挂时使用预设备用 M3U 列表
        const backup = await this._loadBackupM3u();
        if (backup) {
          const backupMeta = {
            ip: '',
            p: '',
            t: 'backup',
            s: '',
            type: '备用 M3U 列表',
            count: backup.count,
            status: '备用',
            update_time: new Date().toISOString(),
            tier: { id: 0, name: '备用列表' }
          };
          this.storage.atomicUpdateM3u(backup.m3u, backupMeta);
          if (this.notifier.shouldNotify({ type: 'success', isSourceChanged: true })) {
            await this.notifier.notifySuccess({
              source: backupMeta,
              tier: backupMeta.tier,
              isRetained: false,
              reason: `主源不可用，已切换到备用 M3U 列表（${backup.url}）`,
              fixedSubscribeUrl: buildSubscribeUrl({
                publicBaseUrl: process.env.PAGES_BASE_URL,
                subscribeKey: process.env.SUBSCRIBE_KEY,
                port: this.config.server.port,
                route: this.config.server.m3u_route
              }),
              rawM3uUrl: backup.url,
              channelCount: backup.count
            });
          }
          return { success: true, backup: true, source: backupMeta };
        }
        throw new Error(manualUpdate
          ? '手动换源：没有找到除当前源之外的其他可用源，已保留原文件'
          : `所有 ${this.config.priorities.length} 个优先级档位均未能找到可用的订阅源`);
      }

      // 通知里优先展示"自建源"地址：因为原站长期宕机时，实际发布的是自建源
      const fixedUrl = buildSubscribeUrl({
        publicBaseUrl: process.env.PAGES_BASE_URL,
        subscribeKey: process.env.SUBSCRIBE_KEY,
        port: this.config.server.port,
        route: this.config.server.m3u_route,
        suffix: '_self'
      });

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
            channelCount: result.source.count,
            publishSummary
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
            channelCount: result.channelCount,
            publishSummary
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
      try {
        this.storage.recordBadSources(rejectedSources);
      } catch (e) {
        console.warn(`写入失败源缓存出错: ${e.message}`);
      }
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
