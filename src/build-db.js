/**
 * build-db.js — 构建源库（复刻站的数据底座）
 * 输入：本地黄金 M3U + 扫描池
 * 输出：data/source_db.json
 */
const path = require('path');
const fs = require('fs');
const { fromLocalM3u, fromScanPool, mergeSourceDb, saveSourceDb } = require('./source-db');

const ROOT = path.resolve(__dirname, '..');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

function build() {
  const localFile = (CFG.site && CFG.site.backup_m3u_file) || path.join(ROOT, 'data/backup/playlist.m3u');
  const local = fromLocalM3u(path.resolve(ROOT, localFile), { label: 'local-golden', host: 'local', t: 'multicast' });
  const scan = fromScanPool(path.join(ROOT, 'data/scan_pool.json'));
  const db = mergeSourceDb(scan, local ? [local] : []);
  saveSourceDb(db, path.join(ROOT, 'data/source_db.json'));
  console.log(`[build-db] sources=${db.length} (local=${local ? 1 : 0}, scan=${scan.length})`);
  return db;
}

if (require.main === module) build();
module.exports = { build };
