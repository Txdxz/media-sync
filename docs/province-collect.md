# 各省市源采集（复刻 cqshushu 核心能力）

## 目标
定时从公开渠道采集各省市的组播/酒店源，维护成可按省份查询的源库。

## 数据链路
1. `scan/province-sources.js`：各省公开源列表（GitHub 上按省份维护的 m3u 仓库）
2. `scan/endpoint-db.js`：从这些 m3u 抽出 **udpxy 端点**，每个端点聚成一个"源"（即 cqshushu 的源粒度）
3. `scan/probe-endpoints.js`：云端探活，标记端点当前是否可用
4. `.github/workflows/province-collect.yml`：每日 10:30 自动跑

## 产物（均 gitignore，不入公开仓库）
- `data/endpoint_db.json`：端点源库
- `data/endpoint_probe.json`：探活结果

## 现状
- 已从 6 省公开源抽到 27 个 udpxy 端点（广东6/湖南4/江苏15/海南2）
- 天津/河北/江苏部分是原始 `rtp://`/`igmp://`，需本地网关，无法跨网播
- 云端探活结果见 workflow 产物

## 情报源聚合（2026-11 新增，已验证可行）
盲扫 IP 段实测命中 0（国内外端口/NAT 限制），改走情报源聚合：
- `scan/intel-sources.js`：多个持续维护的 IPTV 聚合仓库（wnhhh/iptv-list、Guovin/iptv-api、suxuang/myIPTV 等）
- `scan/intel-collect.js`：抓取 → 解析 → 按省/市/运营商打标签 → 抽样验证
- `scan/intel-to-db.js`：转成复刻站源库 `data/source_db.json`
- `.github/workflows/intel-collect.yml`：每日 11:00 自动采集+验证+重建源库

实测：7426 频道 / 142 组 / 12 省有标签（河南165/江苏151/广东89/上海67/安徽51/吉林47/北京44/陕西31/内蒙古23/山西15/重庆11/天津9）；抽样验证多个省组 3/3 可播（河南酒店、广东酒店等）。
