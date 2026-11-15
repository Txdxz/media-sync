/**
 * csv-sources.js — 从 wokaotianshi123/iptv-sources 的 CSV 采集酒店/电信端点
 * CSV 字段：host,ip,port,protocol,title,domain,country,city,link,org
 * title 含"酒店"字样即为酒店源；city 为城市名。
 */
const { request } = require('./http');

const CSV_SOURCES = [
  { name: 'telecom', url: 'https://raw.githubusercontent.com/wokaotianshi123/iptv-sources/main/txiptv.csv', type: '电信组播' },
  { name: 'broadcast', url: 'https://raw.githubusercontent.com/wokaotianshi123/iptv-sources/main/zhgxtv.csv', type: '酒店/广电' }
];

// 城市 → 省份 映射（覆盖 CSV 里出现的主要城市）
const CITY_PROVINCE = {
  Taiyuan:'山西', Datong:'山西', Changzhi:'山西', Linfen:'山西', Yuncheng:'山西', Jinzhong:'山西', Xinzhou:'山西', Lyuliang:'山西', Shuozhou:'山西', Yangquan:'山西', Jincheng:'山西',
  Beijing:'北京', Tianjin:'天津', Shijiazhuang:'河北', Baoding:'河北', Tangshan:'河北', Handan:'河北', Langfang:'河北', Cangzhou:'河北', Xingtai:'河北', Hengshui:'河北',
  Shenyang:'辽宁', Dalian:'辽宁', Anshan:'辽宁', Shenzhen:'广东', Guangzhou:'广东', Zhuhai:'广东', Foshan:'广东', Dongguan:'广东', Huizhou:'广东', Zhongshan:'广东', Shantou:'广东', Zhanjiang:'广东', Jiangmen:'广东', Chaozhou:'广东', Shaoguan:'广东', Maoming:'广东', Meizhou:'广东', Yangjiang:'广东', Heyuan:'广东', Qingyuan:'广东',
  Nanjing:'江苏', Suzhou:'江苏', Wuxi:'江苏', Changzhou:'江苏', Nantong:'江苏', Xuzhou:'江苏', Yangzhou:'江苏', Yancheng:'江苏', Taizhou:'江苏', Zhenjiang:'江苏', Lianyungang:'江苏', Suqian:'江苏',
  Hangzhou:'浙江', Ningbo:'浙江', Wenzhou:'浙江', Jiaxing:'浙江', Shaoxing:'浙江', Jinhua:'浙江', TaizhouZJ:'浙江', Huzhou:'浙江', Lishui:'浙江', Quzhou:'浙江',
  Hefei:'安徽', Wuhu:'安徽', Bengbu:'安徽', Anqing:'安徽', Fuyang:'安徽', SuzhouAH:'安徽',
  Fuzhou:'福建', Xiamen:'福建', Quanzhou:'福建', Zhangzhou:'福建', Putian:'福建', Longyan:'福建', Sanming:'福建', Nanping:'福建', Ningde:'福建',
  Nanchang:'江西', Ganzhou:'江西', Jiujiang:'江西', Shangrao:'江西', Yichun:'江西', JiAn:'江西',
  Jinan:'山东', Qingdao:'山东', Yantai:'山东', Weifang:'山东', Linyi:'山东', Zibo:'山东', Jining:'山东', Taian:'山东', Weihai:'山东', Rizhao:'山东', Dezhou:'山东', Liaocheng:'山东', Heze:'山东', Binzhou:'山东', Zaozhuang:'山东', Dongying:'山东',
  Zhengzhou:'河南', Luoyang:'河南', Kaifeng:'河南', Xinxiang:'河南', Nanyang:'河南', Anyang:'河南', Shangqiu:'河南', Pingdingshan:'河南', Luohe:'河南', Zhoukou:'河南', Zhumadian:'河南', Xuchang:'河南', Jiaozuo:'河南', Sanmenxia:'河南', Puyang:'河南', Hebi:'河南', XinYang:'河南',
  Wuhan:'湖北', Yichang:'湖北', Xiangyang:'湖北', Jingzhou:'湖北', Huangshi:'湖北', Shiyan:'湖北', Xiaogan:'湖北', Huanggang:'湖北', Jingmen:'湖北', Suizhou:'湖北', Xianning:'湖北',
  Changsha:'湖南', Zhuzhou:'湖南', Xiangtan:'湖南', Hengyang:'湖南', Yueyang:'湖南', Changde:'湖南', Shaoyang:'湖南', Loudi:'湖南', Chenzhou:'湖南', Yongzhou:'湖南', Huaihua:'湖南', Yiyang:'湖南', Zhangjiajie:'湖南',
  Nanning:'广西', Guilin:'广西', Liuzhou:'广西', Wuzhou:'广西', Beihai:'广西', YulinGX:'广西',
  Haikou:'海南', Sanya:'海南',
  Chengdu:'四川', Mianyang:'四川', Deyang:'四川', Nanchong:'四川', Yibin:'四川', Luzhou:'四川', Zigong:'四川', Leshan:'四川', Dazhou:'四川', Suining:'四川', Panzhihua:'四川',
  Guiyang:'贵州', Zunyi:'贵州', Liupanshui:'贵州', Anshun:'贵州',
  Kunming:'云南', Qujing:'云南', Yuxi:'云南', Dali:'云南',
  Xian:'陕西', Baoji:'陕西', Xianyang:'陕西', Weinan:'陕西', Hanzhong:'陕西', YulinSX:'陕西', Ankang:'陕西',
  Lanzhou:'甘肃', Tianshui:'甘肃',
  Xining:'青海', Yinchuan:'宁夏', Urumqi:'新疆', Lhasa:'西藏', Hohhot:'内蒙古', Baotou:'内蒙古', Ordos:'内蒙古', Chifeng:'内蒙古',
  Changchun:'吉林', Jilin:'吉林', Siping:'吉林', ShenyangJL:'吉林',
  Harbin:'黑龙江', Qiqihar:'黑龙江', Daqing:'黑龙江', Mudanjiang:'黑龙江',
  Chongqing:'重庆', Shanghai:'上海', GuangzhouGD:'广东'
};

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(',');
  const idx = (name) => header.indexOf(name);
  const iHost = idx('host'), iIp = idx('ip'), iPort = idx('port'), iProto = idx('protocol'), iTitle = idx('title'), iCity = idx('city'), iLink = idx('link'), iOrg = idx('org');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    if (c.length < 5) continue;
    const ip = c[iIp], port = c[iPort], title = (c[iTitle] || '').trim(), city = (c[iCity] || '').trim();
    if (!ip || !port) continue;
    const province = CITY_PROVINCE[city] || '';
    const isHotel = /酒店/.test(title);
    out.push({ ip, port: Number(port), protocol: c[iProto] || 'http', title, city, org: c[iOrg] || '', province, link: c[iLink] || `http://${ip}:${port}`, isHotel });
  }
  return out;
}

async function fetchCsvSources(logger = console.log) {
  const all = [];
  for (const s of CSV_SOURCES) {
    const r = await request(s.url, { timeoutMs: 20000, maxBytes: 2 * 1024 * 1024 });
    if (!r.ok || r.status !== 200) { logger(`[csv] FAIL ${s.name} ${r.error || r.status}`); continue; }
    const rows = parseCsv(r.body.toString('utf8'));
    logger(`[csv] ${s.name}: ${rows.length} 条，有省份标签 ${rows.filter(x => x.province).length}`);
    all.push(...rows.map(x => ({ ...x, csvSource: s.name, srcType: s.type })));
  }
  return all;
}

module.exports = { CSV_SOURCES, parseCsv, fetchCsvSources, CITY_PROVINCE };
