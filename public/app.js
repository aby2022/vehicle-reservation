'use strict';

/* ============================ 全局状态 ============================ */
const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth(),
  vehicles: [], reservations: [], restriction: null,
  user: null,                 // {role, username, displayName}
  token: localStorage.getItem('vr_token') || ''
};

const PALETTE = ['#2563eb','#16a34a','#db2777','#d97706','#7c3aed','#0891b2','#dc2626','#65a30d','#9333ea','#0d9488'];
function colorFor(id){ let h=0; for(const c of id) h=(h*31+c.charCodeAt(0))>>>0; return PALETTE[h%PALETTE.length]; }
function genId(){ return Math.random().toString(16).slice(2, 14); }

/* ============================ 工具 ============================ */
const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
function fmt(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; }
function todayStr(){ const t=new Date(); return fmt(t.getFullYear(),t.getMonth(),t.getDate()); }
function weekdayCn(wd){ return '日一二三四五六'[wd]; }
function isAdmin(){ return !!state.user && state.user.role==='admin'; }
function isLoggedIn(){ return !!state.user; }

function getTail(plate) {
  if (!plate) return null;
  const s = String(plate).replace(/\s/g, '');
  const last = s[s.length - 1];
  if (/\d/.test(last)) return parseInt(last, 10);
  return null;
}

/** 找到覆盖指定日期的限行方案（endDate 留空=长期） */
function findPeriod(dateStr, restriction) {
  if (!restriction || !Array.isArray(restriction.periods)) return null;
  return restriction.periods.find(p => {
    const start = p.startDate || '';
    const end = p.endDate || '9999-12-31';
    return dateStr >= start && dateStr <= end;
  }) || null;
}
/** 该日期的限行信息（与后端一致） */
function dayRestrictionInfo(dateStr, restriction) {
  if (!restriction || !restriction.enabled) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const wd = d.getDay();
  if ((wd === 0 || wd === 6) && !restriction.weekendRestricted) return null;
  const period = findPeriod(dateStr, restriction);
  if (!period) return null;
  const rule = (period.rules || []).find(r => r.weekday === wd);
  if (!rule || !(rule.tails || []).length) return null;
  const win = (period.peakStart && period.peakEnd) ? { start: period.peakStart, end: period.peakEnd } : null;
  return { tails: rule.tails, window: win, periodName: period.name };
}

let toastTimer;
function toast(msg, ms=2200){ const t=$('#toast'); t.textContent=msg; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.add('hidden'), ms); }

/* ============================ API ============================ */
async function api(method, path, body){
  const headers = { 'Content-Type': 'application/json' };
  if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
  const res = await fetch('/api'+path, { method, headers, body: body?JSON.stringify(body):undefined });
  let data=null; try{ data=await res.json(); }catch{}
  return { status: res.status, data };
}

/* ============================ 鉴权 UI ============================ */
function setAuthUI(){
  const u = state.user;
  $('#userState').textContent = u ? (u.displayName || u.username) + (u.role==='admin'?'（管理员）':'') : '未登录';
  $('#loginBtn').classList.toggle('hidden', !!u);
  $('#registerBtn').classList.toggle('hidden', !!u);
  $('#logoutBtn').classList.toggle('hidden', !u);
  $('#tabManage').style.display = isAdmin() ? '' : 'none';
  $$('.admin-only').forEach(e=>e.classList.toggle('hidden', !isAdmin()));
  if (!isAdmin() && $('#view-manage').classList.contains('active')) {
    $$('.tab').forEach(x=>x.classList.remove('active'));
    $('.tab[data-view="calendar"]').classList.add('active');
    $$('.view').forEach(v=>v.classList.remove('active'));
    $('#view-calendar').classList.add('active');
  }
}
function openAuthModal(mode){
  $('#authMsg').classList.add('hidden');
  setAuthMode(mode || 'login');
  $('#authModal').classList.remove('hidden');
  if (mode==='login') $('#loginUser').focus(); else $('#regUser').focus();
}
function setAuthMode(mode){
  const login = mode==='login';
  $('#authTitle').textContent = login ? '登录' : '注册';
  $('#toLogin').classList.toggle('active', login);
  $('#toRegister').classList.toggle('active', !login);
  $('#loginForm').classList.toggle('hidden', !login);
  $('#registerForm').classList.toggle('hidden', login);
  $('#authSubmit').textContent = login ? '登录' : '注册并登录';
}
async function submitAuth(){
  const login = $('#loginForm').classList.contains('hidden') === false;
  if (login){
    const username=$('#loginUser').value.trim(), password=$('#loginPwd').value;
    if(!username||!password){ toast('请输入用户名和密码'); return; }
    const {status,data}=await api('POST','/auth/login',{username,password});
    if(status===200){ applyAuth(data); toast('登录成功'); $('#authModal').classList.add('hidden'); }
    else { showAuthMsg(data.error||'登录失败'); }
  } else {
    const username=$('#regUser').value.trim(), password=$('#regPwd').value, displayName=$('#regName').value.trim();
    if(!username||!password){ toast('请填写用户名和密码'); return; }
    const {status,data}=await api('POST','/register',{username,password,displayName});
    if(status===201){ applyAuth(data); toast('注册成功，欢迎！'); $('#authModal').classList.add('hidden'); }
    else { showAuthMsg(data.error||'注册失败'); }
  }
}
function showAuthMsg(m){ const e=$('#authMsg'); e.textContent=m; e.classList.remove('hidden'); }
function applyAuth(data){
  state.token=data.token; state.user={ role:data.role, username:data.username, displayName:data.displayName };
  localStorage.setItem('vr_token', data.token);
  setAuthUI(); loadAll();
}
async function logout(){
  if(state.token) await api('POST','/auth/logout');
  state.token=''; state.user=null; localStorage.removeItem('vr_token');
  setAuthUI(); toast('已退出'); await loadAll();
}
async function restoreAuth(){
  if(!state.token) return;
  const {status,data}=await api('GET','/auth/me');
  if(status===200){ state.user={role:data.role,username:data.username,displayName:data.displayName}; }
  else { state.token=''; localStorage.removeItem('vr_token'); }
}

