# 复刻站（cqshushu 同构替代）

## 目的
原站宕机时，用自己的源库提供一个**接口同构**的替代站，现有 `client.js` 与电视订阅可直接切过去。

## 组件
- `src/source-db.js`：源库数据结构（id/ip/t/type/频道数/状态/来源）
- `src/build-db.js`：构建源库（本地黄金 M3U + `data/scan_pool.json`）→ `data/source_db.json`
- `src/site.js`：复刻站 HTTP 服务，兼容 `index.php` 三种请求 + `/feed/current.m3u`
- `src/replica-cli.js`：一键启动

## 兼容接口
| 请求 | 返回 |
| :--- | :--- |
| `/index.php?province=xx&limit=10&page=1` | `{status:'success', html:'<table>...'}` |
| `/index.php?p=<id>&t=<type>` | 详情 JSON |
| `/index.php?s=<id>&t=<type>&channels=1&format=m3u` | M3U 文本 |
| `/feed/current.m3u` | 当前订阅 |

## 使用
```bash
node src/build-db.js          # 生成 data/source_db.json
PORT=8090 node src/replica-cli.js
```
把 `config.json` 的 `site.base_urls` 加上 `http://<你的地址>:8090/index.php` 即可作为备源。

## 现状
- 已跑通：本地 184 频道黄金源 → 源库 → 同构接口 → 原 client 正常读取
- 待补：公网源采集（公开组播表/咪咕接口）→ 源库条目更多
