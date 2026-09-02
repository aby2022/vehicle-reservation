'use strict';
/* 车辆预约 Web 版 —— 界面/功能仿微信小程序，桌面端侧边栏适配 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const EVENT_TYPES = ['开会', '验收', '放孔', '查管线', '核实测图', '管线对接', '自定义填写'];
const CUSTOM_EVENT = '自定义填写';

/* ---------- 日期/工具 ---------- */
function fmt(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function todayObj() { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
function todayStr() { return fmt(todayObj()); }
function parseDS(ds) { const [y, m, d] = ds.split('-').map(Number); return new Date(y, m - 1, d); }
function wkLabel(d) {
  const t = todayObj(); const diff = Math.round((d - t) / 86400000);
  if (diff === 0) return '今天'; if (diff === 1) return '明天'; if (diff === 2) return '后天';
  const td = (t.getDay() || 7); const mon = new Date(t); mon.setDate(t.getDate() - (td - 1));
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  if (d >= mon && d <= sun) return '本周' + WD[d.getDay()];
  const mon2 = new Date(mon); mon2.setDate(mon2.getDate() + 7); const sun2 = new Date(mon2); sun2.setDate(mon2.getDate() + 6);
  if (d >= mon2 && d <= sun2) return '下周' + WD[d.getDay()];
  return WD[d.getDay()];
}
function lastDig(plate) {
  if (!plate) return 0; const s = String(plate).replace(/\s/g, ''); const last = s[s.length - 1];
  if (/[A-Za-z]/.test(last)) return 0; const m = plate.match(/\d/g); if (!m) return 0;
  return parseInt(m[m.length - 1], 10);
}

/* ---------- 限行计算（前端镜像） ---------- */
function findPeriod(dateStr) {
  const rs = state.restriction; if (!rs || !Array.isArray(rs.periods)) return null;
  return rs.periods.find(p => { const s = p.startDate || ''; const e = p.endDate || '9999-12-31'; return dateStr >= s && dateStr <= e; }) || null;
}
function tailsFor(dateStr) {
  const p = findPeriod(dateStr); if (!p) return [];
  const wd = parseDS(dateStr).getDay(); const rule = (p.rules || []).find(r => r.weekday === wd);
  return rule ? rule.tails : [];
}
function isRestOn(dateStr, plate) {
  const rs = state.restriction; if (!rs || !rs.enabled) return false;
  const wd = parseDS(dateStr).getDay();
  if ((wd === 0 || wd === 6) && !rs.weekendRestricted) return false;
  return tailsFor(dateStr).includes(lastDig(plate));
}
function vehiclePeriodOn(v, dateStr) {
  if (!v || !Array.isArray(v.periods)) return null;
  return v.periods.find(p => dateStr >= p.start_date && dateStr <= p.end_date) || null;
}
function vehicleStatus(v, dateStr) {
  const per = vehiclePeriodOn(v, dateStr);
  const rest = isRestOn(dateStr, v.plate);
  if (per && per.type === 'damage') return { text: '损坏', cls: 'damage' };
  if (per) {
    const baseText = per.type === 'repair' ? '维修' : per.type === 'maintenance' ? '保养' : '其他';
    const cls = per.type === 'repair' ? 'repair' : per.type === 'maintenance' ? 'maintenance' : 'other';
    if (rest) return { text: baseText + '+限行', cls: 'restricted' };
    return { text: baseText, cls };
  }
  if (rest) return { text: '限行', cls: 'restricted' };
  return { text: '正常', cls: 'normal' };
}
// 车辆状态提示语（对齐小程序 booking.updateVehicleAlert）
function vehicleStatusNote(v, dateStr) {
  const per = vehiclePeriodOn(v, dateStr);
  const rest = isRestOn(dateStr, v.plate);
  const st = vehicleStatus(v, dateStr);
  const desc = st.cls === 'repair' ? '维修中' : st.cls === 'maintenance' ? '保养中'
    : st.cls === 'other' ? (per && per.note ? '存在异常（' + per.note + '）' : '存在异常') : '';
  if (st.cls === 'damage') return { type: 'err', msg: '该车已损坏，不可预约' };
  if (rest && desc) return { type: 'warn', msg: `该车当日限行（7:00-20:00 五环内）且${desc}，仍可预约，请联系管理员核实` };
  if (rest) return { type: 'warn', msg: '该车当日限行（7:00-20:00），仍可预约，请联系管理员核实' };
  if (desc) return { type: 'warn', msg: `该车${desc}，仍可预约，请联系管理员核实` };
  return { type: 'ok', msg: '该车当日状态正常，可预约' };
}
// 时段重叠（HH:MM 字符串比较）
function timeOverlap(aS, aE, bS, bE) { return aS < bE && bS < aE; }
// 预约时段的限行判断（考虑高峰时段）
function isRestrictedForBooking(dateStr, plate, sT, eT) {
  const rs = state.restriction; if (!rs || !rs.enabled) return false;
  const wd = parseDS(dateStr).getDay();
  if ((wd === 0 || wd === 6) && !rs.weekendRestricted) return false;
  const p = findPeriod(dateStr); if (!p) return false;
  const rule = (p.rules || []).find(r => r.weekday === wd);
  if (!rule || !rule.tails.includes(lastDig(plate))) return false;
  const ps = p.peakStart || '07:00', pe = p.peakEnd || '20:00';
  return timeOverlap(sT, eT, ps, pe);
}
// 同车同时段冲突（排除已取消）
function hasConflict(vehicleId, dateStr, sT, eT) {
  return state.reservations.some(r => r.vehicleId === vehicleId && r.date === dateStr && r.status !== 'cancelled'
    && timeOverlap(sT, eT, r.startTime || '00:00', r.endTime || '23:59'));
}
// 两段时间的重合区间（无重合返回 null）
function overlapRange(aS, aE, bS, bE) { const s = aS > bS ? aS : bS, e = aE < bE ? aE : bE; return s < e ? { s, e } : null; }
// 列出与 [sT,eT] 重合的预约（带具体重合区间），excludeId 用于编辑时排除自身
function conflictDetails(vehicleId, dateStr, sT, eT, excludeId) {
  return state.reservations
    .filter(r => r.vehicleId === vehicleId && r.date === dateStr && r.status !== 'cancelled' && r.id !== excludeId)
    .map(r => { const ov = overlapRange(sT, eT, r.startTime || '00:00', r.endTime || '23:59'); return ov ? Object.assign({}, r, { ov }) : null; })
    .filter(Boolean)
    .sort((a, b) => a.ov.s.localeCompare(b.ov.s));
}
// 某车某日未取消的预约（按开始时间排序）
function booksOf(vid, ds) {
  return state.reservations.filter(r => r.vehicleId === vid && r.date === ds && r.status !== 'cancelled')
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
}

/* ---------- 状态 ---------- */
// 预约表单默认值（editId 非空表示在编辑已有预约）
function blankBk() {
  return { editId: null, selVehicleId: null, selDate: null, startTime: '09:00', endTime: '12:00', userPerson: '', eventType: '', customEvent: '', purpose: '', note: '', destLng: null, destLat: null, destAddress: '' };
}
const state = {
  token: localStorage.getItem('vr_token') || null,
  user: null,
  vehicles: [], reservations: [], restriction: null,
  tdocMeta: null,
  view: 'calendar',
  calDates: [], calSelDate: todayStr(), calSelVehicleId: null,
  bk: blankBk(),
  recFilter: 'all', recVehicle: '', recDateFrom: '', recDateTo: '',
  mineTab: 'vehicles', users: []
};

/* ---------- API（路由到 LeanCloud） ---------- */
async function api(path, opts = {}) {
  if (window.LC) { window.LC._session = state.token; return window.LC.api(path, opts); }
  return { ok: false, status: 0, data: { error: 'LeanCloud 未初始化' } };
}

/* ---------- 提示 ---------- */
function toast(msg) {
  const t = $('#toast'); t.querySelector('.toast').textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 1800);
}

/* ---------- 弹窗 ---------- */
function openModal(title, bodyHtml, onMount) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-mask"><div class="modal-sheet"><div class="modal-hd"><span class="mh-title">${title}</span><button class="modal-close">✕</button></div>${bodyHtml}</div></div>`;
  const mask = root.firstElementChild;
  mask.addEventListener('click', e => { if (e.target === mask) closeModal(); });
  mask.querySelector('.modal-close').addEventListener('click', closeModal);
  if (onMount) onMount(mask.querySelector('.modal-sheet'));
  return mask;
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

/* ---------- 高德地图按需加载 ---------- */
let _amapPromise = null;
function loadAMap() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (_amapPromise) return _amapPromise;
  _amapPromise = new Promise((resolve, reject) => {
    if (!window.AMAP_KEY || window.AMAP_KEY === 'YOUR_AMAP_KEY') { reject(new Error('NO_KEY')); return; }
    window._AMapSecurityConfig = { securityJsCode: window.AMAP_SECURITY || '' };
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(window.AMAP_KEY)}&plugin=AMap.AutoComplete,AMap.PlaceSearch,AMap.Geocoder`;
    s.onload = () => resolve(window.AMap);
    s.onerror = () => reject(new Error('LOAD_FAIL'));
    document.head.appendChild(s);
  });
  return _amapPromise;
}
// 打开高德地图查看某坐标（uri scheme，无需 Key）
function amapViewUrl(lng, lat, name) {
  return `https://uri.amap.com/marker?position=${lng},${lat}&name=${encodeURIComponent(name || '目的地')}&coordinate=gaode&callnative=1`;
}
// 把带坐标的目的地渲染成可点击查看链接
function destLink(r) {
  if (r.destLng != null && r.destLat != null) {
    const addr = (r.destAddress || r.destination || '目的地');
    return `<a class="dest-link" href="${amapViewUrl(r.destLng, r.destLat, addr)}" target="_blank" rel="noopener">📍 ${escapeHtml(addr)}</a>`;
  }
  return r.destination ? ('📍 ' + escapeHtml(r.destination)) : '';
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/* ---------- 鉴权 ---------- */
async function restoreAuth() {
  if (!state.token) return false;
  const r = await api('/auth/me');
  if (r.ok) { state.user = r.data; return true; }
  state.token = null; localStorage.removeItem('vr_token'); return false;
}
function setAuthUI() {
  const logged = !!state.user;
  $('#loginScreen').classList.toggle('hidden', logged);
  $('#mainApp').classList.toggle('hidden', !logged);
  if (logged) {
    $('#sideName').textContent = state.user.displayName || state.user.username;
    $('#sideRole').textContent = state.user.role === 'admin' ? '管理员' : '普通用户';
  }
}
async function doLogin() {
  const username = $('#authUser').value.trim();
  const password = $('#authPwd').value;
  $('#authErr').textContent = '';
  if (!username || !password) { $('#authErr').textContent = '请输入用户名和密码'; return; }
  const r = await api('/auth/login', { method: 'POST', body: { username, password } });
  if (r.ok) {
    state.token = r.data.token; localStorage.setItem('vr_token', r.data.token);
    state.user = { role: r.data.role, userId: r.data.userId, username: r.data.username, displayName: r.data.displayName };
    setAuthUI(); await loadAll(); switchView('calendar');
  } else { $('#authErr').textContent = r.data && r.data.error ? r.data.error : '登录失败'; }
}
async function doRegister() {
  const username = $('#authUser').value.trim();
  const password = $('#authPwd').value;
  const displayName = $('#authName').value.trim();
  $('#authErr').textContent = '';
  if (!username || !password) { $('#authErr').textContent = '请输入用户名和密码'; return; }
  const r = await api('/register', { method: 'POST', body: { username, password, displayName } });
  if (r.ok) {
    state.token = r.data.token; localStorage.setItem('vr_token', r.data.token);
    state.user = { role: r.data.role, userId: r.data.userId, username: r.data.username, displayName: r.data.displayName };
    setAuthUI(); await loadAll(); switchView('calendar');
    toast('注册成功，已自动登录');
  } else { $('#authErr').textContent = r.data && r.data.error ? r.data.error : '注册失败'; }
}
function doLogout() {
  api('/auth/logout', { method: 'POST' });
  state.token = null; state.user = null; localStorage.removeItem('vr_token'); state.reservations = []; state.vehicles = [];
  setAuthUI();
}

/* ---------- 数据加载 ---------- */
async function loadAll() {
  const [v, r, rs, meta] = await Promise.all([api('/vehicles'), api('/reservations'), api('/restriction'), api('/meta')]);
  if (v.ok) state.vehicles = v.data;
  if (r.ok) state.reservations = r.data;
  if (rs.ok) state.restriction = rs.data;
  if (meta.ok) state.tdocMeta = meta.data;
  state.calDates = buildCalDates();
  renderCurrent();
}
async function reload() {
  const [v, r, rs, meta] = await Promise.all([api('/vehicles'), api('/reservations'), api('/restriction'), api('/meta')]);
  if (v.ok) state.vehicles = v.data;
  if (r.ok) state.reservations = r.data;
  if (rs.ok) state.restriction = rs.data;
  if (meta.ok) state.tdocMeta = meta.data;
  state.calDates = buildCalDates();   // 跨天使用时刷新日期轴与「今天」标记
  renderCurrent();
}
function buildCalDates() {
  const out = []; const base = todayObj(); base.setDate(base.getDate() - 21);
  for (let i = 0; i < 42; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    out.push({ ds: fmt(d), m: d.getMonth() + 1, d: d.getDate(), today: fmt(d) === todayStr(), label: wkLabel(d) });
  }
  return out;
}

/* ---------- 视图切换 ---------- */
function switchView(view) {
  state.view = view;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  $$('.view').forEach(s => s.classList.add('hidden'));
  const sec = $('#view-' + view); if (sec) sec.classList.remove('hidden');
  renderCurrent();
  window.scrollTo(0, 0);
}
function renderCurrent() {
  if (state.view === 'calendar') renderCalendar();
  else if (state.view === 'records') renderRecords();
  else if (state.view === 'mine') renderMine();
}

/* ================= 日历 ================= */
function bannerHTML() {
  const t = todayStr(); const rs = state.restriction;
  if (!rs || !rs.enabled) return `<div class="ri">✅</div><div><div class="rl">限行未启用</div><div class="rd"></div><div class="rn">在「我的 → 限行规则」中开启</div></div>`;
  const wd = parseDS(t).getDay();
  if ((wd === 0 || wd === 6) && !rs.weekendRestricted) return `<div class="ri">✅</div><div><div class="rl">今日不限行</div><div class="rd"></div><div class="rn">周末畅通</div></div>`;
  const tails = tailsFor(t);
  if (tails.length) return `<div class="ri">🚫</div><div><div class="rl">今日限行尾号</div><div class="rd">${tails.join('  ')}</div><div class="rn">7:00-20:00 五环内</div></div>`;
  return `<div class="ri">✅</div><div><div class="rl">今日不限行</div><div class="rd"></div><div class="rn">周${WD[wd]}无尾号限行</div></div>`;
}
// 数据来源徽标：展示本次「今日以后」预约来自腾讯文档在线表格及最近同步时间
function syncSrcHTML() {
  const m = state.tdocMeta;
  if (!m || !m.tdocSource) return '';
  let when = '';
  if (m.lastTdocSync) {
    const d = new Date(m.lastTdocSync);
    if (!isNaN(d)) {
      const p = n => String(n).padStart(2, '0');
      when = ` · 同步于 ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
    }
  }
  return `<span class="ss-ico">📄</span><span class="ss-txt">预约数据来源：腾讯文档《${m.tdocSource.replace('腾讯文档：', '')}》${when}</span>`;
}
function cellInfo(v, ds) {
  const esc = s => (s == null ? '?' : String(s)).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const isPast = ds < todayStr();
  const per = vehiclePeriodOn(v, ds);
  const rest = isRestOn(ds, v.plate);
  const books = state.reservations.filter(r => r.vehicleId === v.id && r.date === ds && r.status !== 'cancelled');
  const names = books.map(b => esc(b.applicant)).join('<br>');

  // 损坏：过去日期归为 past，未来不可预约
  if (per && per.type === 'damage') {
    return { cls: isPast ? 'past' : 'unavailable', txt: books.length ? ('损坏<br>' + names) : '损坏' };
  }
  // 维修 / 保养 / 其他：限行标记紧跟状态（如「维修+限」），有预约则换行显示使用人
  if (per) {
    const baseText = per.type === 'repair' ? '维修' : per.type === 'maintenance' ? '保养' : '其他';
    const head = rest ? baseText + '+限' : baseText;
    const txt = books.length ? (head + '<br>' + names) : head;
    let cls;
    if (isPast) cls = 'past';
    else if (books.length) cls = rest ? 'restricted-booked' : 'warning-booked';
    else cls = rest ? 'restricted-free' : 'warning';
    return { cls, txt };
  }
  // 已过去：与未来日期同等信息量，统一灰色、只读（详情栏可看明细，不出现「预约此车」）
  //   有预约   -> 使用人，限行时另起一行标「限」
  //   无预约   -> 限行显示「限」，不限行显示「已过」
  if (isPast) {
    if (books.length) return { cls: 'past', txt: rest ? names + '<br>限' : names };
    return { cls: 'past', txt: rest ? '限' : '已过' };
  }
  // 未来（含今天）
  if (books.length) return { cls: rest ? 'restricted-booked' : 'booked', txt: rest ? names + '<br>限' : names };
  return { cls: rest ? 'restricted-free' : 'free', txt: rest ? '限行' : '可约' };
}
function legendHTML() {
  const items = [
    ['var(--ok-bg)', 'var(--ok)', '可约'], ['var(--brand-muted)', 'var(--brand)', '已约'],
    ['var(--err-bg)', 'var(--err)', '限行'], ['#fde8ec', 'var(--err)', '已约·限行'],
    ['var(--warn-bg)', 'var(--warn)', '保养/维修'], ['#9ba3af', '#6b7280', '损坏']
  ];
  return items.map(([bg, c, t]) => `<div class="legend-item"><span class="legend-dot" style="background:${bg};border:1px solid ${c}"></span><span>${t}</span></div>`).join('');
}
// 限行规则到期提醒：临期 7 天内或已过期时提示补充新一期规则
function restrictionExpiryAlert() {
  const rs = state.restriction;
  if (!rs || !rs.enabled) return '';
  const periods = rs.periods || [];
  if (!periods.length) return '';
  const ends = periods.map(p => p.endDate).filter(Boolean).sort();
  const last = ends[ends.length - 1];
  if (!last) return '';
  const t = todayObj(), e = parseDS(last);
  const days = Math.round((e - t) / 86400000);
  if (days > 7) return '';
  if (days < 0) return `<div class="alert alert-e">⚠️ 限行规则已于 ${last} 到期，此后日期将不再提示限行。请到「我的 → 限行规则」补充新一期规则。</div>`;
  return `<div class="alert alert-w">⚠️ 限行规则将于 ${last} 到期（还有 ${days} 天），到期后不再提示限行。请及时到「我的 → 限行规则」补充新一期规则。</div>`;
}
function renderCalendar() {
  const ds = state.calSelDate || todayStr();
  $('#rbar').innerHTML = bannerHTML() + restrictionExpiryAlert();
  $('#calFixed').innerHTML = state.vehicles.map(v => {
    const st = vehicleStatus(v, ds);
    return `<div class="cf-row" data-vid="${v.id}"><span class="cf-plate">${v.plate}</span><span class="cf-meta">尾号${lastDig(v.plate)} · <span style="color:${st.cls === 'damage' ? '#6b7280' : st.cls === 'normal' ? 'var(--ok)' : 'var(--err)'};font-weight:700">${st.text}</span></span></div>`;
  }).join('');
  $('#calHead').innerHTML = state.calDates.map(d => `<div class="ch-cell ${d.ds === ds ? 'ch-today' : ''}" data-ds="${d.ds}"><span class="ch-d">${d.m}/${d.d}</span><span class="ch-w">${d.label}</span></div>`).join('');
  $('#syncSrc').innerHTML = syncSrcHTML();
  $('#calRows').innerHTML = state.vehicles.map(v => `<div class="cal-row-d">` + state.calDates.map(d => {
    const c = cellInfo(v, d.ds);
    return `<div class="cal-cell ${c.cls} ${d.ds === ds ? 'today' : ''}" data-vid="${v.id}" data-ds="${d.ds}">${c.txt}</div>`;
  }).join('') + `</div>`).join('');
  $('#legend').innerHTML = legendHTML();
  renderDetail();
  if (!state._calScrolled && state.calDates.length) { state._calScrolled = true; scrollCalToToday(); }
}
// 首次进入把日历横向滚动到「今天」，否则默认停在最早的日期
function scrollCalToToday() {
  const sc = $('.cal-scroll'); if (!sc) return;
  const idx = state.calDates.findIndex(d => d.today);
  if (idx >= 0) sc.scrollLeft = Math.max(0, idx * 64 - 80);
}
function renderDetail() {
  const ds = state.calSelDate; const box = $('#calDetail');
  if (!ds) { box.innerHTML = ''; return; }
  const d = parseDS(ds);
  const rows = state.vehicles.map(v => {
    const c = cellInfo(v, ds); const rest = isRestOn(ds, v.plate);
    const books = booksOf(v.id, ds);
    let infoHtml = '', freeText = '可预约', freeColor = 'var(--ok)', canBook = true;
    if (c.cls === 'unavailable') { freeText = '损坏 · 不可预约'; freeColor = '#6b7280'; canBook = false; }
    else if (c.cls === 'warning') {
      const per = vehiclePeriodOn(v, ds);
      const t = per && per.type === 'repair' ? '维修中' : per && per.type === 'maintenance' ? '保养中' : '存在异常';
      freeText = t + ' · 可预约'; freeColor = 'var(--warn)';
    }
    else if (['booked', 'restricted-booked', 'warning-booked', 'past'].includes(c.cls)) {
      if (books.length) {
        infoHtml = books.map(b => `🕐 ${b.startTime || ''}-${b.endTime || ''} 👤 <b>${escapeHtml(b.applicant || '?')}</b> · 预约 <b>${escapeHtml(b.createdName || b.applicant || '—')}</b>${b.purpose ? ` · ${escapeHtml(b.purpose)}` : ''} ${destLink(b)}`).join('<br>');
        freeText = '';
      } else { freeText = ds < todayStr() ? '无人预约' : '可预约'; freeColor = 'var(--text3)'; }
    } else { freeText = rest ? '限行 · 7:00-20:00 五环内' : '可预约'; freeColor = rest ? 'var(--err)' : 'var(--ok)'; }
    if (c.cls === 'past') canBook = false;   // 过去日期只读：不出现「预约此车」
    const isSel = v.id === state.calSelVehicleId;
    return `<div class="detail-row ${isSel ? 'detail-sel' : ''} ${c.cls === 'past' ? 'past' : ''}"><span class="detail-plate">${v.plate}</span><div class="detail-info">${infoHtml || `<span class="detail-free" style="color:${freeColor}">${freeText}</span>`}</div>${canBook ? `<button class="detail-go" data-vid="${v.id}" data-ds="${ds}">${books.length ? '修改/取消/新增预约' : '预约此车 →'}</button>` : ''}</div>`;
  }).join('');
  box.innerHTML = `<div class="detail-hd"><span class="detail-date">${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}</span></div>${rows}`;
}

/* ================= 预约 ================= */
/* ---------- 预约填写：日历内直接弹窗（逻辑对齐小程序 booking 页） ---------- */
// 把弹窗里已填内容回写到 state.bk（切换车辆/日期、打开地图前调用，避免丢失）
function saveBookingForm(scope) {
  const g = id => (scope || document).querySelector('#' + id);
  const bk = state.bk;
  if (g('bkVehicle')) bk.selVehicleId = g('bkVehicle').value;
  if (g('bkDate')) bk.selDate = g('bkDate').value;
  if (g('bkStart')) bk.startTime = g('bkStart').value;
  if (g('bkEnd')) bk.endTime = g('bkEnd').value;
  if (g('bkUser')) bk.userPerson = g('bkUser').value.trim();
  if (g('bkEvent')) bk.eventType = g('bkEvent').value;
  if (g('bkDest')) bk.destAddress = g('bkDest').value.trim();
  if (g('bkNote')) bk.note = g('bkNote').value.trim();
  if (g('bkCustom')) bk.customEvent = g('bkCustom').value.trim();
}
// 当日已有预约（让用户看到已占用时段，对齐小程序 dayModalBookings）
function dayBooksHTML(vid, ds, excludeId) {
  const list = booksOf(vid, ds).filter(r => r.id !== excludeId);   // 编辑时不把自己算作「已有预约」
  if (!list.length) return '';
  const items = list.map(r => `<div class="db-item"><span class="db-time">${r.startTime || '?'}-${r.endTime || '?'}</span><span class="db-user">${escapeHtml(r.applicant || '?')}</span><span class="db-by">预约 ${escapeHtml(r.createdName || r.applicant || '—')}</span>${destLink(r)}</div>`).join('');
  return `<div class="day-books"><div class="db-hd">当日已有预约</div>${items}</div>`;
}
// 统一入口：当天已有预约 → 操作菜单；否则 → 预约表单
function openBookingOrActions(vid, ds) {
  if (booksOf(vid, ds).length) openDayActions(vid, ds); else openBookingModal(vid, ds);
}
// 点击已有预约的格子：给出「重新编辑 / 取消预约 / 新增预约」三个选项
function openDayActions(vehicleId, dateStr) {
  const v = state.vehicles.find(x => x.id === vehicleId);
  const ds = dateStr || state.calSelDate || todayStr();
  const d = parseDS(ds);
  const books = booksOf(vehicleId, ds);
  const isPast = ds < todayStr();
  const head = `${v ? escapeHtml(v.plate) : '车辆'} · ${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}`;
  const items = books.map(b => `
    <div class="da-item">
      <div class="da-info">
        <div class="da-time">🕐 ${b.startTime || '?'}-${b.endTime || '?'}</div>
        <div class="da-desc">使用 <b>${escapeHtml(b.applicant || '?')}</b>${b.purpose ? ' · ' + escapeHtml(b.purpose) : ''}</div>
        <div class="da-by">预约人 ${escapeHtml(b.createdName || '—')}</div>
      </div>
      ${isPast ? '' : `<div class="da-ops">
        <button class="da-btn" data-act="edit" data-id="${b.id}">重新编辑</button>
        <button class="da-btn danger" data-act="cancel" data-id="${b.id}">取消预约</button>
      </div>`}
    </div>`).join('');
  const body = `
    <div class="da-modal">
      <div class="bk-mhead">${head}</div>
      ${books.length ? `<div class="db-hd">当日已有预约 ${books.length} 条</div>${items}` : ''}
      ${isPast ? '<div class="alert alert-w">该日期已过，只能查看，不能修改或新增。</div>'
      : '<button class="btn-primary" data-act="new">修改/取消/新增预约</button>'}
    </div>`;
  openModal('预约操作', body, sheet => {
    sheet.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'new') { closeModal(); openBookingModal(vehicleId, ds); }
      else if (act === 'edit') { closeModal(); openBookingModal(vehicleId, ds, b.dataset.id); }
      else if (act === 'cancel') { closeModal(); cancelRes(b.dataset.id); }
    });
  });
}
function openBookingModal(vehicleId, dateStr, editId) {
  const bk = state.bk;
  if (editId) {
    // 编辑模式：在原有预约信息基础上修改
    const r0 = state.reservations.find(x => x.id === editId);
    if (!r0) { toast('该预约不存在或已被删除'); return; }
    bk.editId = editId;
    bk.selVehicleId = r0.vehicleId;
    bk.selDate = r0.date;
    bk.startTime = r0.startTime || '09:00';
    bk.endTime = r0.endTime || '12:00';
    bk.userPerson = r0.applicant || '';
    bk.destAddress = r0.destAddress || r0.destination || '';
    bk.note = r0.notes || r0.note || '';
    bk.destLng = r0.destLng != null ? r0.destLng : null;
    bk.destLat = r0.destLat != null ? r0.destLat : null;
    const pu = r0.purpose || '';
    if (EVENT_TYPES.includes(pu)) { bk.eventType = pu; bk.customEvent = ''; }
    else if (pu) { bk.eventType = CUSTOM_EVENT; bk.customEvent = pu; }
    else { bk.eventType = ''; bk.customEvent = ''; }
  } else {
    bk.editId = null;
    if (vehicleId) bk.selVehicleId = vehicleId;
    if (dateStr) bk.selDate = dateStr;
    if (!bk.startTime) bk.startTime = '09:00';
    if (!bk.endTime) bk.endTime = '12:00';
    if (!bk.userPerson && state.user) bk.userPerson = state.user.displayName || '';
  }
  if (!bk.selDate || bk.selDate < todayStr()) bk.selDate = todayStr();   // 过去日期不允许预约，兜底拉回今天
  if (!bk.selVehicleId && state.vehicles.length) bk.selVehicleId = state.vehicles[0].id;

  const v = state.vehicles.find(x => x.id === bk.selVehicleId);
  const note = v ? vehicleStatusNote(v, bk.selDate) : { type: 'warn', msg: '暂无可预约车辆' };
  const base = todayObj();
  const dateOpts = Array.from({ length: 30 }, (_, i) => { const d = new Date(base); d.setDate(base.getDate() + i); return d; })
    .map(d => `<option value="${fmt(d)}" ${fmt(d) === bk.selDate ? 'selected' : ''}>${d.getMonth() + 1}/${d.getDate()} ${wkLabel(d)}</option>`).join('');
  const vehOpts = state.vehicles.map(x => {
    const st = vehicleStatus(x, bk.selDate);
    return `<option value="${x.id}" ${x.id === bk.selVehicleId ? 'selected' : ''}>${x.plate}（${st.text}）</option>`;
  }).join('');
  const evOptions = EVENT_TYPES.map(e => `<option value="${e}" ${bk.eventType === e ? 'selected' : ''}>${e}</option>`).join('');
  const canSubmit = !!(bk.selVehicleId && bk.selDate && bk.userPerson) && note.type !== 'err';
  const d = parseDS(bk.selDate);

  const body = `
    <div class="bk-modal">
      <div class="bk-mhead">${v ? escapeHtml(v.plate) : '车辆'} · ${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]}</div>
      <div class="fg-row">
        <div class="fg"><label class="fg-label">车辆</label><select id="bkVehicle" class="fg-input">${vehOpts || '<option value="">暂无车辆</option>'}</select></div>
        <div class="fg"><label class="fg-label">日期</label><select id="bkDate" class="fg-input">${dateOpts}</select></div>
      </div>
      <div class="alert alert-${note.type === 'err' ? 'e' : note.type === 'warn' ? 'w' : 'o'}">${escapeHtml(note.msg)}</div>
      ${dayBooksHTML(bk.selVehicleId, bk.selDate, bk.editId)}
      <div class="fg"><label class="fg-label">使用时间</label>
        <div class="time-row"><input type="time" id="bkStart" class="fg-input" value="${bk.startTime}"><span style="font-weight:700;color:var(--text3)">—</span><input type="time" id="bkEnd" class="fg-input" value="${bk.endTime}"></div></div>
      <div class="fg"><label class="fg-label">使用人</label><input id="bkUser" class="fg-input" placeholder="请输入姓名" value="${escapeHtml(bk.userPerson)}"></div>
      <div class="fg"><label class="fg-label">事项（选填）</label><select id="bkEvent" class="fg-input"><option value="">请选择事项</option>${evOptions}</select></div>
      ${bk.eventType === CUSTOM_EVENT ? `<div class="fg"><label class="fg-label">自定义事项</label><input id="bkCustom" class="fg-input" placeholder="请输入具体事项" value="${escapeHtml(bk.customEvent || '')}"></div>` : ''}
      <div class="fg"><label class="fg-label">目的地（选填）</label>
        <div class="dest-row">
          <input id="bkDest" class="fg-input" placeholder="如：望京SOHO" value="${escapeHtml(bk.destAddress || '')}">
          <button id="bkMapPick" class="btn-map" type="button">📍 地图选点</button>
        </div>
        <div id="bkMapInfo" class="map-info ${bk.destLng != null ? 'show' : ''}">${bk.destLng != null ? ('已选坐标：' + Number(bk.destLat).toFixed(6) + ', ' + Number(bk.destLng).toFixed(6)) : '未标注坐标，可点击「地图选点」在地图上选位置'}</div>
      </div>
      <div class="fg"><label class="fg-label">备注（选填）</label><input id="bkNote" class="fg-input" placeholder="如有特殊需求请注明" value="${escapeHtml(bk.note)}"></div>
      <button id="bkSubmit" class="btn-primary" ${canSubmit ? '' : 'disabled'}>${bk.editId ? '保存修改' : '确认预约'}</button>
      ${bk.editId ? '<div class="bk-tip">正在修改已有预约，保存后原预约将被覆盖。</div>' : ''}
    </div>`;

  openModal(bk.editId ? '编辑预约' : '预约用车', body, sheet => {
    const g = id => sheet.querySelector('#' + id);
    const rerender = () => { saveBookingForm(sheet); openBookingModal(bk.selVehicleId, bk.selDate, bk.editId); };
    const vs = g('bkVehicle'); if (vs) vs.onchange = rerender;
    const dsSel = g('bkDate'); if (dsSel) dsSel.onchange = rerender;
    const evSel = g('bkEvent'); if (evSel) evSel.onchange = rerender;   // 选「自定义填写」时刷新出输入框
    const us = g('bkUser');
    if (us) us.oninput = () => { bk.userPerson = us.value.trim(); const sb = g('bkSubmit'); if (sb) sb.disabled = !(bk.selVehicleId && bk.selDate && bk.userPerson); };
    const mp = g('bkMapPick');
    if (mp) mp.onclick = () => { saveBookingForm(sheet); openMapPicker(() => openBookingModal(bk.selVehicleId, bk.selDate, bk.editId)); };
    const sb = g('bkSubmit'); if (sb) sb.onclick = submitBooking;
  });
}
async function openMapPicker(onDone) {
  const bk = state.bk;
  let _mapDone = false;
  const fireDone = () => { if (_mapDone) return; _mapDone = true; if (onDone) setTimeout(onDone, 0); };
  const body = `
    <div class="map-pick">
      <div class="map-search"><input id="mapSearch" class="fg-input" placeholder="搜索地点，如：望京SOHO"></div>
      <div id="amapContainer" class="amap-box"></div>
      <div id="mapAddr" class="map-addr">地图加载中…</div>
      <div id="mapDbg" class="map-dbg"></div>
      <div class="map-actions">
        <button id="mapClear" class="btn-ghost" type="button">清除</button>
        <button id="mapConfirm" class="btn-primary" type="button">确认选择</button>
      </div>
    </div>`;
  const mask = openModal('选择目的地位置', body, async (sheet) => {
    const addrEl = sheet.querySelector('#mapAddr');
    const dbgEl = sheet.querySelector('#mapDbg');
    const destInput = document.getElementById('bkDest');
    if (dbgEl) dbgEl.textContent = `AMap:${typeof window.AMap !== 'undefined' ? '已加载' : '未加载'} · Key:${(window.AMAP_KEY || '').slice(0, 6)}… · 安全密钥:${window.AMAP_SECURITY ? '已设' : '未设'}`;
    let map, marker, geo, AMap;
    try { AMap = await loadAMap(); }
    catch (e) {
      if (e && e.message === 'NO_KEY') {
        sheet.querySelector('.map-pick').innerHTML = `<div class="alert alert-e" style="margin:10px">未配置高德地图 Key。<br>请在 <code>public/amap-config.js</code> 填入 AMAP_KEY 与 AMAP_SECURITY，<br>目的地的文本输入仍可正常使用。</div>`;
        return;
      }
      addrEl.textContent = '高德 JS 加载失败：' + (e && e.message) + '（请确认网络可访问 webapi.amap.com）';
      return;
    }
    try {
      const center = (bk.destLng != null && bk.destLat != null) ? [bk.destLng, bk.destLat] : (window.AMAP_DEFAULT_CENTER || [116.397428, 39.90923]);
      map = new AMap.Map(sheet.querySelector('#amapContainer'), { zoom: 13, center, viewMode: '2D' });
      map.on('complete', () => { if (addrEl.textContent === '地图加载中…') addrEl.textContent = '地图已就绪，点击或搜索选择位置'; });
      geo = new AMap.Geocoder();
      const reverse = (lng, lat) => {
        geo.getAddress([lng, lat], (status, result) => {
          const a = (status === 'complete' && result.regeocode) ? (result.regeocode.formattedAddress || '') : '';
          bk.destLng = +lng; bk.destLat = +lat; bk.destAddress = a;
          addrEl.textContent = a || ('坐标 ' + Number(lat).toFixed(6) + ', ' + Number(lng).toFixed(6));
        });
      };
      const setMarker = (lng, lat, label) => {
        if (!marker) {
          marker = new AMap.Marker({ map, draggable: true, position: [lng, lat] });
          marker.on('dragend', () => { const p = marker.getPosition(); reverse(p.lng, p.lat); });
        } else marker.setPosition([lng, lat]);
        map.setCenter([lng, lat]);
        if (label != null) addrEl.textContent = label;
      };
      map.on('click', e => { const ll = e.lnglat; setMarker(ll.getLng(), ll.getLat()); reverse(ll.getLng(), ll.getLat()); });
      const ac = new AMap.AutoComplete({ input: 'mapSearch' });
      ac.on('select', ev => {
        const p = ev.poi && ev.poi.location;
        if (p) {
          const label = ev.poi.name + (ev.poi.district ? ('（' + ev.poi.district + '）') : '');
          setMarker(p.lng, p.lat, label);
          bk.destLng = +p.lng; bk.destLat = +p.lat; bk.destAddress = ev.poi.name || '';
        }
      });
      if (bk.destLng != null && bk.destLat != null) { setMarker(bk.destLng, bk.destLat); addrEl.textContent = bk.destAddress || '已选位置'; }
      sheet.querySelector('#mapConfirm').addEventListener('click', () => {
        if (bk.destLng == null) { toast('请先在地图上选点'); return; }
        if (destInput && !destInput.value.trim()) destInput.value = bk.destAddress || '';
        const info = document.getElementById('bkMapInfo');
        if (info) { info.classList.add('show'); info.textContent = '已选坐标：' + Number(bk.destLat).toFixed(6) + ', ' + Number(bk.destLng).toFixed(6); }
        closeModal();
        fireDone();
      });
      sheet.querySelector('#mapClear').addEventListener('click', () => {
        bk.destLng = null; bk.destLat = null; bk.destAddress = '';
        if (marker) { marker.setMap(null); marker = null; }
        if (destInput) destInput.value = '';
        addrEl.textContent = '点击地图或搜索选择位置…';
        const info = document.getElementById('bkMapInfo');
        if (info) { info.classList.remove('show'); info.textContent = '未标注坐标，可点击「地图选点」在地图上选位置'; }
      });
      setTimeout(() => {
        if (addrEl.textContent === '地图加载中…')
          addrEl.textContent = '地图仍未渲染：多为高德 Key 校验失败。请按 F12 打开控制台查看红色报错。常见原因：① Key 类型须为「Web端(JS API)」(不是「Web服务」)；② Key 与安全密钥须配对；③ 当前访问域名需在 Key 的「域名白名单」内(本地可填 * 或不限)。';
      }, 2500);
    } catch (err) {
      addrEl.textContent = '地图初始化异常：' + (err && err.message ? err.message : err) + '（常见：Key 类型须为「Web端(JS API)」、Key 与安全密钥须配对）';
    }
  });
  // 关闭地图（✕ / 点遮罩）时回到预约表单，避免已填内容丢失
  if (mask) {
    const cb = mask.querySelector('.modal-close'); if (cb) cb.addEventListener('click', fireDone);
    mask.addEventListener('click', e => { if (e.target === mask) fireDone(); });
  }
}
async function submitBooking() {
  saveBookingForm();
  const bk = state.bk;
  if (!bk.selVehicleId || !bk.selDate || !bk.userPerson) { toast('请完善信息'); return; }
  if (bk.startTime >= bk.endTime) { toast('结束时间须晚于开始时间'); return; }
  if (bk.selDate < todayStr()) { toast('不能预约过去的日期'); return; }
  const v = state.vehicles.find(x => x.id === bk.selVehicleId);
  if (!v) { toast('请选择车辆'); return; }
  const per = vehiclePeriodOn(v, bk.selDate);
  if (per && per.type === 'damage') { toast('该车已损坏，不可预约'); return; }
  if (bk.eventType === CUSTOM_EVENT && !bk.customEvent) { toast('请填写自定义事项'); return; }
  const finalEvent = bk.eventType === CUSTOM_EVENT ? bk.customEvent : bk.eventType;
  const me = state.user || {};
  const body = { vehicleId: bk.selVehicleId, date: bk.selDate, allDay: false, startTime: bk.startTime, endTime: bk.endTime, applicant: bk.userPerson, purpose: finalEvent, destination: bk.destAddress, notes: bk.note, destLng: bk.destLng, destLat: bk.destLat, destAddress: bk.destAddress };
  // 新增时记录预约人；编辑时保留原预约人，只改用车信息
  if (!bk.editId) { body.createdBy = me.userId || null; body.createdName = me.displayName || me.username || ''; }
  const restricted = isRestrictedForBooking(bk.selDate, v.plate, bk.startTime, bk.endTime);
  const clashes = conflictDetails(bk.selVehicleId, bk.selDate, bk.startTime, bk.endTime, bk.editId);

  const doSave = async () => {
    if (restricted && !confirm(`⚠️ 限行提醒\n${v.plate} 在 ${bk.selDate} 限行。\n确认仍要预约吗？`)) return;
    const r = bk.editId
      ? await api('/reservations/' + bk.editId, { method: 'PUT', body })
      : await api('/reservations', { method: 'POST', body });
    if (r.ok) {
      toast(bk.editId ? '已保存修改' : '预约成功');
      const keepDate = bk.selDate, keepVid = bk.selVehicleId;
      state.bk = blankBk();
      closeModal();
      state.calSelDate = keepDate; state.calSelVehicleId = keepVid;
      await reload();
      if (state.view === 'calendar') renderCalendar(); else switchView('calendar');
    } else { toast((r.data && r.data.error) || (bk.editId ? '保存失败' : '预约失败')); }
  };
  // 时间段重合：先展示具体重合区间，由预约人确认是否依然预约
  if (clashes.length) confirmOverlap(v, bk, clashes, doSave); else doSave();
}
// 时间重合确认弹窗：列出每一条冲突预约的具体重合时段
function confirmOverlap(v, bk, clashes, onProceed) {
  const d = parseDS(bk.selDate);
  const items = clashes.map(r => `
    <div class="ov-item">
      <div class="ov-time">重合 ${r.ov.s} — ${r.ov.e}</div>
      <div class="ov-desc">${escapeHtml(r.applicant || '?')} 已预约 ${r.startTime || '?'}-${r.endTime || '?'}${r.purpose ? ' · ' + escapeHtml(r.purpose) : ''}${r.createdName ? ' · 预约人 ' + escapeHtml(r.createdName) : ''}</div>
    </div>`).join('');
  const body = `
    <div class="ov-modal">
      <div class="ov-head">⚠️ 时间段重合</div>
      <div class="ov-sub">${v ? escapeHtml(v.plate) : ''} · ${d.getMonth() + 1}月${d.getDate()}日 周${WD[d.getDay()]} · 本次 ${bk.startTime}-${bk.endTime}</div>
      ${items}
      <div class="ov-tip">该车辆在此时段已有 ${clashes.length} 条预约，继续预约将产生时间冲突，请确认是否依然预约。</div>
      <div class="ov-btns">
        <button id="ovBack" class="btn-ghost">返回修改时间</button>
        <button id="ovGo" class="btn-primary btn-danger">仍然预约</button>
      </div>
    </div>`;
  openModal('时间冲突确认', body, sheet => {
    sheet.querySelector('#ovBack').onclick = () => openBookingModal(bk.selVehicleId, bk.selDate, bk.editId);
    sheet.querySelector('#ovGo').onclick = () => { closeModal(); onProceed(); };
  });
}

/* ================= 记录 ================= */
const REC_STATUS = { pending: '待使用', active: '使用中', completed: '已完成', cancelled: '已取消' };
// 实际状态：数据里没有自动流转，「过期且未取消」的预约按「已完成」处理（显示层推断，不写数据）
function recStatusOf(r) {
  if (r.status === 'cancelled') return 'cancelled';
  if (r.status === 'completed' || r.status === 'active') return r.status;
  return (r.date && r.date < todayStr()) ? 'completed' : 'pending';
}
// 记录页常用日期区间快捷项（today/week/month/lastmonth）
function quickRange(q) {
  const d = new Date(); const y = d.getFullYear(), m = d.getMonth(), dd = d.getDate();
  const fmt = (yy, mm, day) => `${yy}-${String(mm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (q === 'today') { const t = todayStr(); return { from: t, to: t }; }
  if (q === 'week') { const s = new Date(y, m, dd), e2 = new Date(y, m, dd + 6); return { from: fmt(s.getFullYear(), s.getMonth(), s.getDate()), to: fmt(e2.getFullYear(), e2.getMonth(), e2.getDate()) }; }
  if (q === 'month') return { from: fmt(y, m, 1), to: fmt(y, m, new Date(y, m + 1, 0).getDate()) };
  if (q === 'lastmonth') { const lm = new Date(y, m - 1, 1); return { from: fmt(lm.getFullYear(), lm.getMonth(), 1), to: fmt(lm.getFullYear(), lm.getMonth(), new Date(lm.getFullYear(), lm.getMonth() + 1, 0).getDate()) }; }
  return { from: '', to: '' };
}
function applyRecFilter(list) {
  const today = todayStr(); const u = state.user;
  let out = list;
  if (state.recVehicle) out = out.filter(r => r.vehicleId === state.recVehicle);
  // 使用日期范围（含首尾，按 r.date 字符串比较，YYYY-MM-DD 字典序即时间序）
  if (state.recDateFrom) out = out.filter(r => (r.date || '') >= state.recDateFrom);
  if (state.recDateTo) out = out.filter(r => (r.date || '') <= state.recDateTo);
  const f = state.recFilter;
  if (f === 'today') return out.filter(r => r.date === today);
  if (f === 'upcoming') return out.filter(r => r.date >= today && recStatusOf(r) === 'pending');
  if (f === 'completed') return out.filter(r => recStatusOf(r) === 'completed');
  if (f === 'cancelled') return out.filter(r => r.status === 'cancelled');
  if (f === 'mine') return out.filter(r => (u && r.createdBy && r.createdBy === u.userId)
    || (u && r.createdName && r.createdName === (u.displayName || u.username)));
  return out;
}
function renderRecords() {
  const filters = [['all', '全部'], ['mine', '我的预约'], ['upcoming', '即将出行'], ['today', '今日'], ['completed', '已完成'], ['cancelled', '已取消']];
  $('#recFilters').innerHTML = filters.map(([k, l]) => `<div class="fc ${state.recFilter === k ? 'active' : ''}" data-key="${k}">${l}</div>`).join('');
  const vsel = $('#recVehicleSel');
  if (vsel) vsel.innerHTML = `<option value="">全部车辆</option>` + state.vehicles.map(v => `<option value="${v.id}" ${state.recVehicle === v.id ? 'selected' : ''}>${escapeHtml(v.plate)}</option>`).join('');
  const dqRoot = $('#recDateQuick');
  if (dqRoot) dqRoot.innerHTML = [['today', '今天'], ['week', '近7天'], ['month', '本月'], ['lastmonth', '上月']]
    .map(([k, l]) => { const rg = quickRange(k); const on = (rg.from || rg.to) && state.recDateFrom === rg.from && state.recDateTo === rg.to; return `<span class="dq${on ? ' active' : ''}" data-quick="${k}">${l}</span>`; }).join('');
  let list = applyRecFilter(state.reservations.slice()).sort((a, b) => (b.date + (b.startTime || '')).localeCompare(a.date + (a.startTime || '')));
  const dclr = $('#recDateClear'); if (dclr) dclr.classList.toggle('hidden', !(state.recDateFrom || state.recDateTo));
  if (!list.length) {
    const cond = [];
    if (state.recDateFrom || state.recDateTo) cond.push(`日期 ${state.recDateFrom || '最早'} ~ ${state.recDateTo || '最新'}`);
    if (state.recVehicle) { const v = state.vehicles.find(x => x.id === state.recVehicle); if (v) cond.push(`车辆 ${v.plate}`); }
    const fl = { mine: '我的预约', upcoming: '即将出行', today: '今日', completed: '已完成', cancelled: '已取消' }[state.recFilter];
    if (fl) cond.push(fl);
    $('#recList').innerHTML = `<div class="empty-state">${cond.length ? '暂无符合条件的记录' : '暂无记录'}${cond.length ? `<div class="es-sub">当前条件：${escapeHtml(cond.join(' · '))}</div>` : ''}</div>`;
    return;
  }
  const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const groups = {};
  list.forEach(r => { const ym = r.date.slice(0, 7); (groups[ym] = groups[ym] || []).push(r); });
  const html = Object.keys(groups).sort().reverse().map(ym => {
    const [y, m] = ym.split('-');
    const items = groups[ym].map(r => {
      const v = state.vehicles.find(x => x.id === r.vehicleId);
      const stKey = recStatusOf(r);
      // 只有「今天及以后」的待使用预约才可取消（已过期/已取消/已完成一律不可操作）
      const canCancel = stKey === 'pending' && (state.user.role === 'admin' || r.createdBy === state.user.userId);
      const rd = r.date ? parseDS(r.date) : null;
      const lines = [rd ? `📅 ${rd.getMonth() + 1}月${rd.getDate()}日 周${WD[rd.getDay()]}` : '',
        `🕐 ${r.startTime || ''}-${r.endTime || ''}`, `预约 <b>${escapeHtml(r.createdName || r.applicant || '—')}</b>`, `使用 <b>${escapeHtml(r.applicant || '?')}</b>`].filter(Boolean);
      const dl = destLink(r); if (dl) lines.push(dl);
      if (r.purpose) lines.push(`事项 ${r.purpose}`);
      return `<div class="rec"><div class="rec-top"><span class="rec-plate">${v ? escapeHtml(v.plate) : '<span style="color:var(--text3)">已删除</span>'}</span><span class="rec-status ${stKey}">${REC_STATUS[stKey]}</span></div>
        <div class="rec-body">${lines.map(l => `<span>${l}</span>`).join('')}</div>
        ${canCancel ? `<span class="rec-cancel" data-id="${r.id}">取消预约</span>` : ''}</div>`;
    }).join('');
    return `<div class="rec-group"><div class="rec-grp-hd"><span>${y}年${months[parseInt(m) - 1]} · ${groups[ym].length}条</span><span class="arr">▼</span></div><div class="rec-grp-body">${items}</div></div>`;
  }).join('');
  $('#recList').innerHTML = html;
}
function exportCSV() {
  const list = applyRecFilter(state.reservations.slice()).sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));
  const head = ['日期', '开始', '结束', '车牌', '使用人', '预约人', '事项', '目的地', '状态'];
  const rows = list.map(r => { const v = state.vehicles.find(x => x.id === r.vehicleId); const stKey = recStatusOf(r); return [r.date, r.startTime, r.endTime, v ? v.plate : '（已删除）', r.applicant, r.createdName || '', r.purpose, r.destination, REC_STATUS[stKey]]; });
  const csv = '﻿' + [head].concat(rows).map(row => row.map(c => `"${String(c == null ? '' : c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '车辆预约记录.csv'; a.click();
  URL.revokeObjectURL(a.href); toast('已导出 CSV');
}

/* ================= 我的 ================= */
function statusBadge(cls) { const map = { normal: ['正常', 'var(--ok-bg)', 'var(--ok)'], maintenance: ['保养', 'var(--warn-bg)', 'var(--warn)'], repair: ['维修', 'var(--err-bg)', 'var(--err)'], damage: ['损坏', '#eceef1', '#6b7280'], restricted: ['限行', 'var(--err-bg)', 'var(--err)'] }; const [t, bg, c] = map[cls] || map.normal; return `<span class="v-status ${cls}" style="background:${bg};color:${c}">${t}</span>`; }
async function renderMine() {
  const root = $('#mineView');
  if (!state.user) { root.innerHTML = ''; return; }
  if (state.user.role !== 'admin') {
    root.innerHTML = `
      <div class="account-card"><div class="ac-name">${state.user.displayName || state.user.username}</div><div class="ac-sub">${state.user.username} · 普通用户</div></div>
      <div class="account-actions"><span id="mineHelp">📖 使用说明</span><span id="pwdChange">修改密码</span><span class="danger" id="mineLogout">退出登录</span></div>`;
    return;
  }
  if (!state.users.length) { const r = await api('/admin/users'); if (r.ok) state.users = r.data; }
  const tabs = `<div class="mg-tabs"><div class="mg-tab ${state.mineTab === 'vehicles' ? 'active' : ''}" data-tab="vehicles">车辆管理</div><div class="mg-tab ${state.mineTab === 'people' ? 'active' : ''}" data-tab="people">人员管理</div><div class="mg-tab ${state.mineTab === 'restrictions' ? 'active' : ''}" data-tab="restrictions">限行规则</div></div>`;
  let body = '';
  if (state.mineTab === 'vehicles') body = renderVehiclesTab();
  else if (state.mineTab === 'people') body = renderPeopleTab();
  else body = renderRestrictionsTab();
  // 管理员同样需要账户入口（手机端无侧边栏，否则看不到退出登录）
  root.innerHTML = tabs + body + `
      <div class="account-card"><div class="ac-name">${escapeHtml(state.user.displayName || state.user.username)}</div><div class="ac-sub">${escapeHtml(state.user.username)} · 管理员</div></div>
      <div class="account-actions"><span id="mineHelp">📖 使用说明</span><span id="pwdChange">修改密码</span><span class="danger" id="mineLogout">退出登录</span></div>`;
}
function renderVehiclesTab() {
  const cards = state.vehicles.map(v => {
    const st = vehicleStatus(v, todayStr());
    const periods = (v.periods || []).map(p => `<div class="v-period-item"><span class="per-badge ${p.type === 'damage' ? 'damage' : p.type === 'repair' ? 'repair' : 'maint'}">${p.type === 'maintenance' ? '保养' : p.type === 'repair' ? '维修' : '损坏'}</span><span>${p.start_date} ~ ${p.end_date}</span>${p.note ? `<span class="v-per-note">${p.note}</span>` : ''}<span class="v-per-del" data-pid="${p.id}" data-vid="${v.id}">✕</span></div>`).join('');
    return `<div class="v-card"><div class="v-row"><div class="v-left"><span>🚗</span><span class="v-plate">${v.plate}</span>${statusBadge(st.cls)}</div>
      <div class="v-actions"><span class="mg-btn" data-edit="${v.id}">编辑</span><span class="mg-btn del" data-del="${v.id}">删除</span></div></div>
      ${periods ? `<div class="v-periods">${periods}</div>` : ''}<span class="pd-add" data-pvid="${v.id}">+ 添加状态</span></div>`;
  }).join('');
  return `<button class="mg-add" id="addVehicle">+ 添加车辆</button>${cards}`;
}
function renderPeopleTab() {
  const admins = state.users.filter(u => u.role === 'admin');
  const regular = state.users.filter(u => u.role !== 'admin');
  const card = (u, isAdmin) => `<div class="p-card"><div class="p-info"><div class="p-avatar">${(u.displayName || u.username || '?')[0]}</div><div><div><span class="p-name">${u.displayName || u.username}</span><span class="p-role ${isAdmin ? 'admin' : 'user'}">${isAdmin ? '管理员' : '用户'}</span></div><div style="font-size:11px;color:var(--text3)">${u.username}</div></div></div>
    <div class="p-actions"><span class="mg-btn del" data-deluser="${u.id}" data-role="${u.role}">删除</span></div></div>`;
  return `<button class="mg-add" id="addPerson">+ 添加人员</button>
    ${admins.length ? `<div style="font-size:11px;font-weight:700;color:var(--text3);margin:8px 0 4px">管理员</div>${admins.map(u => card(u, true)).join('')}` : ''}
    ${regular.length ? `<div style="font-size:11px;font-weight:700;color:var(--text3);margin:8px 0 4px">普通用户</div>${regular.map(u => card(u, false)).join('')}` : ''}`;
}
function renderRestrictionsTab() {
  const rs = state.restriction || { periods: [] };
  const cards = (rs.periods || []).map(p => {
    const rules = (p.rules || []).map(r => `周${WD[r.weekday]}<b style="margin-left:4px">${(r.tails || []).join(',')}</b>`).join('　');
    const peak = (p.peakStart && p.peakEnd) ? `限行时段 ${p.peakStart}-${p.peakEnd}` : '全天限行';
    return `<div class="v-card"><div class="v-row"><div class="v-left"><span class="v-plate" style="font-family:inherit;font-size:14px">${p.name || '方案'}</span></div>
      <div class="v-actions"><span class="mg-btn" data-editrule="${p.id}">编辑</span><span class="mg-btn del" data-delrule="${p.id}">删除</span></div></div>
      <div style="font-size:11px;color:var(--text2);margin-top:6px">${p.startDate || '—'} ~ ${p.endDate || '长期'}</div>
      <div style="font-size:11px;color:var(--text2);margin-top:4px">${rules}</div>
      <div style="font-size:11px;color:var(--warn);margin-top:4px">${peak}</div></div>`;
  }).join('');
  return restrictionExpiryAlert() + `<button class="mg-add" id="addRule">+ 添加限行方案</button>${cards || '<div class="empty-state">暂无限行方案</div>'}`;
}

/* ---------- 我的：弹窗操作 ---------- */
function openVehicleModal(v) {
  const isEdit = !!v;
  const html = `<div class="fg"><label class="fg-label">车牌号</label><input id="mVPlate" class="fg-input" maxlength="10" value="${v ? v.plate : ''}" placeholder="如：京A12345"></div>
    <div class="fg"><label class="fg-label">名称</label><input id="mVName" class="fg-input" value="${v ? v.name : ''}" placeholder="如：别克GL8"></div>
    <div class="fg"><label class="fg-label">类型（选填）</label><input id="mVType" class="fg-input" value="${v ? (v.type || '') : ''}" placeholder="如：商务车"></div>
    <button class="btn-primary" id="mVSave">${isEdit ? '保存' : '确认添加'}</button>${isEdit ? '<button class="btn-danger" id="mVDelete">删除此车辆</button>' : ''}`;
  openModal(isEdit ? '编辑车辆' : '添加车辆', html, sheet => {
    sheet.querySelector('#mVSave').onclick = async () => {
      const plate = sheet.querySelector('#mVPlate').value.trim().toUpperCase();
      const name = sheet.querySelector('#mVName').value.trim();
      if (!plate || !name) { toast('车牌和名称必填'); return; }
      const body = { plate, name, type: sheet.querySelector('#mVType').value.trim(), status: 'available' };
      const r = isEdit ? await api('/vehicles/' + v.id, { method: 'PUT', body }) : await api('/vehicles', { method: 'POST', body });
      if (r.ok) { closeModal(); toast('已保存'); await reload(); } else toast((r.data && r.data.error) || '失败');
    };
    if (isEdit) sheet.querySelector('#mVDelete').onclick = async () => {
      if (!confirm('确定删除该车辆？其预约记录也将删除。')) return;
      const r = await api('/vehicles/' + v.id, { method: 'DELETE' });
      if (r.ok) { closeModal(); toast('已删除'); await reload(); } else toast('删除失败');
    };
  });
}
function openPeriodModal(vid) {
  const html = `<div class="fg"><label class="fg-label">状态类型</label><div class="seg" id="mPSeg">
      <span class="per-badge maint active" data-type="maintenance">保养</span>
      <span class="per-badge repair" data-type="repair">维修</span>
      <span class="per-badge damage" data-type="damage">损坏</span></div></div>
    <div class="fg-row"><div class="fg"><label class="fg-label">开始日期</label><input id="mPStart" type="date" class="fg-input"></div><div class="fg"><label class="fg-label">结束日期</label><input id="mPEnd" type="date" class="fg-input"></div></div>
    <div class="fg"><label class="fg-label">备注（选填）</label><input id="mPNote" class="fg-input" placeholder="如：年审"></div>
    <button class="btn-primary" id="mPSave">确认添加</button>`;
  let type = 'maintenance';
  openModal('添加车辆状态', html, sheet => {
    sheet.querySelectorAll('#mPSeg .per-badge').forEach(b => b.onclick = () => { type = b.dataset.type; sheet.querySelectorAll('#mPSeg .per-badge').forEach(x => x.classList.toggle('active', x === b)); });
    sheet.querySelector('#mPSave').onclick = async () => {
      const start_date = sheet.querySelector('#mPStart').value; const end_date = sheet.querySelector('#mPEnd').value;
      if (!start_date || !end_date) { toast('请选择日期范围'); return; }
      const r = await api('/vehicles/' + vid + '/periods', { method: 'POST', body: { type, start_date, end_date, note: sheet.querySelector('#mPNote').value.trim() } });
      if (r.ok) { closeModal(); toast('已添加'); await reload(); } else toast((r.data && r.data.error) || '失败');
    };
  });
}
function openPersonModal() {
  const html = `<div class="fg"><label class="fg-label">姓名/用户名</label><input id="mPName" class="fg-input" placeholder="如：张三"></div>
    <div class="fg"><label class="fg-label">角色</label><div class="seg" id="mPRole"><span class="chip-btn active" data-role="user">普通用户</span><span class="chip-btn" data-role="admin">管理员</span></div></div>
    <button class="btn-primary" id="mPSaveP">确认添加</button>`;
  let role = 'user';
  openModal('添加人员', html, sheet => {
    sheet.querySelectorAll('#mPRole .chip-btn').forEach(b => b.onclick = () => { role = b.dataset.role; sheet.querySelectorAll('#mPRole .chip-btn').forEach(x => x.classList.toggle('active', x === b)); });
    sheet.querySelector('#mPSaveP').onclick = async () => {
      const username = sheet.querySelector('#mPName').value.trim();
      if (!username) { toast('请输入姓名'); return; }
      const r = await api('/admin/users', { method: 'POST', body: { username, displayName: username, role, password: '123456' } });
      if (r.ok) { closeModal(); toast('已添加（默认密码123456）'); state.users = []; await reload(); } else toast((r.data && r.data.error) || '失败');
    };
  });
}
function openRuleModal(p) {
  const isEdit = !!p;
  const tailVal = (wd) => { if (!p) return ''; const r = (p.rules || []).find(x => x.weekday === wd); return r ? (r.tails || []).join(',') : ''; };
  const html = `<div class="fg-row"><div class="fg"><label class="fg-label">开始日期</label><input id="mRStart" type="date" class="fg-input" value="${p ? p.startDate : ''}"></div><div class="fg"><label class="fg-label">结束日期</label><input id="mREnd" type="date" class="fg-input" value="${p ? p.endDate : ''}"></div></div>
    <div class="fg"><label class="fg-label">方案名称</label><input id="mRName" class="fg-input" value="${p ? (p.name || '') : ''}" placeholder="如：2025.8.22-2025.11.23 限行"></div>
    <div class="fg-row"><div class="fg"><label class="fg-label">限行时段起</label><input id="mRPeakS" type="time" class="fg-input" value="${p ? (p.peakStart || '') : '07:00'}"></div><div class="fg"><label class="fg-label">限行时段止</label><input id="mRPeakE" type="time" class="fg-input" value="${p ? (p.peakEnd || '') : '20:00'}"></div></div>
    <div class="fg"><label class="fg-label">周一限行尾号</label><input id="mRM" class="fg-input" placeholder="如：1,6" value="${tailVal(1)}"></div>
    <div class="fg"><label class="fg-label">周二限行尾号</label><input id="mRT" class="fg-input" placeholder="如：2,7" value="${tailVal(2)}"></div>
    <div class="fg"><label class="fg-label">周三限行尾号</label><input id="mRW" class="fg-input" placeholder="如：3,8" value="${tailVal(3)}"></div>
    <div class="fg"><label class="fg-label">周四限行尾号</label><input id="mRTh" class="fg-input" placeholder="如：4,9" value="${tailVal(4)}"></div>
    <div class="fg"><label class="fg-label">周五限行尾号</label><input id="mRF" class="fg-input" placeholder="如：5,0" value="${tailVal(5)}"></div>
    <button class="btn-primary" id="mRSave">保存</button>${isEdit ? '<button class="btn-danger" id="mRDelete">删除此方案</button>' : ''}`;
  const parseTails = (s) => (s || '').split(',').map(x => x.trim()).filter(x => x !== '').map(Number).filter(n => !isNaN(n));
  openModal(isEdit ? '编辑限行方案' : '添加限行方案', html, sheet => {
    sheet.querySelector('#mRSave').onclick = async () => {
      const startDate = sheet.querySelector('#mRStart').value; const endDate = sheet.querySelector('#mREnd').value;
      if (!startDate || !endDate) { toast('请选择日期范围'); return; }
      const periods = state.restriction.periods.slice();
      const newP = { id: p ? p.id : 'p-' + Date.now(), name: sheet.querySelector('#mRName').value.trim() || '限行方案', startDate, endDate, peakStart: sheet.querySelector('#mRPeakS').value, peakEnd: sheet.querySelector('#mRPeakE').value, rules: [1, 2, 3, 4, 5].map(wd => ({ weekday: wd, tails: parseTails(sheet.querySelector('#mR' + ['', 'M', 'T', 'W', 'Th', 'F'][wd]).value) })) };
      const idx = periods.findIndex(x => x.id === newP.id);
      if (idx >= 0) periods[idx] = newP; else periods.push(newP);
      const r = await api('/restriction', { method: 'PUT', body: Object.assign({}, state.restriction, { periods }) });
      if (r.ok) { closeModal(); toast('已保存'); await reload(); } else toast('保存失败');
    };
    if (isEdit) sheet.querySelector('#mRDelete').onclick = async () => {
      if (!confirm('确定删除该限行方案？')) return;
      const periods = state.restriction.periods.filter(x => x.id !== p.id);
      const r = await api('/restriction', { method: 'PUT', body: Object.assign({}, state.restriction, { periods }) });
      if (r.ok) { closeModal(); toast('已删除'); await reload(); } else toast('删除失败');
    };
  });
}
function openPwdModal() {
  const html = `<div class="fg"><label class="fg-label">原密码</label><input id="mPOld" type="password" class="fg-input"></div>
    <div class="fg"><label class="fg-label">新密码</label><input id="mPNew" type="password" class="fg-input" placeholder="至少4位"></div>
    <div class="fg"><label class="fg-label">确认新密码</label><input id="mPConfirm" type="password" class="fg-input"></div>
    <button class="btn-primary" id="mPSavePwd">确认修改</button>`;
  openModal('修改密码', html, sheet => {
    sheet.querySelector('#mPSavePwd').onclick = async () => {
      const oldPassword = sheet.querySelector('#mPOld').value; const newPassword = sheet.querySelector('#mPNew').value; const confirm = sheet.querySelector('#mPConfirm').value;
      if (!oldPassword || !newPassword) { toast('请填写完整'); return; }
      if (newPassword !== confirm) { toast('两次密码不一致'); return; }
      if (newPassword.length < 4) { toast('密码至少4位'); return; }
      const r = await api('/auth/password', { method: 'PUT', body: { oldPassword, newPassword } });
      if (r.ok) { closeModal(); toast('密码修改成功'); } else toast((r.data && r.data.error) || '修改失败');
    };
  });
}

/* ================= 事件绑定 ================= */
function bindEvents() {
  // 登录/注册
  $$('.login-tab').forEach(b => b.onclick = () => {
    $$('.login-tab').forEach(x => x.classList.toggle('active', x === b));
    $('#regNameWrap').style.display = b.dataset.tab === 'register' ? 'block' : 'none';
    $('#authSubmit').textContent = b.dataset.tab === 'register' ? '注 册' : '登 录';
    $('#authErr').textContent = '';
  });
  $('#authSubmit').onclick = () => { if ($('#regNameWrap').style.display === 'block') doRegister(); else doLogin(); };
  $('#authUser').addEventListener('keydown', e => { if (e.key === 'Enter') $('#authPwd').focus(); });
  $('#authPwd').addEventListener('keydown', e => { if (e.key === 'Enter') $('#authSubmit').click(); });

  // 导航
  // 仅带 data-view 的才是页签切换（侧栏的「使用说明」没有 data-view，单独绑定）
  $$('.nav-item[data-view], .tab-btn[data-view]').forEach(b => b.onclick = () => switchView(b.dataset.view));
  const sh = $('#sideHelp'); if (sh) sh.onclick = openHelp;
  $('#sideLogout').onclick = doLogout;

  // 桌面 / 手机视图切换
  $('#deviceToggle').onclick = () => {
    const on = $('#app').classList.toggle('force-mobile');
    $('#deviceToggle').classList.toggle('active', on);
    $('#deviceToggle').textContent = on ? '🖥️ 桌面视图' : '📱 手机视图';
  };

  // 日历
  // 日历：点击车辆列 / 日历格子 → 当天已有预约时弹出「编辑 / 取消 / 新增」菜单，否则直接预约
  // （过去日期与损坏车辆不可预约；过去日期点开只可查看）
  $('#calFixed').addEventListener('click', e => { const row = e.target.closest('.cf-row'); if (row) openBookingOrActions(row.dataset.vid, state.calSelDate || todayStr()); });
  $('#calHead').addEventListener('click', e => { const c = e.target.closest('.ch-cell'); if (c) { state.calSelDate = c.dataset.ds; renderCalendar(); } });
  $('#calRows').addEventListener('click', e => {
    const c = e.target.closest('.cal-cell'); if (!c) return;
    state.calSelDate = c.dataset.ds; state.calSelVehicleId = c.dataset.vid; renderCalendar();
    if (c.classList.contains('past') || c.classList.contains('unavailable')) return;
    openBookingOrActions(c.dataset.vid, c.dataset.ds);
  });
  $('#calDetail').addEventListener('click', e => { const b = e.target.closest('.detail-go'); if (b) openBookingOrActions(b.dataset.vid, b.dataset.ds); });

  // 记录
  $('#recFilters').addEventListener('click', e => { const f = e.target.closest('.fc'); if (f) { state.recFilter = f.dataset.key; renderRecords(); } });
  const rvs = $('#recVehicleSel'); if (rvs) rvs.addEventListener('change', () => { state.recVehicle = rvs.value; renderRecords(); });
  $('#recList').addEventListener('click', e => {
    const c = e.target.closest('.rec-cancel'); if (c) { cancelRes(c.dataset.id); return; }
    const g = e.target.closest('.rec-grp-hd'); if (g) { g.classList.toggle('folded'); const b = g.nextElementSibling; if (b) b.classList.toggle('folded'); }
  });
  // 记录页 · 使用日期范围查询
  const rdf = $('#recDateFrom'), rdt = $('#recDateTo');
  function syncDateInputs() { if (rdf) rdf.value = state.recDateFrom || ''; if (rdt) rdt.value = state.recDateTo || ''; }
  if (rdf) rdf.addEventListener('change', () => {
    state.recDateFrom = rdf.value;
    // 起始晚于结束时自动顶高结束日，避免出现恒空区间
    if (state.recDateTo && state.recDateFrom && state.recDateFrom > state.recDateTo) { state.recDateTo = state.recDateFrom; syncDateInputs(); }
    renderRecords();
  });
  if (rdt) rdt.addEventListener('change', () => {
    state.recDateTo = rdt.value;
    if (state.recDateFrom && state.recDateTo && state.recDateTo < state.recDateFrom) { state.recDateFrom = state.recDateTo; syncDateInputs(); }
    renderRecords();
  });
  $('#recDateClear').addEventListener('click', () => { state.recDateFrom = ''; state.recDateTo = ''; syncDateInputs(); renderRecords(); });
  $('#recDateQuick').addEventListener('click', e => {
    const b = e.target.closest('.dq'); if (!b) return;
    const rg = quickRange(b.dataset.quick); state.recDateFrom = rg.from; state.recDateTo = rg.to;
    syncDateInputs(); renderRecords();
  });
  $('#recExport').onclick = exportCSV;

  // 我的
  $('#mineView').addEventListener('click', e => {
    const t = e.target.closest('.mg-tab'); if (t) { state.mineTab = t.dataset.tab; renderMine(); return; }
    if (e.target.id === 'mineHelp') return openHelp();
    if (e.target.id === 'addVehicle') return openVehicleModal();
    const ev = e.target.closest('[data-edit]'); if (ev) return openVehicleModal(state.vehicles.find(v => v.id === ev.dataset.edit));
    const dv = e.target.closest('[data-del]'); if (dv) {
      const n = state.reservations.filter(r => r.vehicleId === dv.dataset.del).length;
      const plate = (state.vehicles.find(x => x.id === dv.dataset.del) || {}).plate || '该车辆';
      const msg = n > 0
        ? `⚠️ ${plate} 有 ${n} 条预约记录。\n删除后这些记录的车牌将显示为「已删除」，历史数据仍保留。\n\n确定删除吗？`
        : '确定删除该车辆？';
      if (confirm(msg)) api('/vehicles/' + dv.dataset.del, { method: 'DELETE' }).then(async () => { toast('已删除'); await reload(); });
      return;
    }
    const pv = e.target.closest('[data-pvid]'); if (pv) return openPeriodModal(pv.dataset.pvid);
    const pd = e.target.closest('.v-per-del'); if (pd) { if (confirm('删除此状态记录？')) api('/vehicles/' + pd.dataset.vid + '/periods/' + pd.dataset.pid, { method: 'DELETE' }).then(async () => { toast('已删除'); await reload(); }); return; }
    if (e.target.id === 'addPerson') return openPersonModal();
    const du = e.target.closest('[data-deluser]'); if (du) {
      if (du.dataset.role === 'admin' && state.users.filter(u => u.role === 'admin').length <= 1) { toast('至少保留一位管理员'); return; }
      const uid = du.dataset.deluser;
      const uname = (state.users.find(u => u.id === uid) || {}).username || uid;
      const n = state.reservations.filter(r => r.createdBy === uid || r.createdName === uname).length;
      const msg = n > 0
        ? `⚠️ ${uname} 创建过 ${n} 条预约记录。\n删除账号后这些记录仍保留其姓名，历史可追溯。\n\n确定删除吗？`
        : '确定删除该用户？';
      if (confirm(msg)) api('/admin/users/' + uid, { method: 'DELETE' }).then(async () => { toast('已删除'); state.users = []; await reload(); });
      return;
    }
    if (e.target.id === 'addRule') return openRuleModal();
    const er = e.target.closest('[data-editrule]'); if (er) return openRuleModal(state.restriction.periods.find(p => p.id === er.dataset.editrule));
    const dr = e.target.closest('[data-delrule]'); if (dr) { if (confirm('确定删除该限行方案？')) { const periods = state.restriction.periods.filter(x => x.id !== dr.dataset.delrule); api('/restriction', { method: 'PUT', body: Object.assign({}, state.restriction, { periods }) }).then(async () => { toast('已删除'); await reload(); }); } return; }
    if (e.target.id === 'pwdChange') return openPwdModal();
    if (e.target.id === 'mineLogout') return doLogout();
  });
}
async function cancelRes(id) {
  if (!confirm('确定取消此预约吗？')) return;
  const r = await api('/reservations/cancel/' + id, { method: 'PUT' });
  if (r.ok) { toast('已取消'); await reload(); } else toast('取消失败');
}

/* ================= 使用说明 ================= */
const HELP_HTML = `
<div class="help-sec">
  <div class="help-h">1. 开始使用</div>
  <ul>
    <li>首次使用请切到「注册」，填写用户名和密码。<b>第一个注册的账号自动成为管理员</b>。</li>
    <li>登录后有三个页签：<b>日历</b>（预约用车）、<b>记录</b>（查询与导出）、<b>我的</b>（管理与账号）。</li>
    <li>右上角按钮可在「手机视图 / 桌面视图」之间切换。</li>
  </ul>
</div>
<div class="help-sec">
  <div class="help-h">2. 日历怎么看</div>
  <p>横向是日期、纵向是车辆，每个格子表示「某车某天」的状态；点击表头日期可切换下方详情栏的日期。</p>
  <div class="help-legend">
    <span class="lg ok">可约</span><span class="lg brand">已约</span><span class="lg err">限行</span>
    <span class="lg booked-rest">已约·限行</span><span class="lg warn">保养/维修</span><span class="lg grey">损坏</span>
  </div>
  <ul>
    <li>格子里显示的是<b>使用人姓名</b>；当天限行会多一个「限」字。</li>
    <li><b>已过去的日期</b>显示为灰色，只能查看，不能修改或新增。</li>
  </ul>
</div>
<div class="help-sec">
  <div class="help-h">3. 预约用车</div>
  <ol>
    <li>在日历里点击<b>空格子</b>（或点车辆列、下方「预约此车」），弹出预约表单。</li>
    <li>选择<b>车辆</b>和<b>日期</b>（可选范围：今天起 30 天内）。</li>
    <li>填写<b>使用时间</b>、<b>使用人</b>，其余选填。</li>
    <li><b>事项</b>可从「开会、验收、放孔、查管线、核实测图、管线对接」中选择，也可选「自定义填写」自行输入。</li>
    <li><b>目的地</b>支持「地图选点」：选点后会保存坐标，之后在记录页点目的地可直接打开地图查看。</li>
    <li>点「确认预约」提交。</li>
  </ol>
</div>
<div class="help-sec">
  <div class="help-h">4. 修改 / 取消 / 追加预约</div>
  <p>点击<b>已有预约的格子</b>，会弹出操作面板，列出当天该车的所有预约，并提供三个动作：</p>
  <ul>
    <li><b>重新编辑</b>：在原有预约信息基础上修改（时间、使用人、事项、目的地等），保存后覆盖原预约，<b>预约人保持不变</b>。</li>
    <li><b>取消预约</b>：确认后取消该条预约，时段立即释放。</li>
    <li><b>新增预约</b>：点面板底部的「修改/取消/新增预约」按钮，为同一辆车、同一天再加一条预约（例如上午一场、下午一场）。修改与取消请使用每条预约右侧的按钮。</li>
  </ul>
  <p class="help-note">过去日期只能查看，不提供编辑、取消和新增。</p>
</div>
<div class="help-sec">
  <div class="help-h">5. 时间重合与限行提醒</div>
  <ul>
    <li>提交时若与已有预约<b>时间段重合</b>，会弹出提示，<b>明确列出重合的具体时段</b>（如「重合 09:00 — 10:30」）以及被冲突预约的使用人、事项。</li>
    <li>此时可选择「<b>返回修改时间</b>」调整后重提，或「<b>仍然预约</b>」继续提交（例如确需同车拼车出行）。</li>
    <li>若车辆当天<b>限行</b>，提交时同样会提醒，确认后才会提交。</li>
    <li>车辆状态为「<b>损坏</b>」时不可预约；「保养 / 维修」会给出提示但仍可预约。</li>
  </ul>
</div>
<div class="help-sec">
  <div class="help-h">6. 预约记录</div>
  <ul>
    <li>按月份分组展示，点月份标题可折叠。</li>
    <li>顶部可按<b>状态</b>（我的预约 / 即将出行 / 今日 / 已完成 / 已取消）筛选，也可按<b>车辆</b>筛选。</li>
    <li><b>使用日期</b>支持起止日期区间查询，并提供「今天 / 近7天 / 本月 / 上月」快捷选项（再点一次取消），选了日期后点「清除」还原。</li>
    <li>多个条件可叠加；点「📥 导出」可把<b>当前筛选结果</b>导出为 CSV 文件。</li>
    <li>记录中带坐标的目的地可点击<b>打开地图</b>查看。</li>
  </ul>
</div>
<div class="help-sec">
  <div class="help-h">7. 管理员功能（我的）</div>
  <ul>
    <li><b>车辆管理</b>：添加 / 编辑 / 删除车辆，并可设置车辆在某段时间内的状态（保养、维修、损坏）。</li>
    <li><b>人员管理</b>：添加、删除账号。</li>
    <li><b>限行规则</b>：设置限行方案的起止日期与每日限行尾号；规则临期或过期时，日历页会给出提醒。</li>
    <li>所有用户都可在「我的」里<b>修改密码</b>和<b>退出登录</b>。</li>
  </ul>
</div>
<div class="help-sec">
  <div class="help-h">8. 数据说明</div>
  <ul>
    <li>本系统没有独立服务器，数据以 JSON 形式存放在 Gitee 仓库中，<b>网页端与小程序端共用同一份数据</b>，实时同步。</li>
    <li>因此本地试用或线上访问，操作的都是<b>同一份真实数据</b>；测试时请注意不要误改他人正在使用的预约。</li>
  </ul>
</div>`;
function openHelp() { openModal('使用说明', `<div class="help">${HELP_HTML}</div>`); }

/* ================= 启动 ================= */
(async function init() {
  bindEvents();
  const ok = await restoreAuth();
  setAuthUI();
  if (ok) await loadAll();
})();