/* ============================ 数据加载 ============================ */
async function loadAll(){
  const [vRes,rRes,restRes]=await Promise.all([
    api('GET','/vehicles'), api('GET','/reservations'), api('GET','/restriction')
  ]);
  state.vehicles=vRes.data||[]; state.reservations=rRes.data||[]; state.restriction=restRes.data;
  if(state.restriction){
    $('#restEnabled').checked=state.restriction.enabled;
    $('#restCity').value=state.restriction.city||'';
    $('#restWeekend').checked=!!state.restriction.weekendRestricted;
    $('#restNote').value=state.restriction.note||'';
    renderPeriods();
  }
  const site=(await api('GET','/settings')).data;
  if(site&&site.siteName) $('#siteName').textContent=site.siteName;
  fillVehicleSelects(); renderVehicleList(); renderCalendar(); renderStats();
}

/* ============================ 日历 ============================ */
function renderCalendar(){
  const {year,month}=state; const filter=$('#vehicleFilter').value;
  $('#calTitle').textContent=`${year}年 ${month+1}月`;
  const first=new Date(year,month,1);
  const startWeekday=(first.getDay()+6)%7;
  const daysInMonth=new Date(year,month+1,0).getDate();
  const today=todayStr();
  const byDate={};
  for(const r of state.reservations){
    if(filter&&r.vehicleId!==filter) continue;
    (byDate[r.date]=byDate[r.date]||[]).push(r);
  }
  const grid=$('#calGrid'); grid.innerHTML='';
  const cells=[];
  for(let i=0;i<startWeekday;i++) cells.push(null);
  for(let d=1;d<=daysInMonth;d++) cells.push(d);
  while(cells.length%7!==0) cells.push(null);
  for(const d of cells){
    const cell=document.createElement('div');
    if(d===null){ cell.className='cal-cell out'; grid.appendChild(cell); continue; }
    const dateStr=fmt(year,month,d);
    cell.className='cal-cell'+(dateStr===today?' today':'');
    cell.dataset.date=dateStr;
    const num=document.createElement('div'); num.className='dnum'; num.textContent=d; cell.appendChild(num);
    const dr=dayRestrictionInfo(dateStr, state.restriction);
    if(dr){
      const badge=document.createElement('div'); badge.className='restrict';
      badge.title=(dr.periodName||'')+'\n限行尾号 '+dr.tails.join(',')+(dr.window?('；时段 '+dr.window.start+'-'+dr.window.end):'（全天）');
      badge.textContent='限'+dr.tails.join(',')+(dr.window?(' '+dr.window.start+'-'+dr.window.end):'');
      cell.appendChild(badge);
    }
    for(const r of (byDate[dateStr]||[])){
      const v=state.vehicles.find(x=>x.id===r.vehicleId);
      const item=document.createElement('div');
      item.className='resv-item'+(r.forced?' forced':'');
      item.style.borderLeftColor=v?colorFor(v.id):'#64748b';
      const time=r.allDay?'全天':`${r.startTime||''}-${r.endTime||''}`;
      const sub=[r.applicant||'匿名', r.destination].filter(Boolean).join(' · ');
      item.innerHTML=`<div class="ri-top"><span>${v?v.plate:'?'}</span><span class="ri-time">${time}</span></div>`+
                     (sub?`<div class="ri-sub">${sub}</div>`:'');
      item.title=`${v?v.name:''} ${r.purpose||''}`.trim();
      item.dataset.id=r.id;
      cell.appendChild(item);
    }
    grid.appendChild(cell);
  }
}

