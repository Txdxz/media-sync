const fs = require('fs');
const path = require('path');

class StorageManager {
  constructor(config = {}) {
    this.dataDir = path.resolve(config.data_dir || './data');
    this.currentM3uPath = path.resolve(config.current_m3u_file || path.join(this.dataDir, 'current.m3u'));
    this.statePath = path.resolve(config.state_file || path.join(this.dataDir, 'state.json'));
    this.historyDir = path.resolve(config.history_dir || path.join(this.dataDir, 'history'));
    this.lockPath = path.resolve(config.lock_file || path.join(this.dataDir, 'task.lock'));
    this.maxHistoryFiles = config.max_history_files || 7;

    this._ensureDirectories();
  }

  _ensureDirectories() {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
    if (!fs.existsSync(this.historyDir)) {
      fs.mkdirSync(this.historyDir, { recursive: true });
    }
  }

  acquireLock(maxAgeMs = 10 * 60 * 1000) {
    if (fs.existsSync(this.lockPath)) {
      try {
        const stat = fs.statSync(this.lockPath);
        const age = Date.now() - stat.mtimeMs;
        if (age < maxAgeMs) {
          return false;
        }
        fs.unlinkSync(this.lockPath);
      } catch (e) {
      }
    }

    try {
      fs.writeFileSync(this.lockPath, String(process.pid), { flag: 'wx' });
      return true;
    } catch (e) {
      return false;
    }
  }

  releaseLock() {
    if (fs.existsSync(this.lockPath)) {
      try {
        fs.unlinkSync(this.lockPath);
      } catch (e) {
      }
    }
  }

  loadState() {
    if (!fs.existsSync(this.statePath)) {
      return {
        last_run_time: null,
        last_check_time: null,
        last_success_time: null,
        consecutive_failures: 0,
        current_source: null,
        last_error: null
      };
    }
    try {
      const content = fs.readFileSync(this.statePath, 'utf8');
      return JSON.parse(content);
    } catch (e) {
      return {
        last_run_time: null,
        last_check_time: null,
        last_success_time: null,
        consecutive_failures: 0,
        current_source: null,
        last_error: `读取状态失败: ${e.message}`
      };
    }
  }

  saveState(state) {
    const tmpPath = `${this.statePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmpPath, this.statePath);
  }

  atomicUpdateM3u(m3uContent, sourceMetadata = {}) {
    if (!m3uContent || typeof m3uContent !== 'string') {
      throw new Error('不能写入空的 M3U 内容');
    }

    const tmpPath = `${this.currentM3uPath}.tmp`;
    fs.writeFileSync(tmpPath, m3uContent, 'utf8');
    fs.renameSync(tmpPath, this.currentM3uPath);

    const timestamp = new Date().toISOString().replace(/[-:T]/g, '').substring(0, 14);
    const historyFileName = `m3u_${timestamp}.m3u`;
    const historyFilePath = path.join(this.historyDir, historyFileName);
    fs.writeFileSync(historyFilePath, m3uContent, 'utf8');

    this._rotateHistoryFiles();

    const now = new Date().toISOString();
    const currentState = this.loadState();
    currentState.last_run_time = now;
    currentState.last_check_time = now;
    currentState.last_success_time = now;
    currentState.consecutive_failures = 0;
    currentState.current_source = { ...sourceMetadata, last_verified_at: now };
    currentState.last_error = null;
    this.saveState(currentState);

    return {
      currentPath: this.currentM3uPath,
      historyBackup: historyFilePath
    };
  }

  recordFailure(errorMsg) {
    const now = new Date().toISOString();
    const currentState = this.loadState();
    currentState.last_run_time = now;
    currentState.last_check_time = now;
    currentState.consecutive_failures = (currentState.consecutive_failures || 0) + 1;
    currentState.last_error = errorMsg;
    this.saveState(currentState);
  }

  /**
   * 记录「沿用上期存活源」的结果：
   * 不重写订阅文件，但必须刷新源状态与最近检查时间，避免状态面板展示过期信息。
   */
  recordRetention(sourceMetadata = {}) {
    const now = new Date().toISOString();
    const currentState = this.loadState();
    const mergedSource = {
      ...(currentState.current_source || {}),
      ...sourceMetadata,
      last_verified_at: now
    };

    currentState.last_run_time = now;
    currentState.last_check_time = now;
    currentState.consecutive_failures = 0;
    currentState.last_error = null;
    currentState.current_source = mergedSource;
    this.saveState(currentState);
    return mergedSource;
  }

  _rotateHistoryFiles() {
    try {
      const files = fs.readdirSync(this.historyDir)
        .filter(f => f.startsWith('m3u_') && f.endsWith('.m3u'))
        .sort();

      while (files.length > this.maxHistoryFiles) {
        const oldest = files.shift();
        fs.unlinkSync(path.join(this.historyDir, oldest));
      }
    } catch (e) {
    }
  }

  getCurrentM3u() {
    if (!fs.existsSync(this.currentM3uPath)) {
      return null;
    }
    return fs.readFileSync(this.currentM3uPath, 'utf8');
  }

  listHistoryFiles() {
    if (!fs.existsSync(this.historyDir)) return [];
    return fs.readdirSync(this.historyDir)
      .filter(f => f.startsWith('m3u_') && f.endsWith('.m3u'))
      .sort()
      .reverse();
  }

  rollbackTo(historyFileName) {
    const targetFile = path.join(this.historyDir, historyFileName);
    if (!fs.existsSync(targetFile)) {
      throw new Error(`找不到指定的历史快照文件: ${historyFileName}`);
    }

    const content = fs.readFileSync(targetFile, 'utf8');
    const tmpPath = `${this.currentM3uPath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf8');
    fs.renameSync(tmpPath, this.currentM3uPath);

    const currentState = this.loadState();
    currentState.last_run_time = new Date().toISOString();
    currentState.last_error = `已手动回滚至历史版本 ${historyFileName}`;
    this.saveState(currentState);

    return true;
  }
}

module.exports = StorageManager;
