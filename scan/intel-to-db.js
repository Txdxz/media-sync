/**
 * intel-to-db.js — 把情报源聚合结果转成复刻站可用的源库
 * 读取 data/intel_db.json，转成 source_db 结构（每省一个或多个源），合并本地黄金源。
 */
const fs = require('fs');
const path = require('path');
const { loadSourceDb, mergeSourceDb, saveSourceDb } = require('../src/source-db');
const { fromLocalM3u } = require('../src/source-db');

const ROOT = path.resolve(__dirname, '..');
const INTEL = path.join(ROOT, 'data/intel_db.json');
const DB = path.join(ROOT, 'data/source_db.json');

function intelToSources() {
  if (!fs.existsSync(INTEL)) return [];
  const data = JSON.parse(fs.readFileSync(INTEL, 'utf8'));
  const out = [];
  for (const g of data.groups || []) {
    if (!g.channelCount) continue;
    out.push({
      id: g.id,
      ip: '',
      port: 0,
      t: g.t || 'hotel',
      type: g.type,
      parsed: { province: g.province || '', city: g.city || '', isp: g.isp || '', sourceType: (g.type.match(/(组播|酒店|咪咕)/) || [])[1] || '其他' },
      channelCount: g.channelCount,
      status: g.verified ? `验证${g.verified.ok}/${g.verified.tested}` : '情报采集',
      origin: 'intel',
      updateTime: g.updateTime,
      channels: g.channels
    });
  }
  return out;
}

function rebuild() {
  const intel = intelToSources();
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
  const localFile = path.resolve(ROOT, (cfg.site && cfg.site.backup_m3u_file) || 'data/backup/playlist.m3u');
  const local = fs.existsSync(localFile) ? fromLocalM3u(localFile, { host: 'local', ip: '127.0.0.1' }) : null;
  const db = mergeSourceDb(intel, local ? [local] : []);
  saveSourceDb(db, DB);
  console.log(`[intel-to-db] 源库=${db.length}（情报=${intel.length}, 本地=${local ? 1 : 0}），总频道=${db.reduce((a, s) => a + (s.channelCount || 0), 0)}`);
  return db;
}

if (require.main === module) rebuild();
module.exports = { rebuild, intelToSources };