/* ============================ 限行方案（日期区间）管理 ============================ */
function renderPeriods(){
  const wrap=$('#periodsWrap'); wrap.innerHTML='';
  const periods=state.restriction.periods||[];
  if(!periods.length){
    wrap.innerHTML='<p class="hint">暂无限行方案。点击"添加限行方案"新建一个日期区间（如 2025.8.22-2025.11.23 的尾号组合）；未落入任何方案的日期不限行。</p>';
    return;
  }
  periods.forEach((p, pi)=>{
    const card=document.createElement('div');
    card.className='period-card'; card.dataset.pi=pi;
    let rows='';
    for(let wd=1;wd<=5;wd++){
      const rule=(p.rules||[]).find(r=>r.weekday===wd)||{tails:[]};
      rows+=`<tr><td>周${weekdayCn(wd)}</td>`+
        `<td><input class="p-tails" data-pi="${pi}" data-wd="${wd}" value="${(rule.tails||[]).join(',')}" placeholder="如 1,6" /></td></tr>`;
    }
    card.innerHTML=
      `<div class="period-head">`+
        `<input class="p-name" data-pi="${pi}" value="${p.name||''}" placeholder="方案名称（如 2025.8.22-11.23 限行方案）" />`+
        `<button class="btn btn-sm btn-danger del-period" data-pi="${pi}">删除方案</button>`+
      `</div>`+
      `<div class="period-range">`+
        `<label>开始日期<input type="date" class="p-start" data-pi="${pi}" value="${p.startDate||''}" /></label>`+
        `<label>结束日期<input type="date" class="p-end" data-pi="${pi}" value="${p.endDate||''}" placeholder="留空=长期有效" /></label>`+
        `<label>每日限行时段<input type="time" class="p-peak-start" data-pi="${pi}" value="${p.peakStart||''}" /> - <input type="time" class="p-peak-end" data-pi="${pi}" value="${p.peakEnd||''}" /></label>`+
      `</div>`+
      `<table class="rule-table"><thead><tr><th>星期</th><th>限行尾号</th></tr></thead><tbody>${rows}</tbody></table>`;
    wrap.appendChild(card);
  });
  $$('.del-period').forEach(b=>b.onclick=()=>{
    const pi=parseInt(b.dataset.pi,10);
    state.restriction.periods.splice(pi,1);
    renderPeriods();
  });
}
function addPeriod(){
  if(!isAdmin()){ toast('需要管理员权限'); return; }
  state.restriction.periods=state.restriction.periods||[];
  state.restriction.periods.push({
    id: genId(), name: '', startDate: '', endDate: '',
    peakStart: '07:00', peakEnd: '20:00',
    rules: [1,2,3,4,5].map(wd=>({ weekday: wd, tails: [] }))
  });
  renderPeriods();
}
async function saveRestriction(){
  if(!isAdmin()){ toast('需要管理员权限'); return; }
  const periods=[];
  $$('#periodsWrap .period-card').forEach(card=>{
    const pi=parseInt(card.dataset.pi,10);
    const name=$(`.p-name[data-pi="${pi}"]`).value.trim();
    const startDate=$(`.p-start[data-pi="${pi}"]`).value;
    const endDate=$(`.p-end[data-pi="${pi}"]`).value;
    const peakStart=$(`.p-peak-start[data-pi="${pi}"]`).value;
    const peakStartVal=peakStart||undefined;
    const peakEndVal=$(`.p-peak-end[data-pi="${pi}"]`).value||undefined;
    const rules=[];
    $$('.p-tails[data-pi="'+pi+'"]').forEach(inp=>{
      const wd=parseInt(inp.dataset.wd,10);
      const tails=inp.value.split(',').map(s=>parseInt(s.trim(),10)).filter(n=>!isNaN(n)&&n>=0&&n<=9);
      rules.push({ weekday: wd, tails });
    });
    periods.push({
      id: (state.restriction.periods[pi]&&state.restriction.periods[pi].id)||genId(),
      name, startDate, endDate,
      peakStart: peakStartVal, peakEnd: peakEndVal, rules
    });
  });
  const body={ enabled:$('#restEnabled').checked, city:$('#restCity').value.trim(),
    weekendRestricted:$('#restWeekend').checked, note:$('#restNote').value.trim(), periods };
  const {status,data}=await api('PUT','/restriction',body);
  if(status===200){ state.restriction=data; renderPeriods(); renderCalendar(); toast('限行规则已保存'); }
  else toast('保存失败');
}

