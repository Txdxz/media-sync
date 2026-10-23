/**
 * tier-change.js
 * 计算优先级档位变化，供通知中的「档位变化说明」使用。
 * 档位 id 越小优先级越高（P1 最高）。
 */

function normalizeTier(tier) {
  if (!tier || tier.id === undefined || tier.id === null) return null;
  return {
    id: tier.id,
    name: tier.name || `P${tier.id}`
  };
}

function formatTier(tier) {
  if (!tier) return '未知';
  return `P${tier.id} ${tier.name}`;
}

/**
 * @param {object|null} previousTier 上期档位
 * @param {object|null} nextTier 本期档位
 * @param {object} options { isRetained: boolean }
 * @returns {{direction: string, from: object|null, to: object|null, text: string}}
 */
function describeTierChange(previousTier, nextTier, options = {}) {
  const isRetained = Boolean(options.isRetained);
  const from = normalizeTier(previousTier);
  const to = normalizeTier(nextTier);

  if (!from && to) {
    return {
      direction: 'initial',
      from,
      to,
      text: `首次选源：${formatTier(to)}`
    };
  }

  if (!from && !to) {
    return {
      direction: 'unknown',
      from,
      to,
      text: '档位信息缺失'
    };
  }

  if (from && !to) {
    return {
      direction: 'unknown',
      from,
      to,
      text: `上期 ${formatTier(from)}，本期档位信息缺失`
    };
  }

  if (from.id === to.id) {
    if (isRetained) {
      return {
        direction: 'retained',
        from,
        to,
        text: `维持 ${formatTier(to)}（未发现更优组播源）`
      };
    }
    return {
      direction: 'same_tier',
      from,
      to,
      text: `${formatTier(from)} → ${formatTier(to)}（同档位更换源）`
    };
  }

  if (to.id < from.id) {
    return {
      direction: 'upgrade',
      from,
      to,
      text: `${formatTier(from)} → ${formatTier(to)}（⬆️ 向上升级）`
    };
  }

  return {
    direction: 'downgrade',
    from,
    to,
    text: `${formatTier(from)} → ${formatTier(to)}（⬇️ 降级切换）`
  };
}

module.exports = {
  describeTierChange,
  formatTier
};
