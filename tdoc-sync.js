// 腾讯文档「车辆预约」表 → Gitee data.json 同步（今日及以后）
// 规则：以在线文档为准覆盖；与系统现有预约冲突时，覆盖并在备注中保留原信息。
// 用法：
//   node tdoc-sync.js            # 实际写入 Gitee
//   node tdoc-sync.js --dry      # 只预览将要做的改动，不写数据
const fs = require('fs');
const { parseTdoc, G } = require('./tdoc-parse');

const API = 'https://gitee.com/api/v5';
const DRY = process.argv.includes('--dry');

function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const toMin = s => { const [h, m] = (s || '08:30').split(':').map(Number); return h * 60 + m; };
function timeOverlap(aS, aE, bS, bE) {
  const s = Math.max(toMin(aS), toMin(bS)), e = Math.min(toMin(aE), toMin(bE));
  return s < e;
}
function genId() { return 'res_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

(async () => {
  const ts = new Date().toISOString();
  const tsLocal = new Date().toLocaleString('zh-CN', { hour12: false });
  const today = localToday();

  const { items, vehicles } = await parseTdoc(today, '9999-12-31');
  const plateToVeh = new Map();
  (vehicles || []).forEach(v => plateToVeh.set(String(v.plate || '').trim(), v));

  // 构造在线文档预约对象
  const online = [];
  const skipped = new Set();
  for (const it of items) {
    const v = plateToVeh.get(it.plate);
    if (!v) { skipped.add(it.plate); continue; }
    const explicitTime = !!it.timeTag;
    const startTime = it.startTime || '08:30';
    const endTime = it.endTime || '17:30';
    const place = it.place || '';
    const event = it.event || '';
    const destAddress = [place, event].filter(Boolean).join(' ');
    const notesBase = [
      place ? '地点：' + place : '',
      event ? '事项：' + event : '',
      it.timeTag ? '时段标注：' + it.timeTag : '',
      '来源：腾讯文档在线表格'
    ].filter(Boolean).join('\n');
    online.push({
      vehicleId: v.id, plate: it.plate, date: it.date, allDay: false,
      startTime, endTime, explicitTime, applicant: it.person, purpose: event, destination: place,
      destAddress, notes: notesBase, destLng: null, destLat: null,
      createdBy: null, createdName: it.person, status: 'pending', _src: 'tdoc', _syncAt: ts
    });
  }

  // 读取 Gitee 现有数据
  const gurl = `${API}/repos/${G.owner}/${G.repo}/contents/${encodeURIComponent(G.file)}?ref=${G.branch}`;
  const gres = await fetch(gurl, { headers: { Authorization: 'token ' + G.pat } });
  if (!gres.ok) { console.error('Gitee 读取失败 HTTP', gres.status); process.exit(1); }
  const gj = await gres.json();
  const sha = gj.sha;
  const data = JSON.parse(Buffer.from(gj.content, 'base64').toString('utf8'));
  const all = data.reservations || [];

  const plan = [];           // 改动说明
  let added = 0, updated = 0, kept = 0, conflict = 0;

  // 匹配：同车辆 + 同日期 + 同使用人 + 时段重叠
  for (const o of online) {
    const idx = all.findIndex(r =>
      r.vehicleId === o.vehicleId && r.date === o.date && r.applicant === o.applicant &&
      timeOverlap(r.startTime || '08:30', r.endTime || '17:30', o.startTime, o.endTime) &&
      (r.status !== 'cancelled' || true));
    if (idx >= 0) {
      const old = all[idx];
      // 时间处理：文档明确标注了上午/下午才覆盖时段；未标注则保留系统原有时段（不丢信息）
      const merged = Object.assign({}, o);
      merged.id = old.id;
      if (!o.explicitTime) {
        merged.startTime = old.startTime || o.startTime;
        merged.endTime = old.endTime || o.endTime;
      }
      // 冲突判定：使用人/事项/地点 不同，或文档明确给出了不同时间段
      const authFields = ['applicant', 'purpose', 'destination'];
      if (o.explicitTime) authFields.push('startTime', 'endTime');
      const changed = authFields.some(k => String(old[k] || '') !== String(merged[k] || ''));
      if (changed) {
        const note = `[在线表格同步 ${tsLocal}] 已按在线文档覆盖。原系统预约：使用人 ${old.applicant || '—'} 时段 ${old.startTime || ''}-${old.endTime || ''} 事项 ${old.purpose || '—'} 地点 ${old.destination || '—'}${old.notes ? '；原备注：' + old.notes : ''}`;
        merged.notes = (note + '\n' + o.notes);
        conflict++;
        plan.push(`覆盖冲突 #${old.id} ${o.date} ${o.plate} ${o.applicant}（原 ${old.startTime || ''}-${old.endTime || ''} → 新 ${merged.startTime}-${merged.endTime}）`);
      } else {
        plan.push(`已存在（无变化） #${old.id} ${o.date} ${o.plate} ${o.applicant}`);
      }
      all[idx] = merged;
      updated++;
    } else {
      const nr = Object.assign({ id: genId() }, o);
      all.push(nr);
      added++;
      plan.push(`新增 ${nr.id} ${o.date} ${o.plate} ${o.applicant} ${o.startTime}-${o.endTime} ${o.destination || ''} ${o.purpose || ''}`);
    }
  }
  data.reservations = all;
  data._lastTdocSync = ts;
  data._tdocSource = '腾讯文档：2026年度勘察测绘所车辆平板预约登记表';

  console.log('\n=== 同步计划（' + (DRY ? '演练，不写入' : '将写入 Gitee') + '）===');
  console.log('今日：', today, ' 在线文档解析：', online.length, '条', skipped.size ? '（跳过车牌：' + [...skipped].join('/') + '）' : '');
  console.log('新增：', added, ' 覆盖更新：', updated, '（其中冲突备注：', conflict, '）');
  plan.forEach(p => console.log('  - ' + p));

  if (DRY) { console.log('\n（演练模式，未修改线上数据）'); return; }

  // 写入 Gitee
  const body = {
    message: 'sync from Tencent Docs ' + tsLocal,
    content: Buffer.from(JSON.stringify(data, null, 2), 'utf8').toString('base64'),
    branch: G.branch, sha
  };
  let res = await fetch(gurl, { method: 'PUT', headers: { Authorization: 'token ' + G.pat, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 400 || res.status === 409) {
    const h2 = await fetch(gurl, { headers: { Authorization: 'token ' + G.pat } });
    if (h2.ok) { const j2 = await h2.json(); body.sha = j2.sha; res = await fetch(gurl, { method: 'PUT', headers: { Authorization: 'token ' + G.pat, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  }
  if (!res.ok) { let d; try { d = await res.json(); } catch (e) {} console.error('Gitee 写入失败 HTTP', res.status, d && (d.message || '')); process.exit(1); }
  console.log('\n✅ 已写入 Gitee（sha 已更新）');
})().catch(e => { console.error('失败：', e.message); process.exit(1); });