/* ============================ 预约弹窗 ============================ */
let forceNext=false;
function openResvModal(dateStr, resvId){
  if(!isLoggedIn()){ toast('请先登录后再预约'); openAuthModal('login'); return; }
  forceNext=false; $('#resvWarn').classList.add('hidden');
  fillVehicleSelects($('#resvVehicle'));
  if(resvId){
    const r=state.reservations.find(x=>x.id===resvId);
    if(r.createdBy && !isAdmin() && r.createdBy!==state.user.userId){ toast('只能修改自己的预约'); return; }
    $('#resvModalTitle').textContent='编辑预约';
    $('#resvId').value=r.id;
    $('#resvVehicle').value=r.vehicleId;
    $('#resvDate').value=r.date;
    $('#resvAllDay').checked=!!r.allDay;
    $('#resvStart').value=r.startTime||'09:00';
    $('#resvEnd').value=r.endTime||'17:00';
    $('#resvApplicant').value=r.applicant||'';
    $('#resvPurpose').value=r.purpose||'';
    $('#resvDest').value=r.destination||'';
    $('#resvNotes').value=r.notes||'';
    $('#resvDelete').classList.toggle('hidden', !(isAdmin()||r.createdBy===state.user.userId));
    $('#timeRow').style.display=r.allDay?'none':'flex';
  } else {
    $('#resvModalTitle').textContent='新增预约';
    $('#resvId').value='';
    $('#resvVehicle').selectedIndex=0;
    $('#resvDate').value=dateStr||todayStr();
    $('#resvAllDay').checked=false;
    $('#resvStart').value='09:00'; $('#resvEnd').value='17:00';
    $('#resvApplicant').value=state.user.displayName||'';
    $('#resvPurpose').value=''; $('#resvDest').value=''; $('#resvNotes').value='';
    $('#resvDelete').classList.add('hidden');
    $('#timeRow').style.display='flex';
  }
  $('#resvModal').classList.remove('hidden');
  updateResvRestrictionHint();
}
/** 预约弹窗内实时提示：所选日期+车辆是否限行 */
function updateResvRestrictionHint(){
  const hint=$('#resvRestHint');
  const vehicleId=$('#resvVehicle').value;
  const dateStr=$('#resvDate').value;
  const v=state.vehicles.find(x=>x.id===vehicleId);
  if(!v||!dateStr){ hint.textContent=''; hint.className='hint'; return; }
  const info=dayRestrictionInfo(dateStr, state.restriction);
  const tail=getTail(v.plate);
  if(!info||tail===null){ hint.textContent='该日期无限行方案（不限行）'; hint.className='hint ok'; return; }
  if(info.tails.includes(tail)){
    const win=info.window?`（每日限行时段 ${info.window.start}-${info.window.end}）`:'（全天限行）';
    hint.textContent=`⚠️ 该车尾号 ${tail} 在 ${dateStr} 限行${win}`; hint.className='hint bad';
  } else {
    hint.textContent=`该车尾号 ${tail} 在 ${dateStr} 不限行`; hint.className='hint ok';
  }
}
async function saveResv(){
  if(!isLoggedIn()){ toast('请先登录'); openAuthModal('login'); return; }
  const id=$('#resvId').value;
  const body={
    vehicleId:$('#resvVehicle').value, date:$('#resvDate').value,
    allDay:$('#resvAllDay').checked, startTime:$('#resvStart').value, endTime:$('#resvEnd').value,
    applicant:$('#resvApplicant').value, purpose:$('#resvPurpose').value,
    destination:$('#resvDest').value, notes:$('#resvNotes').value, force:forceNext
  };
  if(!body.vehicleId||!body.date){ toast('请选择车辆与日期'); return; }
  const {status,data}=await api(id?'PUT':'POST','/reservations'+(id?'/'+id:''),body);
  if(status===401){ toast('登录已失效，请重新登录'); openAuthModal('login'); return; }
  if(status===409&&data&&data.error==='tail_restricted'&&!forceNext){
    const w=$('#resvWarn'); w.textContent='⚠️ '+data.message+'。如确需预约，可强制保存。';
    w.classList.remove('hidden'); forceNext=true; $('#resvSave').textContent='强制保存'; return;
  }
  if(status===409){ toast(data.message||'冲突'); return; }
  if(status===403){ toast(data.error||'无权限'); return; }
  if(status===200||status===201){ $('#resvModal').classList.add('hidden'); toast('已保存'); await refreshReservations(); return; }
  toast('保存失败');
}
async function deleteResv(){
  const id=$('#resvId').value; if(!id) return;
  if(!confirm('确认删除该预约？')) return;
  const {status}=await api('DELETE','/reservations/'+id);
  if(status===200){ $('#resvModal').classList.add('hidden'); toast('已删除'); await refreshReservations(); }
  else if(status===403){ toast('只能删除自己的预约'); }
  else toast('删除失败');
}
async function refreshReservations(){
  const {data}=await api('GET','/reservations');
  state.reservations=data||[];
  renderCalendar(); renderStats();
}

