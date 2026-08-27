'use strict';
/* 车辆预约 Web 版 —— 界面/功能仿微信小程序，桌面端侧边栏适配 */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const WD = ['日', '一', '二', '三', '四', '五', '六'];
const EVENT_TYPES = ['开会', '验收', '外勤', '接待', '送机', '接机', '其它'];

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
  if (per && per.type === 'damage') return { text: '损坏', cls: 'damage' };
  if (per && per.type === 'repair') return { text: '维修', cls: 'repair' };
  if (per && per.type === 'maintenance') return { text: '保养', cls: 'maintenance' };
  if (isRestOn(dateStr, v.plate)) return { text: '限行', cls: 'restricted' };
  return { text: '正常', cls: 'normal' };
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

/* ---------- 状态 ---------- */
const state = {
  token: localStorage.getItem('vr_token') || null,
  user: null,
  vehicles: [], reservations: [], restriction: null,
  view: 'calendar',
  calDates: [], calSelDate: todayStr(), calSelVehicleId: null,
  openBooking: null,
  bk: { selVehicleId: null, selDate: null, startTime: '09:00', endTime: '12:00', userPerson: '', eventType: '', purpose: '', note: '', destLng: null, destLat: null, destAddress: '' },
  recFilter: 'all',
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
  const [v, r, rs] = await Promise.all([api('/vehicles'), api('/reservations'), api('/restriction')]);
  if (v.ok) state.vehicles = v.data;
  if (r.ok) state.reservations = r.data;
  if (rs.ok) state.restriction = rs.data;
  state.calDates = buildCalDates();
  renderCurrent();
}
async function reload() {
  const [v, r, rs] = await Promise.all([api('/vehicles'), api('/reservations'), api('/restriction')]);
  if (v.ok) state.vehicles = v.data;
  if (r.ok) state.reservations = r.data;
  if (rs.ok) state.restriction = rs.data;
  renderCurrent();
}
function buildCalDates() {
  const out = []; const base = todayObj(); base.setDate(base.getDate() - 14);
  for (let i = 0; i < 28; i++) {
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
  $('#view-' + view).classList.remove('hidden');
  if (view === 'booking' && state.openBooking) {
    state.bk.selVehicleId = state.openBooking.vehicleId || state.bk.selVehicleId;
    state.bk.selDate = state.openBooking.date || state.bk.selDate;
    state.openBooking = null;
  }
  if (view === 'booking' && !state.bk.userPerson && state.user) state.bk.userPerson = state.user.displayName || '';
  renderCurrent();
  window.scrollTo(0, 0);
}
function renderCurrent() {
  if (state.view === 'calendar') renderCalendar();
  else if (state.view === 'booking') renderBooking();
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
  return `<div class="ri">✅</div><div><div class="rl">今日不限行</div><div class="rd"></div><div class="rn">${WD[wd]}无尾号限行</div></div>`;
}
function cellInfo(v, ds) {
  const esc = s => (s == null ? '?' : String(s)).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  const isPast = ds < todayStr();
  const per = vehiclePeriodOn(v, ds);
  if (per && per.type === 'damage') return { cls: 'unavailable', txt: '损坏' };
  if (per) return { cls: 'warning', txt: per.type === 'repair' ? '维修' : '保养' };
  const books = state.reservations.filter(r => r.vehicleId === v.id && r.date === ds && r.status !== 'cancelled');
  const rest = isRestOn(ds, v.plate);
  if (isPast) {
    if (books.length) return { cls: 'past', txt: books.map(b => esc(b.applicant)).join('<br>') };
    return { cls: 'past', txt: '—' };
  }
  if (books.length) {
    const names = books.map(b => esc(b.applicant)).join('<br>');
    return { cls: rest ? 'restricted-booked' : 'booked', txt: rest ? names + '<br>限' : names };
  }
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
function renderCalendar() {
  const ds = state.calSelDate || todayStr();
  $('#rbar').innerHTML = bannerHTML();
  $('#calFixed').innerHTML = state.vehicles.map(v => {
    const st = vehicleStatus(v, ds);
    return `<div class="cf-row" data-vid="${v.id}"><span class="cf-plate">${v.plate}</span><span class="cf-meta">尾号${lastDig(v.plate)} · <span style="color:${st.cls === 'damage' ? '#6b7280' : st.cls === 'normal' ? 'var(--ok)' : 'var(--err)'};font-weight:700">${st.text}</span></span></div>`;
  }).join('');
  $('#calHead').innerHTML = state.calDates.map(d => `<div class="ch-cell ${d.ds === ds ? 'ch-today' : ''}" data-ds="${d.ds}"><span class="ch-d">${d.m}/${d.d}</span><span class="ch-w">${d.label}</span></div>`).join('');
  $('#calRows').innerHTML = state.vehicles.map(v => `<div class="cal-row-d">` + state.calDates.map(d => {
    const c = cellInfo(v, d.ds);
    return `<div class="cal-cell ${c.cls} ${d.ds === ds ? 'today' : ''}" data-vid="${v.id}" data-ds="${d.ds}">${c.txt}</div>`;
  }).join('') + `</div>`).join('');
  $('#legend').innerHTML = legendHTML();
  renderDetail();
}
function renderDetail() {
  const ds = state.calSelDate; const box = $('#calDetail');
  if (!ds) { box.innerHTML = ''; return; }
  const d = parseDS(ds);
  const rows = state.vehicles.map(v => {
    const c = cellInfo(v, ds); const rest = isRestOn(ds, v.plate);
    let infoHtml = '', freeText = '可预约', freeColor = 'var(--ok)', canBook = true;
    if (c.cls === 'unavailable') { freeText = '损坏 · 不可预约'; freeColor = '#6b7280'; canBook = false; }
    else if (c.cls === 'warning') { freeText = (c.txt === '维修' ? '维修中' : '保养中') + ' · 可预约'; freeColor = 'var(--warn)'; }
    else if (['booked', 'restricted-booked', 'past'].includes(c.cls)) {
      const books = state.reservations.filter(r => r.vehicleId === v.id && r.date === ds && r.status !== 'cancelled');
      if (books.length) {
        infoHtml = books.map(b => `🕐 ${b.startTime || ''}-${b.endTime || ''} 👤 <b>${b.applicant || '?'}</b> ${destLink(b)}`).join('<br>');
        freeText = '';
      } else { freeText = ds < todayStr() ? '无人预约' : '可预约'; freeColor = 'var(--text3)'; }
    } else { freeText = rest ? '限行 · 7:00-20:00 五环内' : '可预约'; freeColor = rest ? 'var(--err)' : 'var(--ok)'; }
    const isSel = v.id === state.calSelVehicleId;
    return `<div class="detail-row ${isSel ? 'detail-sel' : ''}"><span class="detail-plate">${v.plate}</span><div class="detail-info">${infoHtml || `<span class="detail-free" style="color:${freeColor}">${freeText}</span>`}</div>${canBook ? `<button class="detail-go" data-vid="${v.id}" data-ds="${ds}">预约此车 →</button>` : ''}</div>`;
  }).join('');
  box.innerHTML = `<div class="detail-hd"><span class="detail-date">${d.getMonth() + 1}月${d.getDate()}日 ${WD[d.getDay()]}</span></div>${rows}`;
}

/* ================= 预约 ================= */
function buildDateStrip() {
  const out = []; const t = todayObj();
  for (let i = 0; i < 14; i++) { const d = new Date(t); d.setDate(t.getDate() + i); out.push({ ds: fmt(d), m: d.getMonth() + 1, d: d.getDate(), label: wkLabel(d), weekend: d.getDay() === 0 || d.getDay() === 6 }); }
  return out;
}
function renderBooking() {
  const bk = state.bk;
  const strip = buildDateStrip();
  if (!bk.selDate || !strip.find(s => s.ds === bk.selDate)) bk.selDate = strip[0].ds;
  const vehiclesHTML = state.vehicles.map(v => {
    const st = vehicleStatus(v, bk.selDate);
    const disabled = st.cls === 'damage';
    const badgeColor = st.cls === 'damage' ? '#6b7280' : st.cls === 'normal' ? 'var(--ok)' : st.cls === 'warning' ? 'var(--warn)' : 'var(--err)';
    const badgeBg = st.cls === 'damage' ? '#eceef1' : st.cls === 'normal' ? 'var(--ok-bg)' : st.cls === 'warning' ? 'var(--warn-bg)' : 'var(--err-bg)';
    return `<div class="vp ${bk.selVehicleId === v.id ? 'active' : ''} ${disabled ? 'disabled' : ''}" data-vid="${v.id}">${v.plate}<span class="vps" style="color:${badgeColor};background:${badgeBg}">${st.text}</span></div>`;
  }).join('');
  const datesHTML = strip.map(s => `<div class="dc ${bk.selDate === s.ds ? 'active' : ''} ${s.weekend ? 'weekend' : ''}" data-ds="${s.ds}"><span class="dcd">${s.m}/${s.d}</span><span class="dcw">${s.label}</span></div>`).join('');
  let alert = '';
  if (!bk.selVehicleId) alert = `<div class="alert alert-w">请选择车辆</div>`;
  else { const v = state.vehicles.find(x => x.id === bk.selVehicleId); const st = vehicleStatus(v, bk.selDate); if (st.cls === 'damage') alert = `<div class="alert alert-e">该车已损坏，不可预约</div>`; else if (st.cls === 'restricted') alert = `<div class="alert alert-w">该车当日限行（7:00-20:00），仍可预约</div>`; else if (st.cls === 'warning') alert = `<div class="alert alert-w">该车当日${st.text}中，仍可预约</div>`; else alert = `<div class="alert alert-o">此车辆状态正常，可预约</div>`; }
  const canSubmit = !!(bk.selVehicleId && bk.selDate && bk.userPerson);
  const evOptions = EVENT_TYPES.map(e => `<option value="${e}" ${bk.eventType === e ? 'selected' : ''}>${e}</option>`).join('');
  $('#bookingView').innerHTML = `
    <div class="bk-card"><div class="bk-step"><span class="num">1</span> 车辆</div>
      <div class="vpick">${vehiclesHTML}</div>${alert}</div>
    <div class="bk-card"><div class="bk-step"><span class="num">2</span> 日期</div>
      <div class="dstrip">${datesHTML}</div></div>
    <div class="bk-card"><div class="bk-step"><span class="num">3</span> 时间</div>
      <div class="time-row"><input type="time" id="bkStart" class="fg-input" value="${bk.startTime}"><span style="font-weight:700;color:var(--text3)">—</span><input type="time" id="bkEnd" class="fg-input" value="${bk.endTime}"></div></div>
    <div class="bk-card"><div class="bk-step"><span class="num">4</span> 信息</div>
      <div class="fg"><label class="fg-label">使用人</label><input id="bkUser" class="fg-input" placeholder="请输入姓名" value="${bk.userPerson}"></div>
      <div class="fg"><label class="fg-label">事项（选填）</label><select id="bkEvent" class="fg-input"><option value="">如：开会、验收、接机</option>${evOptions}</select></div>
      <div class="fg"><label class="fg-label">目的地（选填）</label>
        <div class="dest-row">
          <input id="bkDest" class="fg-input" placeholder="如：望京SOHO" value="${escapeHtml(bk.destAddress || bk.purpose)}">
          <button id="bkMapPick" class="btn-map" type="button">📍 地图选点</button>
        </div>
        <div id="bkMapInfo" class="map-info ${bk.destLng != null ? 'show' : ''}">${bk.destLng != null ? ('已选坐标：' + Number(bk.destLat).toFixed(6) + ', ' + Number(bk.destLng).toFixed(6)) : '未标注坐标，可点击「地图选点」在地图上选位置'}</div>
      </div>
      <div class="fg"><label class="fg-label">备注（选填）</label><input id="bkNote" class="fg-input" placeholder="如有特殊需求请注明" value="${bk.note}"></div>
      <button id="bkSubmit" class="btn-primary" ${canSubmit ? '' : 'disabled'}>确认预约</button>
    </div>`;
}
async function openMapPicker() {
  const bk = state.bk;
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
  openModal('选择目的地位置', body, async (sheet) => {
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
}
async function submitBooking() {
  const bk = state.bk;
  bk.startTime = $('#bkStart').value; bk.endTime = $('#bkEnd').value;
  bk.userPerson = $('#bkUser').value.trim(); bk.eventType = $('#bkEvent').value;
  bk.purpose = $('#bkDest').value.trim(); bk.note = $('#bkNote').value.trim();
  if (!bk.selVehicleId || !bk.selDate || !bk.userPerson) { toast('请完善信息'); return; }
  if (bk.startTime >= bk.endTime) { toast('结束时间须晚于开始时间'); return; }
  const v = state.vehicles.find(x => x.id === bk.selVehicleId);
  const body = { vehicleId: bk.selVehicleId, date: bk.selDate, allDay: false, startTime: bk.startTime, endTime: bk.endTime, applicant: bk.userPerson, purpose: bk.eventType, destination: bk.purpose, notes: bk.note, destLng: bk.destLng, destLat: bk.destLat, destAddress: bk.destAddress };
  const restricted = isRestrictedForBooking(bk.selDate, v.plate, bk.startTime, bk.endTime);
  const conflict = hasConflict(bk.selVehicleId, bk.selDate, bk.startTime, bk.endTime);
  if (restricted && !confirm(`⚠️ 限行提醒\n${v.plate} 在 ${bk.selDate} 限行。\n确认仍要预约吗？`)) return;
  if (conflict && !confirm(`⚠️ 时间冲突\n该车辆在此时间段已有预约。\n确认仍要预约吗？`)) return;
  const r = await api('/reservations', { method: 'POST', body });
  if (r.ok) {
    toast('预约成功');
    state.bk = { selVehicleId: null, selDate: null, startTime: '09:00', endTime: '12:00', userPerson: '', eventType: '', purpose: '', note: '', destLng: null, destLat: null, destAddress: '' };
    await reload(); switchView('calendar');
  } else { toast((r.data && r.data.error) || '预约失败'); }
}

/* ================= 记录 ================= */
const REC_STATUS = { pending: '待使用', active: '使用中', completed: '已完成', cancelled: '已取消' };
function applyRecFilter(list) {
  const today = todayStr(); const u = state.user;
  let f = state.recFilter;
  if (f === 'today') return list.filter(r => r.date === today);
  if (f === 'upcoming') return list.filter(r => r.date >= today && r.status !== 'cancelled');
  if (f === 'completed') return list.filter(r => r.status === 'completed' || r.status === 'cancelled' || r.date < today);
  if (f === 'mine') return list.filter(r => r.createdBy === u.userId || r.applicant === u.displayName);
  return list;
}
function renderRecords() {
  const filters = [['all', '全部'], ['mine', '我的预约'], ['upcoming', '即将出行'], ['today', '今日'], ['completed', '已完成']];
  $('#recFilters').innerHTML = filters.map(([k, l]) => `<div class="fc ${state.recFilter === k ? 'active' : ''}" data-key="${k}">${l}</div>`).join('');
  let list = applyRecFilter(state.reservations.slice()).sort((a, b) => (b.date + (b.startTime || '')).localeCompare(a.date + (a.startTime || '')));
  if (!list.length) { $('#recList').innerHTML = `<div class="empty-state">暂无记录</div>`; return; }
  const months = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
  const groups = {};
  list.forEach(r => { const ym = r.date.slice(0, 7); (groups[ym] = groups[ym] || []).push(r); });
  const html = Object.keys(groups).sort().reverse().map(ym => {
    const [y, m] = ym.split('-');
    const items = groups[ym].map(r => {
      const v = state.vehicles.find(x => x.id === r.vehicleId);
      const canCancel = (r.status === 'pending' || r.status === 'active') && (state.user.role === 'admin' || r.createdBy === state.user.userId);
      const lines = [`🕐 ${r.startTime || ''}-${r.endTime || ''}`, `预约 <b>${r.createdName || '?'}</b>`, `使用 <b>${r.applicant || '?'}</b>`];
      const dl = destLink(r); if (dl) lines.push(dl);
      if (r.purpose) lines.push(`事项 ${r.purpose}`);
      return `<div class="rec"><div class="rec-top"><span class="rec-plate">${v ? v.plate : '?'}</span><span class="rec-status ${r.status}">${REC_STATUS[r.status] || r.status}</span></div>
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
  const rows = list.map(r => { const v = state.vehicles.find(x => x.id === r.vehicleId); return [r.date, r.startTime, r.endTime, v ? v.plate : '', r.applicant, r.createdName, r.purpose, r.destination, REC_STATUS[r.status] || r.status]; });
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
      <div class="account-actions"><span id="pwdChange">修改密码</span><span class="danger" id="mineLogout">退出登录</span></div>`;
    return;
  }
  if (!state.users.length) { const r = await api('/admin/users'); if (r.ok) state.users = r.data; }
  const tabs = `<div class="mg-tabs"><div class="mg-tab ${state.mineTab === 'vehicles' ? 'active' : ''}" data-tab="vehicles">车辆管理</div><div class="mg-tab ${state.mineTab === 'people' ? 'active' : ''}" data-tab="people">人员管理</div><div class="mg-tab ${state.mineTab === 'restrictions' ? 'active' : ''}" data-tab="restrictions">限行规则</div></div>`;
  let body = '';
  if (state.mineTab === 'vehicles') body = renderVehiclesTab();
  else if (state.mineTab === 'people') body = renderPeopleTab();
  else body = renderRestrictionsTab();
  root.innerHTML = tabs + body;
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
  return `<button class="mg-add" id="addRule">+ 添加限行方案</button>${cards || '<div class="empty-state">暂无限行方案</div>'}`;
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
  $$('.nav-item, .tab-btn').forEach(b => b.onclick = () => switchView(b.dataset.view));
  $('#sideLogout').onclick = doLogout;

  // 桌面 / 手机视图切换
  $('#deviceToggle').onclick = () => {
    const on = $('#app').classList.toggle('force-mobile');
    $('#deviceToggle').classList.toggle('active', on);
    $('#deviceToggle').textContent = on ? '🖥️ 桌面视图' : '📱 手机视图';
  };

  // 日历
  $('#calFixed').addEventListener('click', e => { const row = e.target.closest('.cf-row'); if (row) { state.openBooking = { vehicleId: row.dataset.vid, date: state.calSelDate || todayStr() }; switchView('booking'); } });
  $('#calHead').addEventListener('click', e => { const c = e.target.closest('.ch-cell'); if (c) { state.calSelDate = c.dataset.ds; renderCalendar(); } });
  $('#calRows').addEventListener('click', e => { const c = e.target.closest('.cal-cell'); if (!c) return; if (c.classList.contains('unavailable')) return; state.calSelDate = c.dataset.ds; state.calSelVehicleId = c.dataset.vid; renderCalendar(); });
  $('#calDetail').addEventListener('click', e => { const b = e.target.closest('.detail-go'); if (b) { state.openBooking = { vehicleId: b.dataset.vid, date: b.dataset.ds }; switchView('booking'); } });

  // 预约
  $('#bookingView').addEventListener('click', e => {
    const vp = e.target.closest('.vp'); if (vp && !vp.classList.contains('disabled')) { state.bk.selVehicleId = vp.dataset.vid; renderBooking(); }
    const dc = e.target.closest('.dc'); if (dc) { state.bk.selDate = dc.dataset.ds; renderBooking(); }
    if (e.target.id === 'bkSubmit') submitBooking();
    if (e.target.id === 'bkMapPick') openMapPicker();
  });
  $('#bookingView').addEventListener('input', e => {
    if (e.target.id === 'bkUser') { state.bk.userPerson = e.target.value.trim(); $('#bkSubmit').disabled = !(state.bk.selVehicleId && state.bk.selDate && state.bk.userPerson); }
  });

  // 记录
  $('#recFilters').addEventListener('click', e => { const f = e.target.closest('.fc'); if (f) { state.recFilter = f.dataset.key; renderRecords(); } });
  $('#recList').addEventListener('click', e => {
    const c = e.target.closest('.rec-cancel'); if (c) { cancelRes(c.dataset.id); return; }
    const g = e.target.closest('.rec-grp-hd'); if (g) { g.classList.toggle('folded'); const b = g.nextElementSibling; if (b) b.classList.toggle('folded'); }
  });
  $('#recExport').onclick = exportCSV;

  // 我的
  $('#mineView').addEventListener('click', e => {
    const t = e.target.closest('.mg-tab'); if (t) { state.mineTab = t.dataset.tab; renderMine(); return; }
    if (e.target.id === 'addVehicle') return openVehicleModal();
    const ev = e.target.closest('[data-edit]'); if (ev) return openVehicleModal(state.vehicles.find(v => v.id === ev.dataset.edit));
    const dv = e.target.closest('[data-del]'); if (dv) { if (confirm('确定删除该车辆？')) api('/vehicles/' + dv.dataset.del, { method: 'DELETE' }).then(async () => { toast('已删除'); await reload(); }); return; }
    const pv = e.target.closest('[data-pvid]'); if (pv) return openPeriodModal(pv.dataset.pvid);
    const pd = e.target.closest('.v-per-del'); if (pd) { if (confirm('删除此状态记录？')) api('/vehicles/' + pd.dataset.vid + '/periods/' + pd.dataset.pid, { method: 'DELETE' }).then(async () => { toast('已删除'); await reload(); }); return; }
    if (e.target.id === 'addPerson') return openPersonModal();
    const du = e.target.closest('[data-deluser]'); if (du) {
      if (du.dataset.role === 'admin' && state.users.filter(u => u.role === 'admin').length <= 1) { toast('至少保留一位管理员'); return; }
      if (confirm('确定删除该用户？')) api('/admin/users/' + du.dataset.deluser, { method: 'DELETE' }).then(async () => { toast('已删除'); state.users = []; await reload(); });
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

/* ================= 启动 ================= */
(async function init() {
  bindEvents();
  const ok = await restoreAuth();
  setAuthUI();
  if (ok) await loadAll();
})();
