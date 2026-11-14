# 自建扫描引擎（骨架）

零外部依赖的 udpxy 端点扫描器，用于在主源站宕机时提供备选源。

## 模块
- `http.js`：极简 HTTP 客户端
- `probe.js`：并发探活（识别 udpxy）
- `channels.js`：解析 M3U 频道表
- `score.js`：复用 `src/selector` 的档位规则打分
- `endpoints.js`：端点来源（手工字典 + 公开组播表 URL）
- `runner.js`：编排入口，输出 `data/scan_pool.json`

## 用法
```bash
# 只扫手工字典 scan/endpoints.json
node scan/runner.js --manual-only

# 加公开组播表
node scan/runner.js --public-list "https://example.com/list1.txt,https://example.com/list2.txt" --limit 200
```

## 已知限制
- GitHub Actions runner 在海外，探测国内 udpxy/组播成功率偏低。
- 若要提高准确率，把 `runner.js` 放到家庭常开设备运行即可，代码无需改动。