/* ============================ 车辆管理 ============================ */
function fillVehicleSelects(sel){
  sel=sel||$('#vehicleFilter');
  const isFilter=sel===$('#vehicleFilter');
  sel.innerHTML=isFilter?'<option value="">全部车辆</option>':'';
  for(const v of state.vehicles){
    const o=document.createElement('option'); o.value=v.id; o.textContent=`${v.name}（${v.plate}）`; sel.appendChild(o);
  }
}
function renderVehicleList(){
  const wrap=$('#vehicleList'); wrap.innerHTML='';
  for(const v of state.vehicles){
    const row=document.createElement('div'); row.className='vrow';
    row.innerHTML=`<div><div class="vname">${v.name}</div><div class="vplate">${v.plate} · ${v.type||''}</div></div>`+
      `<span class="vstatus ${v.status}">${v.status==='available'?'可用':'维修中'}</span>`+
      (isAdmin()?`<div class="ops"><button class="btn btn-sm edit-v" data-id="${v.id}">编辑</button>`+
      `<button class="btn btn-sm btn-danger del-v" data-id="${v.id}">删除</button></div>`:'');
    wrap.appendChild(row);
  }
  $$('.edit-v').forEach(b=>b.onclick=()=>openVehicleModal(b.dataset.id));
  $$('.del-v').forEach(b=>b.onclick=()=>delVehicle(b.dataset.id));
}
function openVehicleModal(id){
  if(!isAdmin()){ toast('需要管理员权限'); return; }
  const v=id?state.vehicles.find(x=>x.id===id):null;
  $('#vehId').value=v?v.id:'';
  $('#vehPlate').value=v?v.plate:'';
  $('#vehName').value=v?v.name:'';
  $('#vehType').value=v?v.type:'';
  $('#vehStatus').value=v?v.status:'available';
  $('#vehNotes').value=v?v.notes:'';
  $('#vehicleFormWrap').classList.remove('hidden');
}
async function saveVehicle(){
  const id=$('#vehId').value;
  const body={ plate:$('#vehPlate').value.trim(), name:$('#vehName').value.trim(),
    type:$('#vehType').value.trim(), status:$('#vehStatus').value, notes:$('#vehNotes').value.trim() };
  if(!body.plate||!body.name){ toast('车牌与名称必填'); return; }
  const {status}=await api(id?'PUT':'POST','/vehicles'+(id?'/'+id:''),body);
  if(status===401){ toast('需要管理员权限'); return; }
  if(status===200||status===201){ $('#vehicleFormWrap').classList.add('hidden');
    const {data}=await api('GET','/vehicles'); state.vehicles=data;
    fillVehicleSelects(); renderVehicleList(); renderCalendar(); toast('已保存'); }
  else toast('保存失败');
}
async function delVehicle(id){
  if(!confirm('删除车辆将同时删除其全部预约，确认？')) return;
  const {status}=await api('DELETE','/vehicles/'+id);
  if(status===200){ const {data}=await api('GET','/vehicles'); state.vehicles=data;
    await refreshReservations(); renderVehicleList(); toast('已删除'); }
}

