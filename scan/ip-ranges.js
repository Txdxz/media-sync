/**
 * ip-ranges.js — 各省运营商 IP 段白名单（中范围扫描用）
 * 每省取运营商大段，控制总量在几千个 IP，避免大规模探测。
 * 说明：仅用于探测公网暴露的 udpxy（IPTV 组播转单播）服务。
 */
const PROVINCE_RANGES = {
  '山西': ['110.176.0.0/12', '171.8.0.0/12', '183.0.0.0/10'],
  '广东': ['14.16.0.0/12', '113.64.0.0/10', '119.32.0.0/11', '183.0.0.0/10'],
  '江苏': ['49.64.0.0/11', '58.192.0.0/11', '121.224.0.0/12', '180.96.0.0/11'],
  '浙江': ['115.192.0.0/11', '122.224.0.0/12', '183.128.0.0/11'],
  '河南': ['123.4.0.0/14', '171.8.0.0/12', '202.110.0.0/16'],
  '山东': ['112.224.0.0/11', '122.0.0.0/11', '218.56.0.0/13'],
  '四川': ['110.184.0.0/12', '171.208.0.0/12', '222.208.0.0/13'],
  '湖北': ['111.172.0.0/14', '119.96.0.0/11', '171.80.0.0/12'],
  '湖南': ['110.52.0.0/14', '118.248.0.0/13', '222.240.0.0/13'],
  '河北': ['110.240.0.0/12', '121.16.0.0/13', '219.148.0.0/14'],
  '福建': ['110.80.0.0/13', '117.24.0.0/13', '218.64.0.0/14'],
  '安徽': ['114.96.0.0/12', '117.64.0.0/12', '218.22.0.0/15']
};

// 常见 udpxy 端口
const UDPXY_PORTS = [4022, 5140, 8081, 8082, 8088, 8100, 8181, 8188, 8888, 9000, 9999, 8000, 8080];

function ipToInt(ip) { const p = ip.split('.').map(Number); return ((p[0]<<24)>>>0)+(p[1]<<16)+(p[2]<<8)+p[3]; }
function intToIp(v) { return [(v>>>24)&255,(v>>>16)&255,(v>>>8)&255,v&255].join('.'); }

/**
 * 从 CIDR 采样 N 个 IP（均匀步长，避免全段扫描）
 */
function sampleCidr(cidr, count) {
  const [base, bitsStr] = cidr.split('/');
  const bits = Number(bitsStr);
  const baseInt = ipToInt(base);
  const size = Math.pow(2, 32 - bits);
  const step = Math.max(1, Math.floor(size / count));
  const out = [];
  for (let i = 0; i < count; i++) {
    const v = (baseInt + i * step) >>> 0;
    out.push(intToIp(v));
  }
  return out;
}

/**
 * 生成中范围扫描目标：每省每段采样 perSegment 个 IP
 */
function buildScanTargets({ perSegment = 24, provinces = null } = {}) {
  const targets = [];
  const provs = provinces || Object.keys(PROVINCE_RANGES);
  for (const prov of provs) {
    for (const cidr of (PROVINCE_RANGES[prov] || [])) {
      for (const ip of sampleCidr(cidr, perSegment)) {
        targets.push({ province: prov, ip, cidr });
      }
    }
  }
  return targets;
}

module.exports = { PROVINCE_RANGES, UDPXY_PORTS, sampleCidr, buildScanTargets };
