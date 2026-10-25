/**
 * selector.js
 * 负责订阅源的省份城市运营商解析、优先级档位匹配、排序及逐档筛选
 */

const SourceClient = require('./client');
const sleep = SourceClient.sleep || ((ms) => new Promise(res => setTimeout(res, ms)));
const getRandomDelay = SourceClient.getRandomDelay || ((min, max) => Math.floor(Math.random() * (max - min + 1)) + min);

// 山西省下辖地级市清单
const SHANXI_CITIES = [
  '太原', '大同', '阳泉', '长治', '晋城', '朔州', '晋中', '运城', '忻州', '临汾', '吕梁'
];

// 各省份对应的网站查询代码
// 注意：河南为 ha（hn 是湖南）、内蒙古为 nm，切勿按拼音首字母臆测
const PROVINCE_TO_CODE = {
  '山西': 'sx',
  '天津': 'tj',
  '北京': 'bj',
  '上海': 'sh',
  '陕西': 'sn',
  '河南': 'ha',
  '吉林': 'jl',
  '内蒙古': 'nm',
  '江苏': 'js',
  '安徽': 'ah',
  '广东': 'gd'
};

/**
 * 解析源的类型文本（如 "山西太原酒店 山西联通"、"山西吕梁酒店 山西联通"、"北京组播 北京联通"）
 * 严格区分山西与陕西，绝不依靠 IP 推测
 */
function parseSourceType(typeStr = '') {
  const text = String(typeStr).trim();
  let province = '';
  let city = '';
  let isp = '';
  let sourceType = '';

  // 1. 判断省份与直辖市
  if (text.includes('陕西')) {
    province = '陕西';
  } else if (text.includes('山西')) {
    province = '山西';
  } else if (text.includes('北京')) {
    province = '北京';
    city = '北京';
  } else if (text.includes('天津')) {
    province = '天津';
    city = '天津';
  } else if (text.includes('上海')) {
    province = '上海';
    city = '上海';
  } else if (text.includes('重庆')) {
    province = '重庆';
    city = '重庆';
  } else if (text.includes('河南')) {
    province = '河南';
  } else if (text.includes('吉林')) {
    province = '吉林';
  } else if (text.includes('内蒙古')) {
    province = '内蒙古';
  } else if (text.includes('江苏')) {
    province = '江苏';
  } else if (text.includes('安徽')) {
    province = '安徽';
  } else if (text.includes('广东')) {
    province = '广东';
  }

  // 2. 判断城市（特别是山西省内各市）
  if (province === '山西') {
    for (const c of SHANXI_CITIES) {
      if (text.includes(c)) {
        city = c;
        break;
      }
    }
  } else if (province === '陕西') {
    if (text.includes('西安')) city = '西安';
  }

  // 3. 判断运营商
  if (text.includes('电信')) {
    isp = '电信';
  } else if (text.includes('联通')) {
    isp = '联通';
  } else if (text.includes('移动')) {
    isp = '移动';
  } else if (text.includes('广电')) {
    isp = '广电';
  }

  // 4. 判断源类型
  if (text.includes('酒店')) {
    sourceType = '酒店';
  } else if (text.includes('组播')) {
    sourceType = '组播';
  } else if (text.includes('咪咕')) {
    sourceType = '咪咕';
  } else {
    sourceType = '其他';
  }

  return {
    raw: text,
    province,
    city,
    isp,
    sourceType
  };
}

/**
 * 判断候选源状态是否符合要求：
 * - 只接受“新上线”或“存活x天”
 * - 排除“暂时失效”
 */
function isStatusAccepted(status = '') {
  const s = String(status).trim();
  if (!s || s === '暂时失效' || s.includes('失效') || s.includes('离线')) {
    return false;
  }
  return s === '新上线' || /^存活\d+天$/.test(s);
}

/**
 * 匹配源属于哪一个优先级档位 (P1 - P9)
 * 严格按照用户需求定义：
 * P1: 山西太原 山西电信
 * P2: 山西太原 山西联通
 * P3: 山西其他城市电信
 * P4: 山西其他城市联通
 * P5: 山西其他城市移动
 * P6: 天津 天津联通
 * P7: 北京 北京联通
 * P8: 上海 上海电信
 * P9: 上海 上海联通
 */
