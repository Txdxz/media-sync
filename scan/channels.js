/**
 * channels.js — 解析 M3U 频道表，统一成内部结构
 */
function parseChannelList(m3uText, { sourceLabel = '' } = {}) {
  if (typeof m3uText !== 'string' || !m3uText.trim().startsWith('#EXTM3U')) return [];
  const lines = m3uText.split(/\r?\n/);
  const out = [];
  let inf = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      inf = line;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (!inf) continue;

    const name = inf.slice(inf.lastIndexOf(',') + 1).trim();
    const tvgId = (inf.match(/tvg-id="([^"]*)"/) || [])[1] || '';
    const group = (inf.match(/group-title="([^"]*)"/) || [])[1] || '';
    out.push({
      name,
      tvgId,
      group,
      url: line,
      source: sourceLabel,
      isMulticastUrl: /\/rtp\/|\/udp\//i.test(line),
      isHd: /HD|高清|4K|8K/i.test(name),
      is4K: /4K|8K|超高清|UHD/i.test(name)
    });
    inf = null;
  }
  return out;
}

module.exports = { parseChannelList };
