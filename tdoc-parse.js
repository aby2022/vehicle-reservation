// 腾讯文档「车辆预约」表 → 预约记录 解析（纯解析，不写任何数据）
// 导出 parseTdoc(dateFrom, dateTo) → { items, rosterSize }
const fs = require('fs');
const path = require('path');

// 腾讯文档令牌：优先用环境变量 TDOC_TOKEN；其次读本地未跟踪文件 .tdoc_token（首行）；
// 不要在此文件硬编码令牌，避免提交到公开仓库泄露。
function readLocalToken() {
  try { return fs.readFileSync(path.join(__dirname, '.tdoc_token'), 'utf8').trim().split('\n')[0]; } catch (e) { return ''; }
}
const TD_TOKEN = process.env.TDOC_TOKEN || readLocalToken();
if (!TD_TOKEN) { console.error('缺少腾讯文档令牌：请设置环境变量 TDOC_TOKEN，或在 vehicle-reservation/.tdoc_token 写入令牌（首行）。'); process.exit(1); }
const FILE_ID = 'UiomNwSjiBEb';
const SHEET_ID = '000001';
const MCP = 'https://docs.qq.com/api/v6/sheet/mcp';

const cfgSrc = fs.readFileSync(path.join(__dirname, 'public', 'gitee-config.js'), 'utf8');
const pick = k => { const m = cfgSrc.match(new RegExp(k + "\\s*:\\s*'([^']+)'")); return m ? m[1] : ''; };
const G = { owner: pick('owner'), repo: pick('repo'), branch: pick('branch'), file: pick('path'), pat: process.env.GITEE_PAT || pick('pat') };

const DISTRICTS = ['东城', '西城', '朝阳', '海淀', '丰台', '石景山', '门头沟', '房山', '通州', '顺义',
  '昌平', '大兴', '平谷', '怀柔', '密云', '延庆', '亦庄', '开发区'];
const PLACES = ['苏家坨', '聂各庄', '台头村', '长辛店', '琉璃庙', '大水峪', '雁栖河', '北台上', '小泉河',
  '菜食河', '云西河', '温榆河', '南沙河', '沙河', '高教园', '巨山路', '青年路', '爨子沟', '七王坟',
  '翠湖湿地', '牤牛河', '妫水河', '云溪', '九子河', '帮水峪', '小东河', '大石河', '土城',
  '怀沙河', '琉璃河', '雁栖', '支沟', '北沙河', '东沙河', '白河', '怀九河', '白河堡', '汤河'];
const EVENT_WORDS = ['开会', '验收', '验槽', '放孔', '查管线', '管线', '核实', '测图', '查图', '看现场',
  '盯现场', '复核', '复测', '补测', '补勘', '放线', '交桩', '交底', '送报告', '查资料', '论证会',
  '测量', '测绘', '现场会', '钻探', '分部', '评估', '鉴定', '对接', '资料', '现场', '项目', '协调', '校核'];
const TIME_SLOT = { 上午: ['08:30', '12:00'], 下午: ['13:00', '17:30'], 晚上: ['18:00', '21:00'], 全天: ['08:30', '17:30'] };
const STATUS_WORDS = new Set(['修理', '维修', '检修', '封存', '停用', '保养', '年检', '待修', '无']);
const SEED_NAMES = ['杨朋广', '陈立新', '鲍兴永', '康国力', '何玉龙', '吕树全', '张玉靖',
  '陈顺', '姜英文', '张子昂', '刘亮', '王立军', '李伟', '张强', '刘建国'];

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
async function mcp(name, args) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TD_TOKEN },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })
  });
  const j = await res.json();
  if (j.error) throw new Error('MCP ' + name + ': ' + JSON.stringify(j.error));
  const sc = j.result && j.result.structuredContent;
  if (sc) return sc;
  const txt = j.result && j.result.content && j.result.content[0] && j.result.content[0].text;
  return txt ? JSON.parse(txt) : {};
}
function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function parseDate(s) {
  const m = String(s || '').match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return '';
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
}
const isCJK = s => /^[一-龥]+$/.test(s);
function segmentByNames(s, names) {
  let out = null;
  const bt = (i, acc) => {
    if (out) return true;
    if (i === s.length) { out = acc.slice(); return true; }
    for (let len = Math.min(4, s.length - i); len >= 2; len--) {
      const w = s.slice(i, i + len);
      if (names.has(w)) { acc.push(w); if (bt(i + len, acc)) return true; acc.pop(); }
    }
    return false;
  };
  bt(0, []);
  return out;
}
function splitNames(raw, names) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const out = [];
  for (const part of s.split(/[\/、,，]/).map(x => x.trim()).filter(Boolean)) {
    if (names.has(part)) { out.push(part); continue; }
    const clean = part.replace(/[（(]\s*(上午|下午|晚上|全天)\s*[)）]/g, '').trim();
    if (names.has(clean)) { out.push(clean); continue; }
    const seg = segmentByNames(clean, names);
    if (seg && seg.length) out.push(...seg);
    else out.push(clean);
  }
  return out;
}
function splitDest(raw) {
  let s = String(raw || '').trim();
  let timeTag = '';
  const tm = s.match(/[（(](上午|下午|晚上|全天)[)）]/);
  if (tm) { timeTag = tm[1]; s = s.replace(tm[0], '').trim(); }
  const firstEventIdx = str => {
    let best = -1;
    for (const w of EVENT_WORDS) { const i = str.indexOf(w); if (i >= 0 && (best < 0 || i < best)) best = i; }
    return best;
  };
  let place = '', event = '';
  const SUF = /^(镇|乡|村|街道|地区|居委会)/;
  const d = DISTRICTS.find(x => s.startsWith(x));
  if (d) {
    place = d; const rest = s.slice(d.length);
    const i = firstEventIdx(rest);
    if (i > 0) { place += rest.slice(0, i); event = rest.slice(i); }
    else if (i === 0) { event = rest; }
    else if (/(河|沟|村|镇|庄|水库|湿地|湖|山|路|桥|园区|渠|站|厂|灌区|园|地区)$/.test(rest) && rest.length <= 8) { place += rest; }
    else { event = rest; }
  } else {
    const p = PLACES.find(x => s.startsWith(x));
    if (p) {
      place = p; let rest = s.slice(p.length);
      const sm = rest.match(SUF);
      if (sm) { place += sm[0]; rest = rest.slice(sm[0].length); }
      if (rest) event = rest;
    } else { event = s; }
  }
  const slot = TIME_SLOT[timeTag] || null;
  return { place: place.trim(), event: event.trim(), timeTag, startTime: slot ? slot[0] : '', endTime: slot ? slot[1] : '' };
}