function matchPriorityTier(parsed, prioritiesConfig = []) {
  if (!parsed || !parsed.province) return null;

  for (const tier of prioritiesConfig) {
    if (tier.province && parsed.province !== tier.province) {
      continue;
    }
    if (tier.city && parsed.city !== tier.city) {
      continue;
    }
    if (tier.city_not && parsed.city === tier.city_not) {
      continue;
    }
    if (tier.isp && parsed.isp !== tier.isp) {
      continue;
    }
    if (tier.isp_not && parsed.isp === tier.isp_not) {
      continue;
    }
    if (tier.source_type && parsed.sourceType !== tier.source_type) {
      continue;
    }
    return tier;
  }

  return null;
}

/**
 * 判定源是否为组播源：
 * - 依据 onclick 参数 t 为 'multicast'
 * - 或类型文本包含 '组播'
 */
function isMulticastSource(source) {
  if (!source) return false;
  // 咪咕源（t=migu）与组播同属“优先源类型”，参与阶段 1 定向巡检与同档位优先排序
  if (source.t === 'multicast' || source.t === 'migu') return true;
  if (source.type && (source.type.includes('组播') || source.type.includes('咪咕'))) return true;
  if (source.parsed && (source.parsed.sourceType === '组播' || source.parsed.sourceType === '咪咕')) return true;
  return false;
}

/**
 * 同档位候选源排序：
 * 1. 组播源优先（组播排在非组播前）；
 * 2. 网站更新时间降序；
 * 3. 更新时间相同，节目数降序；
 * 4. 仍相同，使用稳定标识 p 字典序升序。
 */
function preferredSourceRank(source) {
  if (!source) return 0;
  const isMulti = source.t === 'multicast' ||
    (source.type && source.type.includes('组播')) ||
    (source.parsed && source.parsed.sourceType === '组播');
  if (isMulti) return 2;
  const isMigu = source.t === 'migu' ||
    (source.type && source.type.includes('咪咕')) ||
    (source.parsed && source.parsed.sourceType === '咪咕');
  if (isMigu) return 1;
  return 0;
}

function sortCandidates(candidates = []) {
  return [...candidates].sort((a, b) => {
    // 1. 源类型优先：组播 > 咪咕 > 酒店/其他
    const rankA = preferredSourceRank(a);
    const rankB = preferredSourceRank(b);
    if (rankB !== rankA) {
      return rankB - rankA;
    }

    // 2. 更新时间降序
    const timeA = new Date(a.update_time).getTime() || 0;
    const timeB = new Date(b.update_time).getTime() || 0;
    if (timeB !== timeA) {
      return timeB - timeA;
    }

    // 3. 节目数降序
    const countA = a.count || 0;
    const countB = b.count || 0;
    if (countB !== countA) {
      return countB - countA;
    }

    // 4. 稳定标识 p 字典序升序
    return String(a.p).localeCompare(String(b.p));
  });
}

/**
 * 执行全流程选源
 * @param {object} client - SourceClient 实例
 * @param {object} validator - M3U 验证器实例
 * @param {Array} prioritiesConfig - 优先级配置
 * @param {object|null} lastSelectedSource - 上一次选中的源元数据
 * @param {object} logger - 日志输出函数
 * @param {object} options - 额外选项（如 prefer_multicast）
 */