/* ============================ 统计 ============================ */
async function renderStats(){
  const {data:s}=await api('GET','/stats'); if(!s) return;
  $('#statCards').innerHTML=`
    <div class="stat-card"><div class="num">${s.total}</div><div class="lbl">车辆总数</div></div>
    <div class="stat-card"><div class="num" style="color:var(--ok)">${s.available}</div><div class="lbl">可用</div></div>
    <div class="stat-card"><div class="num" style="color:var(--danger)">${s.maintenance}</div><div class="lbl">维修中</div></div>
    <div class="stat-card"><div class="num">${s.upcoming}</div><div class="lbl">未来预约</div></div>
    <div class="stat-card"><div class="num">${s.past}</div><div class="lbl">历史预约</div></div>`;
  const max=Math.max(1,...s.byVehicle.map(x=>x.count));
  $('#usageRank').innerHTML=s.byVehicle.map(v=>`<div class="rank-row"><span style="width:160px">${v.name} <small style="color:var(--muted)">${v.plate}</small></span><div class="rank-bar"><span style="width:${v.count/max*100}%"></span></div><span style="width:40px;text-align:right">${v.count}</span></div>`).join('')||'<p style="color:var(--muted)">暂无数据</p>';
  $('#recentList').innerHTML=s.recent.map(r=>{ const v=state.vehicles.find(x=>x.id===r.vehicleId);
    return `<div class="recent-item">${r.date} ${r.startTime||''}-${r.endTime||''} · ${v?v.name:'?'} · ${r.applicant||'匿名'} · ${r.purpose||''}</div>`;
  }).join('')||'<p style="color:var(--muted)">暂无预约</p>';
}

/* ============================ 事件绑定 ============================ */
function bindEvents(){
  $$('.tab').forEach(t=>t.onclick=()=>{
    if(t.id==='tabManage'&&!isAdmin()){ toast('需要管理员权限'); return; }
    $$('.tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
    $$('.view').forEach(v=>v.classList.remove('active'));
    $('#view-'+t.dataset.view).classList.add('active');
    if(t.dataset.view==='stats') renderStats();
  });
  $('#loginBtn').onclick=()=>openAuthModal('login');
  $('#registerBtn').onclick=()=>openAuthModal('register');
  $('#logoutBtn').onclick=logout;
  $('#toLogin').onclick=()=>setAuthMode('login');
  $('#toRegister').onclick=()=>setAuthMode('register');
  $('#authSubmit').onclick=submitAuth;

  $('#prevMonth').onclick=()=>{ state.month--; if(state.month<0){state.month=11;state.year--;} renderCalendar(); };
  $('#nextMonth').onclick=()=>{ state.month++; if(state.month>11){state.month=0;state.year++;} renderCalendar(); };
  $('#todayBtn').onclick=()=>{ const t=new Date(); state.year=t.getFullYear(); state.month=t.getMonth(); renderCalendar(); };
  $('#vehicleFilter').onchange=renderCalendar;

  $('#calGrid').onclick=(e)=>{
    const cell=e.target.closest('.cal-cell'); if(!cell||cell.classList.contains('out')) return;
    const item=e.target.closest('.resv-item');
    if(item&&item.dataset.id){ if(!isLoggedIn()){toast('请先登录');openAuthModal('login');return;} openResvModal(null,item.dataset.id); return; }
    openResvModal(cell.dataset.date);
  };

  $('#resvSave').onclick=saveResv;
  $('#resvDelete').onclick=deleteResv;
  $('#resvAllDay').onchange=(e)=>{ $('#timeRow').style.display=e.target.checked?'none':'flex'; updateResvRestrictionHint(); };
  $('#resvVehicle').onchange=updateResvRestrictionHint;
  $('#resvDate').onchange=updateResvRestrictionHint;
  $('#resvStart').onchange=updateResvRestrictionHint;
  $('#resvEnd').onchange=updateResvRestrictionHint;
  $$('[data-close]').forEach(b=>b.onclick=()=>b.closest('.modal').classList.add('hidden'));
  $$('.modal').forEach(m=>m.onclick=(e)=>{ if(e.target===m) m.classList.add('hidden'); });

  $('#addVehicleBtn').onclick=()=>openVehicleModal(null);
  $('#vehSave').onclick=saveVehicle;
  $('#vehCancel').onclick=()=>$('#vehicleFormWrap').classList.add('hidden');
  $('#addPeriodBtn').onclick=addPeriod;
  $('#saveRestriction').onclick=saveRestriction;
}

/* ============================ 启动 ============================ */
(async function init(){
  bindEvents(); setAuthUI();
  await restoreAuth();
  setAuthUI();
  await loadAll();
})();
