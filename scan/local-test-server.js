// 仅用于本地验证 scan 逻辑：起一个假 udpxy + 假频道表
const http = require('http');
const { probeMany } = require('./probe');
const { parseChannelList } = require('./channels');

const FAKE_M3U = `#EXTM3U
#EXTINF:-1 tvg-id="CCTV1" group-title="测试",CCTV1HD
http://127.0.0.1:PORT/rtp/239.1.1.1:1000
#EXTINF:-1 tvg-id="CCTV2" group-title="测试",CCTV2HD
http://127.0.0.1:PORT/rtp/239.1.1.2:1001
`;

const server = http.createServer((req, res) => {
  if (req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('udpxy status\nclients=0\n');
  } else if (req.url === '/' || req.url.startsWith('/status')) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body>udpxy 1.0 Multicast</body></html>');
  } else if (req.url.startsWith('/channels')) {
    res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
    res.end(FAKE_M3U.replace(/PORT/g, server.address().port));
  } else {
    res.writeHead(404); res.end();
  }
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const results = await probeMany([{ host: '127.0.0.1', port }], { concurrency: 4 });
  console.log('probe:', JSON.stringify(results));
  const ch = parseChannelList(FAKE_M3U.replace(/PORT/g, port), { sourceLabel: 'fake' });
  console.log('channels parsed:', ch.length, JSON.stringify(ch[0]));
  server.close();
});
