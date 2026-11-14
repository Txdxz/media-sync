/**
 * subscribe-url.js
 * 生成通知卡片中的订阅地址。
 * suffix: '' = 主地址；'_self' = 自建源地址
 */
function buildSubscribeUrl({ publicBaseUrl, subscribeKey, port, route, suffix = '' }) {
  const base = String(publicBaseUrl || '').trim().replace(/\/+$/, '');
  const key = String(subscribeKey || '').trim().replace(/\.m3u$/i, '');
  if (base && key) {
    return `${base}/${key}${suffix}.m3u`;
  }
  return `http://localhost:${port}${route}`;
}

module.exports = { buildSubscribeUrl };
