/**
 * subscribe-url.js
 * 生成通知卡片中的固定订阅地址：
 * - 有 Pages 基础地址与密钥时，使用真实可访问的 Pages 地址
 * - 否则退回本地服务地址（本地调试用）
 */

function buildSubscribeUrl({ publicBaseUrl, subscribeKey, port, route }) {
  const base = String(publicBaseUrl || '').trim().replace(/\/+$/, '');
  const key = String(subscribeKey || '').trim().replace(/\.m3u$/i, '');
  if (base && key) {
    return `${base}/${key}.m3u`;
  }
  return `http://localhost:${port}${route}`;
}

module.exports = { buildSubscribeUrl };