async function parseTdoc(dateFrom, dateTo) {
  const today = localToday();
  dateFrom = dateFrom || today;
  dateTo = dateTo || '9999-12-31';

  // 系统车辆 + 人名（用于校验 / 自举）
  const gurl = `https://gitee.com/api/v5/repos/${G.owner}/${G.repo}/contents/${encodeURIComponent(G.file)}?ref=${G.branch}`;
  const gres = await fetch(gurl, { headers: { Authorization: 'token ' + G.pat } });
  if (!gres.ok) throw new Error('Gitee 读取失败 HTTP ' + gres.status);
  const gj = await gres.json();
  const data = JSON.parse(Buffer.from(gj.content, 'base64').toString('utf8'));
  const vehicles = data.vehicles || [];
  const users = data.users || [];
  const sysNames = new Set();
  users.forEach(u => { if (u.displayName) sysNames.add(u.displayName); if (u.username) sysNames.add(u.username); });

  const r = await mcp('get_cell_data', {
    file_id: FILE_ID, sheet_id: SHEET_ID,
    start_row: 2, end_row: 2000, start_col: 0, end_col: 15, return_csv: true
  });
  const rows = parseCSV(r.csv_data || '');

  const roster = new Set([...sysNames, ...SEED_NAMES]);
  const GROUPS = [[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12], [13, 14, 15]];
  for (const row of rows) {
    for (const [, cu] of GROUPS) {
      const v = String(row[cu] || '').trim();
      if (!v) continue;
      if (v.includes('/') || v.includes('、') || v.includes('，') || v.includes(',')) {
        for (const part of v.split(/[\/、,，]/).map(x => x.trim()).filter(Boolean)) {
          const c = part.replace(/[（(]\s*(上午|下午|晚上|全天)\s*[)）]/g, '').trim();
          if (isCJK(c) && c.length >= 2 && c.length <= 4) roster.add(c);
        }
      } else if (isCJK(v) && v.length >= 2 && v.length <= 4) roster.add(v);
    }
  }

  const items = [];
  for (const row of rows) {
    const date = parseDate(row[0]);
    if (!date) continue;
    if (date < dateFrom || date > dateTo) continue;
    for (const [cp, cu, cd] of GROUPS) {
      const plate = String(row[cp] || '').trim();
      const personRaw = String(row[cu] || '').trim();
      const destRaw = String(row[cd] || '').trim();
      if (!plate || plate === '/' || !personRaw) continue;
      const persons = splitNames(personRaw, roster).filter(p => !STATUS_WORDS.has(p));
      if (!persons.length) continue;
      const dests = destRaw.split('/').map(x => x.trim()).filter(Boolean);
      const n = Math.max(persons.length, dests.length, 1);
      for (let i = 0; i < n; i++) {
        const p = persons[i] || persons[0] || '';
        const ds = dests[i] || (dests.length ? dests[0] : '');
        const sp = splitDest(ds);
        items.push({ date, plate, person: p, place: sp.place, event: sp.event, startTime: sp.startTime, endTime: sp.endTime, timeTag: sp.timeTag, rawPerson: personRaw, rawDest: ds });
      }
    }
  }
  return { items, rosterSize: roster.size, vehicles, plateSet: new Set(vehicles.map(v => String(v.plate || '').trim())) };
}

module.exports = { parseTdoc, G };
