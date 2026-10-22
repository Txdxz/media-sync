const path = require('path');
const SyncScheduler = require('./scheduler');
const StorageManager = require('./storage');
const fs = require('fs');

async function main() {
  const args = process.argv.slice(2);
  const configPath = path.resolve(__dirname, '../config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const storage = new StorageManager(config.storage);

  if (args.includes('--help') || args.length === 0) {
    console.log(`
订阅源自动化同步服务 - 命令行控制工具

使用方法:
  node src/cli.js --run-now            立即触发一轮筛选并更新 M3U
  node src/cli.js --status             查看当前运行状态与当前源元数据
  node src/cli.js --list-history       列出所有可用的历史快照备份
  node src/cli.js --rollback <file>    回滚到指定的历史版本文件
  node src/scheduler.js                启动守护进程 (含定时任务与 HTTP 订阅服务)
`);
    process.exit(0);
  }

  if (args.includes('--run-now')) {
    console.log('⚡ 手动触发立即运行...');
    const scheduler = new SyncScheduler(configPath);
    const res = await scheduler.runJob('manual_cli');
    console.log('\n运行结果:', JSON.stringify(res, null, 2));
    process.exit(res.success ? 0 : 1);
  }

  if (args.includes('--status')) {
    const state = storage.loadState();
    console.log('📊 当前运行状态:\n', JSON.stringify(state, null, 2));
    const m3u = storage.getCurrentM3u();
    if (m3u) {
      const channelLines = m3u.split('\n').filter(l => l.startsWith('#EXTINF:'));
      console.log(`\n📺 当前固定 M3U 订阅包含 ${channelLines.length} 个频道条目。`);
    } else {
      console.log('\n⚠️ 当前尚未生成 M3U 文件。');
    }
    process.exit(0);
  }

  if (args.includes('--list-history')) {
    const files = storage.listHistoryFiles();
    console.log('📁 可用历史快照版本:');
    if (files.length === 0) {
      console.log('  (暂无历史快照)');
    } else {
      files.forEach((f, idx) => console.log(`  [${idx + 1}] ${f}`));
    }
    process.exit(0);
  }

  const rollbackIdx = args.indexOf('--rollback');
  if (rollbackIdx !== -1 && args[rollbackIdx + 1]) {
    const targetFile = args[rollbackIdx + 1];
    console.log(`🔄 正在回滚至版本: ${targetFile}...`);
    try {
      storage.rollbackTo(targetFile);
      console.log('✅ 回滚成功！固定订阅 M3U 文件已替换。');
    } catch (e) {
      console.error(`❌ 回滚失败: ${e.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  console.error('未知参数，使用 --help 查看说明。');
  process.exit(1);
}

main().catch(err => {
  console.error('CLI 执行失败:', err);
  process.exit(1);
});
