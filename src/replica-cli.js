#!/usr/bin/env node
/**
 * replica-cli.js — 启动复刻站
 * 先构建源库（本地黄金 M3U + 扫描池），再以同构接口对外服务。
 *   node src/replica-cli.js            # 默认 8090
 *   PORT=8090 node src/replica-cli.js
 */
const path = require('path');
const fs = require('fs');
const { build } = require('./build-db');
const { ReplicaSite } = require('./site');
const { loadSourceDb } = require('./source-db');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8090);
const db = build();
const m3uFile = path.join(ROOT, 'data/backup/playlist.m3u');
const m3uProvider = () => (fs.existsSync(m3uFile) ? fs.readFileSync(m3uFile, 'utf8') : null);

const site = new ReplicaSite({ port: PORT, sourceDb: loadSourceDb(path.join(ROOT, 'data/source_db.json')), m3uProvider });
site.start();
process.on('SIGINT', async () => { await site.stop(); process.exit(0); });