async function selectOptimalSource(client, validator, prioritiesConfig, lastSelectedSource = null, logger = console.log, options = {}) {
  const preferMulticast = options.prefer_multicast !== false;
  const upgradeProbe = options.upgrade_probe !== false;
  // 可选白名单：限定运营商/省份；为空表示不限制
  const ispAllowlist = Array.isArray(options.isp_allowlist) ? options.isp_allowlist.map(String) : [];
  const provinceAllowlist = Array.isArray(options.province_allowlist) ? options.province_allowlist.map(String) : [];
  const isAllowlisted = (parsed) => {
    if (!parsed) return false;
    if (provinceAllowlist.length && !provinceAllowlist.includes(parsed.province)) return false;
    if (ispAllowlist.length) {
      if (!parsed.isp) return false;
      if (!ispAllowlist.includes(parsed.isp)) return false;
    }
    return true;
  };
  // 城市偏好：同档位内优先尝试指定城市，失败后仍会回退到同档位其他城市
  const preferCities = Array.isArray(options.prefer_cities) ? options.prefer_cities.map(String) : [];
  const preferIps = Array.isArray(options.prefer_ips) ? options.prefer_ips.map(String) : [];
  const sortWithPreference = (candidates) => {
    if (!preferCities.length && !preferIps.length) return sortCandidates(candidates);
    const preferred = candidates.filter(c =>
      (preferCities.length && c.parsed && preferCities.includes(c.parsed.city)) ||
      (preferIps.length && c.ip && preferIps.includes(c.ip))
    );
    if (!preferred.length) return sortCandidates(candidates);
    const preferredSet = new Set(preferred);
    const rest = candidates.filter(c => !preferredSet.has(c));
    return [...sortCandidates(preferred), ...sortCandidates(rest)];
  };
  const disableDelay = options.disable_delay !== undefined
    ? options.disable_delay === true
    : (process.env.NODE_ENV === 'test');
  const pageDelayMinMs = options.page_delay_min_ms !== undefined ? options.page_delay_min_ms : 1500;
  const pageDelayMaxMs = options.page_delay_max_ms !== undefined ? options.page_delay_max_ms : 3000;
  const candidateDelayMinMs = options.candidate_delay_min_ms !== undefined ? options.candidate_delay_min_ms : 1000;
  const candidateDelayMaxMs = options.candidate_delay_max_ms !== undefined ? options.candidate_delay_max_ms : 2000;

  logger(`[Selector] 开始执行订阅源自动化筛选 (组播源优先: ${preferMulticast ? '已开启' : '未开启'}, 向上升级探测: ${upgradeProbe ? '已开启' : '未开启'}, 模拟延时防风控: ${disableDelay ? '未启用' : '已启用'})...`);

  // 规则 3: 检查上期选中的源
  // - 上期为组播源且存活：不再无条件短路。默认先向上探测更高档位是否出现可用组播源，
  //   有则升级，无则安全沿用（可通过 selection.upgrade_probe = false 关闭探测，恢复纯沿用）。
  // - 上期为非组播源（如酒店源）且存活：记录为备用，优先在各档位中搜寻组播源进行升级。
  let survivingBackup = null;
  // 阶段 1 只探测该索引之前的档位（用于上期组播源的向上升级探测）
  let stage1TierLimit = prioritiesConfig.length;
  const prevTier = lastSelectedSource && lastSelectedSource.tier ? lastSelectedSource.tier : null;

  function findTierIndex(source) {
    if (source && source.tier && source.tier.id !== undefined) {
      const idx = prioritiesConfig.findIndex(t => t.id === source.tier.id);
      if (idx !== -1) return idx;
    }
    if (source && source.type) {
      const matched = matchPriorityTier(parseSourceType(source.type), prioritiesConfig);
      if (matched) {
        return prioritiesConfig.findIndex(t => t.id === matched.id);
      }
    }
    return -1;
  }

  if (lastSelectedSource && lastSelectedSource.p && lastSelectedSource.t) {
    logger(`[Selector] 正在复检上次已选源: IP=${lastSelectedSource.ip}, P=${lastSelectedSource.p}, 类型=${lastSelectedSource.type || lastSelectedSource.t}`);
    let aliveCheck = await client.checkSourceStillAlive(lastSelectedSource.p, lastSelectedSource.t);

    // 网络异常/超时不能判定为「源已失效」，先重试一次；仍失败则保护性沿用，绝不降级
    if (aliveCheck && aliveCheck.unknown) {
      const retryDelay = getRandomDelay(2000, 4000);
      logger(`[Selector] ⚠️ 无法确认上期源状态 (${aliveCheck.error || '网络异常'})，${retryDelay}ms 后重试一次...`);
      if (!disableDelay) await sleep(retryDelay);
      aliveCheck = await client.checkSourceStillAlive(lastSelectedSource.p, lastSelectedSource.t);
    }

    if (aliveCheck && aliveCheck.isAlive) {
      const isLastMulti = isMulticastSource(lastSelectedSource);
      const retained = {
        isRetained: true,
        source: {
          ...lastSelectedSource,
          status: aliveCheck.status,
          s: aliveCheck.s || lastSelectedSource.s
        },
        tier: lastSelectedSource.tier || { name: '上期优选源(沿用)' },
        reason: `沿用上期存活源，网站状态为【${aliveCheck.status}】`
      };

      if (!preferMulticast) {
        logger(`[Selector] 上次选中的源当前状态依然存活 (${aliveCheck.status})，触发沿用机制，立即停止当日筛选。`);
        return retained;
      }

      if (isLastMulti && !upgradeProbe) {
        logger(`[Selector] 上次选中的组播源依然存活 (${aliveCheck.status})，已关闭向上探测，直接沿用。`);
        return retained;
      }

      if (isLastMulti) {
        const lastTierIndex = findTierIndex(lastSelectedSource);
        // 档位未知（历史状态缺失）时退化为全量探测，由「同一源」保护避免无意义重写
        stage1TierLimit = lastTierIndex === -1 ? prioritiesConfig.length : lastTierIndex;
        survivingBackup = {
          ...retained,
          reason: `未发现更高档位的可用组播源，平稳沿用上期存活源【${aliveCheck.status}】`
        };
        if (stage1TierLimit === 0) {
          logger(`[Selector] 上期组播源仍存活 (${aliveCheck.status}) 且已处于最高可用档位，直接沿用，无需向上探测。`);
          return survivingBackup;
        }
        logger(`[Selector] 上期组播源仍存活 (${aliveCheck.status})，先向上探测更高档位是否存在更优组播源...`);
      } else {
        logger(`[Selector] 上期源仍存活 (${aliveCheck.status})，但为非组播源。依据【组播源优先】策略暂存为备用，优先在优先级档位中搜寻高稳定性组播源...`);
        survivingBackup = {
          ...retained,
          reason: `未找到更优组播源，平稳回退沿用上期存活源【${aliveCheck.status}】`
        };
        stage1TierLimit = prioritiesConfig.length;
      }
    } else if (aliveCheck && aliveCheck.unknown) {
      logger(`[Selector] ⚠️ 两次都无法确认上期源状态 (${aliveCheck.error || '网络异常'})，触发保护：保留上期源，不执行降级重选。`);
      return {
        isRetained: true,
        source: {
          ...lastSelectedSource,
          s: aliveCheck.s || lastSelectedSource.s
        },
        tier: lastSelectedSource.tier || { name: '上期优选源(沿用)' },
        reason: `网络异常无法确认源状态，保护性沿用上期源（${aliveCheck.error || '未知错误'}）`
      };
    } else {
      logger(`[Selector] 上次选中的源已失效 (${aliveCheck.status || '状态异常'})，开始按优先级档位重新筛选。`);
    }
  }

  // 省份拉取缓存，避免同一省份多档位重复发起 HTTP 请求
  const provinceCache = new Map();
  // 记录抓取失败的省份：只要出现失败，就不能据此断定更高档位不可用，
  // 因而禁止在同一次运行中降到比上期更差的档位（避免网络抖动导致误降级）。
  const failedProvinces = new Set();

  function isDowngradeBlocked(tier) {
    if (failedProvinces.size === 0) return false;
    if (!prevTier || prevTier.id === undefined) return false;
    return tier.id > prevTier.id;
  }

  async function fetchCandidatesForProvince(provinceCode) {
    if (provinceCache.has(provinceCode)) {
      return provinceCache.get(provinceCode);
    }
    if (provinceCache.size > 0 && !disableDelay) {
      const delay = getRandomDelay(pageDelayMinMs, pageDelayMaxMs);
      logger(`[Selector] 省份切换休眠 ${delay}ms (避开频率风控)...`);
      await sleep(delay);
    }
    let allSources = [];
    let currentPage = 1;
    let maxPages = 3;
    while (currentPage <= maxPages) {
      try {
        if (currentPage > 1 && !disableDelay) {
          const delay = getRandomDelay(pageDelayMinMs, pageDelayMaxMs);
          logger(`[Selector] 翻页休眠 ${delay}ms (模拟真实间隔，避开频率风控)...`);
          await sleep(delay);
        }
        const listResult = await client.fetchSourceList({
          province: provinceCode,
          limit: 10,
          page: currentPage
        });
        const sources = listResult.sources || [];
        if (sources.length === 0) break;
        for (const src of sources) {
          if (isStatusAccepted(src.status)) {
            allSources.push({
              ...src,
              parsed: parseSourceType(src.type)
            });
          }
        }
        if (!listResult.pagination || !listResult.pagination.has_next_page) break;
        currentPage++;
      } catch (err) {
        failedProvinces.add(provinceCode);
        logger(`[Selector] 获取省份 [${provinceCode}] 第 ${currentPage} 页失败: ${err.message}`);
        break;
      }
    }
    provinceCache.set(provinceCode, allSources);
    return allSources;
  }

  // 内部辅助函数：验证单个候选源
  async function testCandidate(candidate, tier) {
    try {
      const detail = await client.fetchSourceDetail(candidate.p, candidate.t);
      candidate.s = detail.s;
      const rawM3u = await client.fetchM3UContent(candidate.s, candidate.t);
      const validationResult = await validator.validate(rawM3u, {
        sourceIp: candidate.ip,
        sourceName: candidate.type
      });
      if (validationResult.isValid) {
        logger(`[Selector] ✅ 候选源通过验证！[P${tier.id}] ${candidate.type} (${candidate.ip}), 实际有效频道数: ${validationResult.channelCount}`);
        return {
          isRetained: false,
          source: {
            ...candidate,
            count: validationResult.channelCount
          },
          tier,
          m3uContent: validationResult.normalizedM3u,
          channelCount: validationResult.channelCount,
          validationDetails: validationResult.details,
          reason: `新选中最优源 (优先级 P${tier.id}: ${tier.name}${isMulticastSource(candidate) ? ' [组播源优先]' : ''})`
        };
      } else {
        logger(`[Selector] ❌ 候选源验证未通过: ${validationResult.reason}`);
      }
    } catch (err) {
      logger(`[Selector] ❌ 候选源处理异常: ${err.message}`);
    }
    return null;
  }

  // 阶段 1: 若开启组播优先，按优先级档位依次匹配组播源
  // 上期组播源存活时只探测其之前的档位（stage1TierLimit），避免无意义地重复验证同一批低档位源
  if (preferMulticast) {
    logger(`[Selector] === 阶段 1: 优先级档位组播源定向巡检 (探测前 ${stage1TierLimit}/${prioritiesConfig.length} 个档位) ===`);
    for (let tierIdx = 0; tierIdx < stage1TierLimit; tierIdx++) {
      const tier = prioritiesConfig[tierIdx];
      const provinceCode = PROVINCE_TO_CODE[tier.province] || 'all';
      const allSources = await fetchCandidatesForProvince(provinceCode);
      const multicastCandidates = allSources.filter(src => {
        if (!isMulticastSource(src)) return false;
        if (!isAllowlisted(src.parsed)) return false;
        const matchedTier = matchPriorityTier(src.parsed, [tier]);
        return matchedTier && matchedTier.id === tier.id;
      });

      if (multicastCandidates.length > 0) {
        const sorted = sortWithPreference(multicastCandidates);
        logger(`[Selector] [P${tier.id} 组播] 匹配到 ${sorted.length} 个组播候选源，开始依次验证...`);
        for (let i = 0; i < sorted.length; i++) {
          const cand = sorted[i];
          if (i > 0 && !disableDelay) {
            const delay = getRandomDelay(candidateDelayMinMs, candidateDelayMaxMs);
            logger(`[Selector] 候选源校验休眠 ${delay}ms (模拟点击间隔，避开频率风控)...`);
            await sleep(delay);
          }
          logger(`[Selector] [P${tier.id} 组播候选 ${i + 1}/${sorted.length}] 验证 IP=${cand.ip}, 状态=${cand.status}, 节目数=${cand.count}, 更新时间=${cand.update_time}`);
          const res = await testCandidate(cand, tier);
          if (res) {
            // 存在省份抓取失败时，不允许降到比上期更差的档位
            if (isDowngradeBlocked(tier)) {
              logger(`[Selector] ⚠️ 存在省份抓取失败，候选档位 P${tier.id} 劣于上期 P${prevTier.id}，拒绝降级切换。`);
              return null;
            }
            // 向上探测若命中的仍是上期同一源，维持沿用，避免无意义重写
            if (survivingBackup && lastSelectedSource && res.source.p === lastSelectedSource.p) {
              logger('[Selector] 向上探测命中的仍是上期同一源，维持沿用，避免无意义重写。');
              return survivingBackup;
            }
            return res;
          }
        }
      }
    }
    logger('[Selector] 阶段 1 巡检结束，各优先级档位未找到立即可用的组播源。');
  }

  // 若阶段 1 未能找到可用组播源，但上期存活源（组播或非组播）依然可用，平稳回退沿用上期源
  if (survivingBackup) {
    logger(`[Selector] 未找到更优组播源，平稳回退沿用上期仍存活的源: IP=${survivingBackup.source.ip} (${survivingBackup.source.type})`);
    return survivingBackup;
  }

  // 阶段 2: 常规逐档筛选（非组播或未开启组播优先时的全量候选源）
  logger('[Selector] === 阶段 2: 优先级常规档位降级巡检 ===');
  for (const tier of prioritiesConfig) {
    logger(`[Selector] === 检查优先级 [P${tier.id}] ${tier.name} ===`);
    const provinceCode = PROVINCE_TO_CODE[tier.province] || 'all';
    const allSources = await fetchCandidatesForProvince(provinceCode);
    const tierCandidates = allSources.filter(src => {
      if (!isAllowlisted(src.parsed)) return false;
      const matchedTier = matchPriorityTier(src.parsed, [tier]);
      return matchedTier && matchedTier.id === tier.id;
    });

    if (tierCandidates.length === 0) {
      logger(`[Selector] 优先级 [P${tier.id}] ${tier.name} 未找到符合状态要求的候选源，降级到下一优先级。`);
      continue;
    }

    const sorted = sortWithPreference(tierCandidates);
    logger(`[Selector] 优先级 [P${tier.id}] 匹配到 ${sorted.length} 个候选源，开始依次验证...`);

    for (let i = 0; i < sorted.length; i++) {
      const cand = sorted[i];
      if (i > 0 && !disableDelay) {
        const delay = getRandomDelay(candidateDelayMinMs, candidateDelayMaxMs);
        logger(`[Selector] 候选源校验休眠 ${delay}ms (模拟点击间隔，避开频率风控)...`);
        await sleep(delay);
      }
      logger(`[Selector] [P${tier.id} 候选 ${i + 1}/${sorted.length}] 验证 IP=${cand.ip}, 状态=${cand.status}, 节目数=${cand.count}, 更新时间=${cand.update_time}`);
      const res = await testCandidate(cand, tier);
      if (res) {
        // 存在省份抓取失败时，不允许降到比上期更差的档位
        if (isDowngradeBlocked(tier)) {
          logger(`[Selector] ⚠️ 存在省份抓取失败，候选档位 P${tier.id} 劣于上期 P${prevTier.id}，拒绝降级切换。`);
          return null;
        }
        return res;
      }
    }

    logger(`[Selector] 优先级 [P${tier.id}] 的所有候选源均未通过验证，降级到下一优先级。`);
  }

  logger('[Selector] ⚠️ 所有优先级档位均未能找到可用源！');
  return null;
}

module.exports = {
  SHANXI_CITIES,
  PROVINCE_TO_CODE,
  parseSourceType,
  isStatusAccepted,
  matchPriorityTier,
  isMulticastSource,
  sortCandidates,
  selectOptimalSource
};
