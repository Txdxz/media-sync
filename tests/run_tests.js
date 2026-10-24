process.env.NODE_ENV = "test";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");
const SourceClient = require("../src/client");
const { parseSourceType, matchPriorityTier, isStatusAccepted, sortCandidates, selectOptimalSource, PROVINCE_TO_CODE } = require("../src/selector");
const M3uValidator = require("../src/validator");
const StorageManager = require("../src/storage");
const M3uServer = require("../src/server");
const Notifier = require("../src/notifier");
const { describeTierChange } = require("../src/tier-change");

const TEST_DIR = path.resolve(__dirname, "../data/test_env");
function setupTestEnv() { if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true }); fs.mkdirSync(TEST_DIR, { recursive: true }); }
function teardownTestEnv() { if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true, force: true }); }

const mockPriorities = [
  { id: 1, name: "山西太原 山西电信", province: "山西", city: "太原", isp: "电信" },
  { id: 2, name: "山西太原 山西联通", province: "山西", city: "太原", isp: "联通" },
  { id: 3, name: "山西其他城市电信", province: "山西", city_not: "太原", isp: "电信" },
  { id: 4, name: "山西其他城市联通", province: "山西", city_not: "太原", isp: "联通" },
  { id: 5, name: "山西其他城市移动", province: "山西", city_not: "太原", isp: "移动" },
  { id: 6, name: "天津 天津联通", province: "天津", city: "天津", isp: "联通" },
  { id: 7, name: "北京 北京联通", province: "北京", city: "北京", isp: "联通" },
  { id: 8, name: "上海 上海电信", province: "上海", city: "上海", isp: "电信" },
  { id: 9, name: "上海 上海联通", province: "上海", city: "上海", isp: "联通" },
  { id: 10, name: "河南（运营商不限）", province: "河南" },
  { id: 11, name: "吉林（运营商不限）", province: "吉林" },
  { id: 12, name: "内蒙古（运营商不限）", province: "内蒙古" },
  { id: 13, name: "江苏（运营商不限）", province: "江苏" },
  { id: 14, name: "安徽（运营商不限）", province: "安徽" }
];

class MockResponse extends EventEmitter {
  constructor() { super(); this.headers = {}; this.statusCode = 0; this.body = ""; }
  writeHead(status, headers) { this.statusCode = status; this.headers = headers; }
  end(content) { this.body = content; this.emit("finish"); }
}

async function runAllTests() {
  console.log("🧪 开始执行全覆盖自动化测试套件...\n");
  let passedCount = 0;
  function testCase(name, fn) { fn(); console.log(`  ✅ [PASS] ${name}`); passedCount++; }
  async function testCaseAsync(name, fn) { await fn(); console.log(`  ✅ [PASS] ${name}`); passedCount++; }

  testCase("测试 1: 严格区分山西与陕西，绝不混淆", () => {
    const sx1 = parseSourceType("山西太原酒店 山西联通");
    assert.strictEqual(sx1.province, "山西"); assert.strictEqual(sx1.city, "太原"); assert.strictEqual(sx1.isp, "联通");
    const sn1 = parseSourceType("陕西西安组播 陕西电信");
    assert.strictEqual(sn1.province, "陕西"); assert.strictEqual(sn1.city, "西安"); assert.strictEqual(sn1.isp, "电信");
    assert.strictEqual(matchPriorityTier(sn1, mockPriorities), null);
  });

  testCase("测试 2: 城市与运营商档位匹配逻辑", () => {
    assert.strictEqual(matchPriorityTier(parseSourceType("山西太原组播 山西电信"), mockPriorities).id, 1);
    assert.strictEqual(matchPriorityTier(parseSourceType("山西太原酒店 山西联通"), mockPriorities).id, 2);
    assert.strictEqual(matchPriorityTier(parseSourceType("山西临汾酒店 山西电信"), mockPriorities).id, 3);
    assert.strictEqual(matchPriorityTier(parseSourceType("山西吕梁酒店 山西联通"), mockPriorities).id, 4);
    assert.strictEqual(matchPriorityTier(parseSourceType("山西长治组播 山西移动"), mockPriorities).id, 5);
    assert.strictEqual(matchPriorityTier(parseSourceType("天津组播 天津联通"), mockPriorities).id, 6);
    assert.strictEqual(matchPriorityTier(parseSourceType("北京组播 北京联通"), mockPriorities).id, 7);
    assert.strictEqual(matchPriorityTier(parseSourceType("上海酒店 上海电信"), mockPriorities).id, 8);
    assert.strictEqual(matchPriorityTier(parseSourceType("上海组播 上海联通"), mockPriorities).id, 9);
  });

  testCase("测试 3: 状态过滤规则 (新上线/存活x天 vs 暂时失效)", () => {
    assert.strictEqual(isStatusAccepted("新上线"), true);
    assert.strictEqual(isStatusAccepted("存活1天"), true);
    assert.strictEqual(isStatusAccepted("存活15天"), true);
    assert.strictEqual(isStatusAccepted("暂时失效"), false);
    assert.strictEqual(isStatusAccepted("已离线"), false);
    assert.strictEqual(isStatusAccepted("未知"), false);
  });

  testCase("测试 4: 同档位多候选排序 (更新时间 > 节目数 > 稳定ID)", () => {
    const list = [
      { p: "c", count: 50, update_time: "2026-10-08 10:00:00" },
      { p: "a", count: 80, update_time: "2026-10-08 12:00:00" },
      { p: "b", count: 30, update_time: "2026-10-08 12:00:00" },
      { p: "d", count: 50, update_time: "2026-10-08 10:00:00" }
    ];
    const sorted = sortCandidates(list);
    assert.strictEqual(sorted[0].p, "a"); assert.strictEqual(sorted[1].p, "b");
    assert.strictEqual(sorted[2].p, "c"); assert.strictEqual(sorted[3].p, "d");
  });

  await testCaseAsync("测试 5: M3U 格式校验、频道提取与错误拦截", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 2 });
    assert.strictEqual((await validator.validate("")).isValid, false);
    const r2 = await validator.validate("<!DOCTYPE html><html><body>403</body></html>");
    assert.strictEqual(r2.isValid, false);
    const validM3u = "#EXTM3U\n#EXTINF:-1 tvg-id=\"C1\",C1\nhttp://x.com/1.m3u8?k=1\n#EXTINF:-1 tvg-id=\"C2\",C2\nhttp://x.com/2.m3u8\n";
    const r3 = await validator.validate(validM3u);
    assert.strictEqual(r3.isValid, true);
    assert.strictEqual(r3.channelCount, 2);
    assert.ok(r3.normalizedM3u.includes("k=1"));
  });

  await testCaseAsync("测试 6: 高优先级成功短路机制 (P1 成功不检查后续档位)", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });
    let queried = [];
    const mockClient = {
      async fetchSourceList({ province }) {
        queried.push(province);
        return { sources: [{ ip: "1.1.1.1", p: "p1", t: "hotel", count: 100, type: "山西太原组播 山西电信", status: "新上线", update_time: "2026-10-08 12:00:00" }], pagination: { has_next_page: false } };
      },
      async fetchSourceDetail() { return { s: "s1" }; },
      async fetchM3UContent() { return "#EXTM3U\n#EXTINF:-1,CCTV\nhttp://1.1.1.1/live.m3u8\n"; }
    };
    const res = await selectOptimalSource(mockClient, validator, mockPriorities, null, () => {});
    assert.strictEqual(res.tier.id, 1);
    assert.strictEqual(queried.length, 1);
  });

  await testCaseAsync("测试 7: 高优先级失败自动顺序降级", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });
    const mockClient = {
      async fetchSourceList() {
        return { sources: [{ ip: "2.2.2.2", p: "p2", t: "hotel", count: 88, type: "山西太原酒店 山西联通", status: "新上线", update_time: "2026-10-08 12:00:00" }], pagination: { has_next_page: false } };
      },
      async fetchSourceDetail() { return { s: "s2" }; },
      async fetchM3UContent() { return "#EXTM3U\n#EXTINF:-1,CCTV\nhttp://2.2.2.2/live.m3u8\n"; }
    };
    const res = await selectOptimalSource(mockClient, validator, mockPriorities, null, () => {});
    assert.strictEqual(res.tier.id, 2);
  });

  await testCaseAsync("测试 8: 上期存活源优先沿用机制", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false });
    const lastSource = { ip: "9.9.9.9", p: "lp", t: "hotel", type: "山西太原酒店 山西联通", status: "存活3天", count: 90 };
    const mockClient = {
      async checkSourceStillAlive(p) { return { isAlive: true, status: "存活4天", s: "sl" }; },
      async fetchSourceList() { throw new Error("not called"); }
    };
    const res = await selectOptimalSource(mockClient, validator, mockPriorities, lastSource, () => {});
    assert.strictEqual(res.isRetained, true);
    assert.strictEqual(res.source.status, "存活4天");
  });

  testCase("测试 9: 全部失败保护机制 (保留现有版本，记录失败状态)", () => {
    setupTestEnv();
    const storage = new StorageManager({ data_dir: TEST_DIR, current_m3u_file: path.join(TEST_DIR, "c.m3u"), state_file: path.join(TEST_DIR, "s.json"), history_dir: path.join(TEST_DIR, "h") });
    storage.atomicUpdateM3u("#EXTM3U\n#EXTINF:-1,Old\nhttp://o.com\n", { ip: "old" });
    storage.recordFailure("fail");
    assert.ok(storage.getCurrentM3u().includes("Old"));
    assert.strictEqual(storage.loadState().consecutive_failures, 1);
    teardownTestEnv();
  });

  testCase("测试 10: 冷启动首次运行失败明确提示", () => {
    setupTestEnv();
    const storage = new StorageManager({ data_dir: TEST_DIR, current_m3u_file: path.join(TEST_DIR, "c.m3u"), state_file: path.join(TEST_DIR, "s.json"), history_dir: path.join(TEST_DIR, "h") });
    assert.strictEqual(storage.getCurrentM3u(), null);
    storage.recordFailure("init fail");
    assert.strictEqual(storage.loadState().consecutive_failures, 1);
    teardownTestEnv();
  });

  testCase("测试 11: 任务并发锁获取与释放", () => {
    setupTestEnv();
    const s1 = new StorageManager({ data_dir: TEST_DIR, lock_file: path.join(TEST_DIR, "t.lock") });
    const s2 = new StorageManager({ data_dir: TEST_DIR, lock_file: path.join(TEST_DIR, "t.lock") });
    assert.strictEqual(s1.acquireLock(), true);
    assert.strictEqual(s2.acquireLock(), false);
    s1.releaseLock();
    assert.strictEqual(s2.acquireLock(), true);
    s2.releaseLock();
    teardownTestEnv();
  });

  testCase("测试 12: 内置 HTTP 服务的固定订阅与状态响应", () => {
    setupTestEnv();
    const storage = new StorageManager({ data_dir: TEST_DIR, current_m3u_file: path.join(TEST_DIR, "c.m3u"), state_file: path.join(TEST_DIR, "s.json") });
    storage.atomicUpdateM3u("#EXTM3U\n#EXTINF:-1,C1\nhttp://1\n", { ip: "1.2.3.4" });
    const server = new M3uServer({ port: 8088, m3u_route: "/c.m3u", status_route: "/s" }, storage);
    const resM3u = new MockResponse();
    server._handleRequest({ url: "/c.m3u", headers: { host: "localhost" } }, resM3u);
    assert.strictEqual(resM3u.statusCode, 200);
    const resStatus = new MockResponse();
    server._handleRequest({ url: "/s", headers: { host: "localhost" } }, resStatus);
    assert.strictEqual(resStatus.statusCode, 200);
    assert.strictEqual(JSON.parse(resStatus.body).status, "running");
    teardownTestEnv();
  });

  testCase("测试 13: 同档位组播源权重优先于更新时间与节目数", () => {
    const list = [
      { p: "h1", t: "hotel", type: "山西太原酒店 山西电信", count: 120, update_time: "2026-10-13 12:00:00" },
      { p: "m1", t: "multicast", type: "山西太原组播 山西电信", count: 80, update_time: "2026-10-13 08:00:00" }
    ];
    const sorted = sortCandidates(list);
    assert.strictEqual(sorted[0].p, "m1");
  });

  await testCaseAsync("测试 14: 优先在各档位挑选组播源（阶段 1 命中组播源）", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });
    const mockClient = {
      async fetchSourceList() {
        return {
          sources: [
            { ip: "1.1.1.1", p: "h1", t: "hotel", count: 100, type: "山西太原酒店 山西电信", status: "新上线", update_time: "2026-10-13 12:00:00" },
            { ip: "3.3.3.3", p: "m1", t: "multicast", count: 119, type: "山西临汾组播 山西电信", status: "新上线", update_time: "2026-10-13 08:00:00" }
          ],
          pagination: { has_next_page: false }
        };
      },
      async fetchSourceDetail() { return { s: "sm" }; },
      async fetchM3UContent() { return "#EXTM3U\n#EXTINF:-1,C\nhttp://3.3.3.3/rtp\n"; }
    };
    const res = await selectOptimalSource(mockClient, validator, mockPriorities, null, () => {}, { prefer_multicast: true });
    assert.strictEqual(res.source.p, "m1");
  });

  await testCaseAsync("测试 15: 上期为非组播源时平滑升级到组播源，无组播源时安全回退", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });
    const lastHotel = { ip: "2.2.2.2", p: "lh", t: "hotel", type: "山西太原酒店 山西联通", status: "存活3天", count: 90 };
    const mockClient = {
      async checkSourceStillAlive() { return { isAlive: true, status: "存活4天" }; },
      async fetchSourceList() {
        return {
          sources: [{ ip: "4.4.4.4", p: "nm", t: "multicast", count: 119, type: "山西太原组播 山西电信", status: "新上线", update_time: "2026-10-13 09:00:00" }],
          pagination: { has_next_page: false }
        };
      },
      async fetchSourceDetail() { return { s: "sn" }; },
      async fetchM3UContent() { return "#EXTM3U\n#EXTINF:-1,C\nhttp://4/rtp\n"; }
    };
    const resA = await selectOptimalSource(mockClient, validator, mockPriorities, lastHotel, () => {}, { prefer_multicast: true });
    assert.strictEqual(resA.isRetained, false);
    assert.strictEqual(resA.source.p, "nm");

    const mockClientNoMulti = {
      async checkSourceStillAlive() { return { isAlive: true, status: "存活4天" }; },
      async fetchSourceList() { return { sources: [], pagination: { has_next_page: false } }; }
    };
    const resB = await selectOptimalSource(mockClientNoMulti, validator, mockPriorities, lastHotel, () => {}, { prefer_multicast: true });
    assert.strictEqual(resB.isRetained, true);
    assert.strictEqual(resB.source.p, "lh");
  });

  await testCaseAsync("测试 16: 网站频率限制自动退避重试机制", async () => {
    let callCount = 0;
    const client = new SourceClient({ rate_limit_retry_count: 2, rate_limit_retry_delay_ms: 10, logger: () => {} });
    client._request = async function() {
      callCount++;
      if (callCount === 1) return { statusCode: 200, body: JSON.stringify({ status: "error", message: "翻页过于频繁，请稍后再试。" }) };
      return { statusCode: 200, body: JSON.stringify({ status: "success", html: "<tr><td><a class=\"ip-link\" onclick=\"gotoIP('p1', 'm')\">1.1.1.1</a></td><td data-label=\"类型:\">山西太原组播 山西电信</td><td data-label=\"节目数:\"><strong>100</strong></td><td data-label=\"状态:\"><span class=\"status-badge\">新上线</span></td></tr>" }) };
    };
    const result = await client.fetchSourceList({ province: "sx", page: 1 });
    assert.strictEqual(callCount, 2);
    assert.strictEqual(result.sources[0].ip, "1.1.1.1");
  });

  testCase("测试 17: 模拟真人随机休眠延时逻辑计算校验", () => {
    const min = 1500, max = 3000;
    const samples = [];
    for (let i = 0; i < 50; i++) {
      const d = SourceClient.getRandomDelay(min, max);
      assert.ok(d >= min && d <= max);
      samples.push(d);
    }
    assert.ok(new Set(samples).size > 10);
  });

  testCase("测试 18: 新增档位省份解析与运营商不限匹配", () => {
    const cases = [
      ["河南郑州组播 河南联通", "河南", 10],
      ["吉林长春酒店 吉林电信", "吉林", 11],
      ["内蒙古呼和浩特组播 内蒙古移动", "内蒙古", 12],
      ["江苏南京酒店 江苏电信", "江苏", 13],
      ["安徽合肥组播 安徽联通", "安徽", 14]
    ];
    for (const [text, province, id] of cases) {
      const parsed = parseSourceType(text);
      assert.strictEqual(parsed.province, province);
      assert.strictEqual(matchPriorityTier(parsed, mockPriorities).id, id);
    }
    // 湖南不得被误判为河南，江西不得被误判为江苏
    assert.strictEqual(parseSourceType("湖南长沙组播 湖南联通").province, "");
    assert.strictEqual(parseSourceType("江西南昌组播 江西电信").province, "");
  });

  testCase("测试 19: 省份查询代码映射（河南=ha、内蒙古=nm，不得与湖南/江西混淆）", () => {
    assert.strictEqual(PROVINCE_TO_CODE["河南"], "ha");
    assert.strictEqual(PROVINCE_TO_CODE["吉林"], "jl");
    assert.strictEqual(PROVINCE_TO_CODE["内蒙古"], "nm");
    assert.strictEqual(PROVINCE_TO_CODE["江苏"], "js");
    assert.strictEqual(PROVINCE_TO_CODE["安徽"], "ah");
    assert.notStrictEqual(PROVINCE_TO_CODE["河南"], "hn");
    assert.notStrictEqual(PROVINCE_TO_CODE["江苏"], "jx");
  });

  await testCaseAsync("测试 20: 上期组播源存活但更高档位出现组播源时自动升级", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });
    const lastMulti = { ip: "6.6.6.6", p: "old6", t: "multicast", type: "天津组播 天津联通", status: "存活2天", count: 160, tier: { id: 6, name: "天津 天津联通" } };
    const mockClient = {
      async checkSourceStillAlive() { return { isAlive: true, status: "存活3天", s: "s6" }; },
      async fetchSourceList({ province }) {
        if (province === "sx") {
          return {
            sources: [{ ip: "1.1.1.1", p: "new1", t: "multicast", count: 119, type: "山西太原组播 山西电信", status: "新上线", update_time: "2026-10-22 10:00:00" }],
            pagination: { has_next_page: false }
          };
        }
        return { sources: [], pagination: { has_next_page: false } };
      },
      async fetchSourceDetail() { return { s: "s1" }; },
      async fetchM3UContent() { return "#EXTM3U\n#EXTINF:-1,C\nhttp://1/rtp\n"; }
    };
    const res = await selectOptimalSource(mockClient, validator, mockPriorities, lastMulti, () => {}, { prefer_multicast: true });
    assert.strictEqual(res.isRetained, false);
    assert.strictEqual(res.tier.id, 1);
    assert.strictEqual(res.source.p, "new1");
  });

  await testCaseAsync("测试 21: 无更高档位组播时沿用上期源，且不因低档位酒店源而误切", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });
    const lastMulti = { ip: "6.6.6.6", p: "old6", t: "multicast", type: "天津组播 天津联通", status: "存活2天", count: 160, tier: { id: 6, name: "天津 天津联通" } };
    const mockClient = {
      async checkSourceStillAlive() { return { isAlive: true, status: "存活3天", s: "s6" }; },
      async fetchSourceList({ province }) {
        if (province === "sx") {
          return {
            sources: [{ ip: "9.9.9.9", p: "hotel1", t: "hotel", count: 41, type: "山西太原酒店 山西电信", status: "新上线", update_time: "2026-10-22 10:00:00" }],
            pagination: { has_next_page: false }
          };
        }
        return { sources: [], pagination: { has_next_page: false } };
      },
      async fetchSourceDetail() { return { s: "s1" }; },
      async fetchM3UContent() { return "#EXTM3U\n#EXTINF:-1,C\nhttp://9/rtp\n"; }
    };
    const res = await selectOptimalSource(mockClient, validator, mockPriorities, lastMulti, () => {}, { prefer_multicast: true });
    assert.strictEqual(res.isRetained, true);
    assert.strictEqual(res.source.p, "old6");
    assert.strictEqual(res.source.status, "存活3天");
  });

  await testCaseAsync("测试 22: 上期源已是最高档位组播时直接沿用，不再发起档位扫描", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });
    const topMulti = { ip: "1.1.1.1", p: "top1", t: "multicast", type: "山西太原组播 山西电信", status: "存活8天", count: 119, tier: { id: 1, name: "山西太原 山西电信" } };
    let listCalled = false;
    const mockClient = {
      async checkSourceStillAlive() { return { isAlive: true, status: "存活9天", s: "st" }; },
      async fetchSourceList() { listCalled = true; return { sources: [], pagination: { has_next_page: false } }; }
    };
    const res = await selectOptimalSource(mockClient, validator, mockPriorities, topMulti, () => {}, { prefer_multicast: true });
    assert.strictEqual(res.isRetained, true);
    assert.strictEqual(listCalled, false);
  });

  testCase("测试 23: 沿用分支持久化源状态与最近检查时间，且不重写订阅文件", () => {
    setupTestEnv();
    const storage = new StorageManager({ data_dir: TEST_DIR, current_m3u_file: path.join(TEST_DIR, "c.m3u"), state_file: path.join(TEST_DIR, "s.json"), history_dir: path.join(TEST_DIR, "h") });
    storage.atomicUpdateM3u("#EXTM3U\n#EXTINF:-1,C\nhttp://x\n", { ip: "1.1.1.1", p: "p", t: "multicast", status: "新上线", type: "山西太原组播 山西电信" });
    const before = storage.getCurrentM3u();
    const beforeState = storage.loadState();
    assert.ok(beforeState.current_source.last_verified_at);

    storage.recordRetention({ status: "存活5天", s: "s2" });
    const st = storage.loadState();
    assert.strictEqual(st.current_source.status, "存活5天");
    assert.strictEqual(st.current_source.ip, "1.1.1.1");
    assert.strictEqual(st.current_source.s, "s2");
    assert.ok(st.last_check_time);
    assert.strictEqual(st.consecutive_failures, 0);
    assert.strictEqual(st.last_error, null);
    assert.strictEqual(storage.getCurrentM3u(), before);
    teardownTestEnv();
  });

  testCase("测试 24: 档位变化说明（首次 / 升级 / 降级 / 同档位 / 沿用）", () => {
    const p6 = { id: 6, name: "天津 天津联通" };
    const p3 = { id: 3, name: "山西其他城市电信" };

    const initial = describeTierChange(null, p3);
    assert.strictEqual(initial.direction, "initial");
    assert.ok(initial.text.includes("首次选源"));

    const up = describeTierChange(p6, p3);
    assert.strictEqual(up.direction, "upgrade");
    assert.ok(up.text.includes("P6 天津 天津联通 → P3 山西其他城市电信"));
    assert.ok(up.text.includes("向上升级"));

    const down = describeTierChange(p3, p6);
    assert.strictEqual(down.direction, "downgrade");
    assert.ok(down.text.includes("降级切换"));

    const same = describeTierChange(p3, { id: 3, name: "山西其他城市电信" });
    assert.strictEqual(same.direction, "same_tier");
    assert.ok(same.text.includes("同档位更换源"));

    const retained = describeTierChange(p3, p3, { isRetained: true });
    assert.strictEqual(retained.direction, "retained");
    assert.ok(retained.text.includes("维持 P3 山西其他城市电信"));

    assert.strictEqual(describeTierChange(null, null).direction, "unknown");
  });

  testCase("测试 25: 成功通知卡片包含档位变化说明", () => {
    const notifier = new Notifier({ enabled: false });
    const md = notifier.buildSuccessMarkdown({
      source: { ip: "1.1.1.1", type: "山西朔州组播 山西电信", status: "存活4天", update_time: "2026-10-22 19:17:58", count: 119 },
      tier: { id: 3, name: "山西其他城市电信" },
      isRetained: false,
      reason: "新选中最优源",
      tierChange: describeTierChange({ id: 6, name: "天津 天津联通" }, { id: 3, name: "山西其他城市电信" }),
      fixedSubscribeUrl: "http://localhost:8088/feed/current.m3u",
      channelCount: 119
    });
    assert.ok(md.includes("【档位变化】"));
    assert.ok(md.includes("P6 天津 天津联通 → P3 山西其他城市电信"));
    assert.ok(md.includes("向上升级"));
    assert.ok(md.includes("P3 山西其他城市电信"));
  });

  testCase("测试 26: 沿用通知卡片展示维持档位", () => {
    const notifier = new Notifier({ enabled: false });
    const md = notifier.buildSuccessMarkdown({
      source: { ip: "1.1.1.1", type: "山西朔州组播 山西电信", status: "存活5天", count: 119 },
      tier: { id: 3, name: "山西其他城市电信" },
      isRetained: true,
      tierChange: describeTierChange({ id: 3, name: "山西其他城市电信" }, { id: 3, name: "山西其他城市电信" }, { isRetained: true }),
      fixedSubscribeUrl: "http://localhost:8088/feed/current.m3u",
      channelCount: 119
    });
    assert.ok(md.includes("维持 P3 山西其他城市电信"));
    assert.ok(md.includes("沿用当前可用源"));
  });

  await testCaseAsync("测试 27: 上期源状态无法确认时保护性沿用，不触发降级重选", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false });
    const lastMulti = { ip: "1.1.1.1", p: "p3", t: "multicast", type: "山西朔州组播 山西电信", status: "存活4天", count: 119, tier: { id: 3, name: "山西其他城市电信" } };
    let aliveCalls = 0;
    let listCalled = false;
    const mockClient = {
      async checkSourceStillAlive() { aliveCalls++; return { isAlive: false, unknown: true, error: "Request timed out after 30000ms" }; },
      async fetchSourceList() { listCalled = true; throw new Error("should not be called"); }
    };
    const res = await selectOptimalSource(mockClient, validator, mockPriorities, lastMulti, () => {}, { prefer_multicast: true });
    assert.strictEqual(res.isRetained, true);
    assert.strictEqual(res.source.p, "p3");
    assert.ok(res.reason.includes("保护性沿用"));
    assert.strictEqual(aliveCalls, 2);
    assert.strictEqual(listCalled, false);
  });

  await testCaseAsync("测试 28: 省份抓取失败时拒绝降级到更差档位", async () => {
    const validator = new M3uValidator({ enable_stream_probe: false, min_channels_threshold: 1 });
    const lastMulti = { ip: "1.1.1.1", p: "p3", t: "multicast", type: "山西朔州组播 山西电信", status: "存活4天", count: 119, tier: { id: 3, name: "山西其他城市电信" } };
    const mockClient = {
      async checkSourceStillAlive() { return { isAlive: false, status: "暂时失效" }; },
      async fetchSourceList({ province }) {
        if (province === "sx") throw new Error("Request timed out after 30000ms");
        if (province === "nm") {
          return {
            sources: [{ ip: "9.9.9.9", p: "p12", t: "multicast", count: 250, type: "内蒙古呼和浩特组播 内蒙古电信", status: "新上线", update_time: "2026-10-23 10:26:40" }],
            pagination: { has_next_page: false }
          };
        }
        return { sources: [], pagination: { has_next_page: false } };
      },
      async fetchSourceDetail() { return { s: "s12" }; },
      async fetchM3UContent() { return "#EXTM3U\n#EXTINF:-1,C\nhttp://9/rtp\n"; }
    };
    const res = await selectOptimalSource(mockClient, validator, mockPriorities, lastMulti, () => {}, { prefer_multicast: true });
    assert.strictEqual(res, null);
  });

  console.log(`\n🎉 全部 ${passedCount} 个测试用例均 100% 通过！\n`);
}

runAllTests().catch(err => { console.error(err); process.exit(1); });
