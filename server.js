#!/usr/bin/env node
'use strict';

/**
 * 车辆预约系统 —— 零依赖 Node.js 服务端（含用户账号 + 时段限行）
 * 仅使用 Node 内置模块（http / fs / path / crypto），无需 npm install。
 * 启动：node server.js   （可选环境变量 PORT / HOST）
 * 数据：./data/db.json
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

/* ============================ 默认数据 ============================ */
function defaultDB() {
  return {
    settings: { adminPassword: 'admin123', siteName: '车辆预约系统' },
    users: [],
    vehicles: [
      { id: genId(), plate: '京A12345', name: '别克GL8', type: '商务车', status: 'available', notes: '7座，用于客户接待' },
      { id: genId(), plate: '京B67890', name: '大众帕萨特', type: '轿车', status: 'available', notes: '' },
      { id: genId(), plate: '京AD12345', name: '比亚迪汉EV', type: '新能源车', status: 'available', notes: '绿牌，不限行' }
    ],
    reservations: [],
    restriction: {
      enabled: true,
      city: '北京',
      weekendRestricted: false,
      note: '工作日按尾号限行。尾号方案按日期区间轮换（如 2025.8.22-2025.11.23 是一套，之后换成另一套）；可设置每日限行时段（如北京高峰 7:00-20:00）。未落入任何方案的日期不限行。',
      periods: [
        {
          id: 'p-default-1',
          name: '2025.8.22-2025.11.23 限行方案',
          startDate: '2025-08-22',
          endDate: '2025-11-23',
          peakStart: '07:00',
          peakEnd: '20:00',
          rules: [
            { weekday: 1, tails: [1, 6] },
            { weekday: 2, tails: [2, 7] },
            { weekday: 3, tails: [3, 8] },
            { weekday: 4, tails: [4, 9] },
            { weekday: 5, tails: [5, 0] }
          ]
        },
        {
          id: 'p-default-2',
          name: '2025.11.24 起 限行方案（长期）',
          startDate: '2025-11-24',
          endDate: '',
          peakStart: '07:00',
          peakEnd: '20:00',
          rules: [
            { weekday: 1, tails: [3, 8] },
            { weekday: 2, tails: [4, 9] },
            { weekday: 3, tails: [5, 0] },
            { weekday: 4, tails: [1, 6] },
            { weekday: 5, tails: [2, 7] }
          ]
        }
      ]
    }
  };
}

/* ============================ 工具 ============================ */
function genId() { return crypto.randomBytes(6).toString('hex'); }

function loadDB() {
  if (fs.existsSync(DB_FILE)) {
    try {
      const obj = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const d = defaultDB();
      obj.settings = Object.assign(d.settings, obj.settings || {});
      obj.users = obj.users || [];
      obj.vehicles = obj.vehicles || [];
      obj.reservations = obj.reservations || [];
      // 限行：优先 periods；旧版 rules 自动迁移为单个长期方案；否则用默认
      const baseRest = defaultDB().restriction;
      const r = obj.restriction || {};
      const merged = Object.assign({}, baseRest, r);
      if (Array.isArray(r.periods)) {
        merged.periods = r.periods;
      } else if (Array.isArray(r.rules)) {
        merged.periods = [{ id: 'migrated', name: '旧版规则（已迁移）', startDate: '', endDate: '', peakStart: '', peakEnd: '', rules: r.rules }];
      } else {
        merged.periods = baseRest.periods;
      }
      delete merged.rules;
      obj.restriction = merged;
      return obj;
    } catch (e) { console.error('[DB] 解析失败，使用默认:', e.message); }
  }
  return defaultDB();
}
let db = loadDB();

function saveDB() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function getTail(plate) {
  if (!plate) return null;
  const s = String(plate).replace(/\s/g, '');
  const last = s[s.length - 1];
  if (/\d/.test(last)) return parseInt(last, 10);
  return null;
}

function timeOverlap(aS, aE, bS, bE) { return aS < bE && bS < aE; }

/** 找到覆盖指定日期的限行方案（period）。endDate 留空表示长期有效。 */
function findPeriod(dateStr, restriction) {
  if (!restriction || !Array.isArray(restriction.periods)) return null;
  return restriction.periods.find(p => {
    const start = p.startDate || '';
    const end = p.endDate || '9999-12-31';
    return dateStr >= start && dateStr <= end;
  }) || null;
}

/** 判断某尾号在指定日期/时段是否被限行（按日期区间匹配生效方案） */
function isRestrictedForReservation(tail, dateStr, allDay, sT, eT, restriction) {
  if (!restriction || !restriction.enabled || tail === null) return false;
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d.getTime())) return false;
  const wd = d.getDay();
  if ((wd === 0 || wd === 6) && !restriction.weekendRestricted) return false;
  const period = findPeriod(dateStr, restriction);
  if (!period) return false;                       // 无方案覆盖该日期 → 不限行
  const rule = (period.rules || []).find(r => r.weekday === wd);
  if (!rule || !(rule.tails || []).includes(tail)) return false;
  const win = (period.peakStart && period.peakEnd) ? { start: period.peakStart, end: period.peakEnd } : null;
  if (!win) return true;          // 该方案未设每日时段 → 全天限行
  if (allDay) return true;        // 全天预约必然覆盖限行窗口
  return timeOverlap(sT || '00:00', eT || '23:59', win.start, win.end);
}

/** 该日期的限行信息（用于日历徽标/提示，含方案与时段） */
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

function hasConflict(res, ignoreId) {
  const same = db.reservations.filter(r =>
    r.vehicleId === res.vehicleId && r.date === res.date && r.id !== ignoreId);
  for (const r of same) {
    if (res.allDay || r.allDay) return true;
    if (timeOverlap(res.startTime || '00:00', res.endTime || '23:59',
                    r.startTime || '00:00', r.endTime || '23:59')) return true;
  }
  return false;
}

/* ============================ 密码与会话 ============================ */
function hashPassword(pwd) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(pwd, salt, 32).toString('hex');
  return { salt, hash };
}
function verifyPassword(pwd, salt, hash) {
  const h = crypto.scryptSync(pwd || '', salt, 32).toString('hex');
  try { return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex')); }
  catch { return false; }
}

const sessions = new Map(); // token -> {userId, role, expires}
function createSession(userId, role) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, role, expires: Date.now() + 1000 * 60 * 60 * 24 * 7 });
  return token;
}
function getSession(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return s;
}

function checkAdminPassword(req) {
  const pwd = req.headers['x-admin-password'];
  if (!pwd) return false;
  const a = crypto.createHash('sha256').update(String(pwd)).digest();
  const b = crypto.createHash('sha256').update(String(db.settings.adminPassword)).digest();
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

/** 解析身份：Bearer token 优先，其次 adminPassword 兜底 */
function resolveAuth(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) {
    const s = getSession(auth.slice(7));
    if (s) {
      const u = db.users.find(x => x.id === s.userId);
      if (u) return { role: u.role, userId: u.id, username: u.username, displayName: u.displayName };
    }
  }
  if (checkAdminPassword(req)) return { role: 'admin', userId: null, admin: true };
  return null;
}

/* ============================ HTTP 辅助 ============================ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png'
};
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

/* ============================ 业务逻辑 ============================ */
function listReservations({ from, to, vehicleId }) {
  return db.reservations.filter(r => {
    if (vehicleId && r.vehicleId !== vehicleId) return false;
    if (from && r.date < from) return false;
    if (to && r.date > to) return false;
    return true;
  }).sort((a, b) => (a.date + (a.startTime || '')).localeCompare(b.date + (b.startTime || '')));
}
function buildStats() {
  const today = new Date().toISOString().slice(0, 10);
  const total = db.vehicles.length;
  const available = db.vehicles.filter(v => v.status === 'available').length;
  const maintenance = db.vehicles.filter(v => v.status === 'maintenance').length;
  const upcoming = db.reservations.filter(r => r.date >= today).length;
  const past = db.reservations.filter(r => r.date < today).length;
  const byVehicle = db.vehicles.map(v => ({
    id: v.id, name: v.name, plate: v.plate,
    count: db.reservations.filter(r => r.vehicleId === v.id).length
  })).sort((a, b) => b.count - a.count);
  const recent = [...db.reservations].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
  return { total, available, maintenance, upcoming, past, byVehicle, recent };
}

/* ============================ 路由 ============================ */
async function handleApi(req, res, url) {
  const method = req.method;
  const seg = url.pathname.split('/').filter(Boolean).slice(1); // 去掉 'api'

  if (seg[0] === 'health') return send(res, 200, { ok: true, time: Date.now() });

  /* ---- 注册 ---- */
  if (seg[0] === 'register' && method === 'POST') {
    const b = await readBody(req);
    const username = (b.username || '').trim();
    const password = b.password || '';
    if (username.length < 2) return send(res, 400, { error: '用户名至少 2 个字符' });
    if (password.length < 4) return send(res, 400, { error: '密码至少 4 位' });
    if (db.users.find(u => u.username === username)) return send(res, 409, { error: '用户名已存在' });
    const { salt, hash } = hashPassword(password);
    const role = db.users.length === 0 ? 'admin' : 'user'; // 首位注册者自动为管理员
    const u = {
      id: genId(), username, salt, hash, role,
      displayName: (b.displayName || username).trim(),
      createdAt: new Date().toISOString()
    };
    db.users.push(u); saveDB();
    const token = createSession(u.id, u.role);
    return send(res, 201, { token, role: u.role, username: u.username, displayName: u.displayName });
  }

  /* ---- 登录 / 登出 / 当前用户 ---- */
  if (seg[0] === 'auth' && seg[1] === 'login' && method === 'POST') {
    const b = await readBody(req);
    const u = db.users.find(x => x.username === (b.username || '').trim());
    if (!u || !verifyPassword(b.password || '', u.salt, u.hash)) return send(res, 401, { error: '用户名或密码错误' });
    const token = createSession(u.id, u.role);
    return send(res, 200, { token, role: u.role, username: u.username, displayName: u.displayName });
  }
  if (seg[0] === 'auth' && seg[1] === 'logout' && method === 'POST') {
    const auth = req.headers['authorization'];
    if (auth && auth.startsWith('Bearer ')) sessions.delete(auth.slice(7));
    return send(res, 200, { ok: true });
  }
  if (seg[0] === 'auth' && seg[1] === 'me' && method === 'GET') {
    const a = resolveAuth(req);
    if (!a) return send(res, 401, { error: '未登录' });
    return send(res, 200, { role: a.role, username: a.username, displayName: a.displayName });
  }

  /* ---- 车辆（写需管理员） ---- */
  if (seg[0] === 'vehicles') {
    if (method === 'GET') return send(res, 200, db.vehicles);
    if (method === 'POST') {
      const a = resolveAuth(req); if (!a || a.role !== 'admin') return send(res, 401, { error: '需要管理员权限' });
      const b = await readBody(req);
      if (!b.plate || !b.name) return send(res, 400, { error: '车牌与名称必填' });
      const v = { id: genId(), plate: b.plate, name: b.name, type: b.type || '', status: b.status || 'available', notes: b.notes || '' };
      db.vehicles.push(v); saveDB(); return send(res, 201, v);
    }
    if (method === 'PUT' || method === 'DELETE') {
      const a = resolveAuth(req); if (!a || a.role !== 'admin') return send(res, 401, { error: '需要管理员权限' });
      const id = seg[1]; const idx = db.vehicles.findIndex(v => v.id === id);
      if (idx < 0) return send(res, 404, { error: '车辆不存在' });
      if (method === 'DELETE') {
        db.vehicles.splice(idx, 1);
        db.reservations = db.reservations.filter(r => r.vehicleId !== id);
        saveDB(); return send(res, 200, { ok: true });
      }
      const b = await readBody(req);
      db.vehicles[idx] = Object.assign(db.vehicles[idx], {
        plate: b.plate ?? db.vehicles[idx].plate, name: b.name ?? db.vehicles[idx].name,
        type: b.type ?? db.vehicles[idx].type, status: b.status ?? db.vehicles[idx].status,
        notes: b.notes ?? db.vehicles[idx].notes
      });
      saveDB(); return send(res, 200, db.vehicles[idx]);
    }
  }

  /* ---- 预约 ---- */
  if (seg[0] === 'reservations') {
    if (method === 'GET') {
      const q = url.searchParams;
      return send(res, 200, listReservations({
        from: q.get('from') || undefined, to: q.get('to') || undefined, vehicleId: q.get('vehicleId') || undefined
      }));
    }
    if (method === 'POST') {
      const a = resolveAuth(req); if (!a) return send(res, 401, { error: '请先登录' });
      const b = await readBody(req);
      if (!b.vehicleId || !b.date) return send(res, 400, { error: '车辆与日期必填' });
      const vehicle = db.vehicles.find(v => v.id === b.vehicleId);
      if (!vehicle) return send(res, 400, { error: '车辆不存在' });
      const applicant = (b.applicant || '').trim() || (a.displayName || a.username) || '';
      const tail = getTail(vehicle.plate);
      if (isRestrictedForReservation(tail, b.date, !!b.allDay, b.startTime || '', b.endTime || '', db.restriction) && !b.force) {
        const d = new Date(b.date + 'T00:00:00');
        const info = dayRestrictionInfo(b.date, db.restriction);
        const win = info && info.window ? `（限行时段 ${info.window.start}-${info.window.end}）` : '';
        return send(res, 409, {
          error: 'tail_restricted',
          message: `车牌尾号 ${tail} 在 ${b.date}（周${'日一二三四五六'[d.getDay()]}）限行${win}`,
          tail, weekday: d.getDay(), forced: false
        });
      }
      const resv = {
        id: genId(), vehicleId: b.vehicleId, date: b.date, allDay: !!b.allDay,
        startTime: b.startTime || '', endTime: b.endTime || '',
        applicant, purpose: b.purpose || '', destination: b.destination || '', notes: b.notes || '',
        forced: !!b.force, createdBy: a.userId || 'admin', createdName: a.displayName || a.username || '管理员',
        createdAt: new Date().toISOString()
      };
      if (hasConflict(resv)) return send(res, 409, { error: 'conflict', message: '该车辆在此时间段已有预约' });
      db.reservations.push(resv); saveDB(); return send(res, 201, resv);
    }
    if (method === 'PUT' || method === 'DELETE') {
      const a = resolveAuth(req); if (!a) return send(res, 401, { error: '请先登录' });
      const id = seg[1]; const idx = db.reservations.findIndex(r => r.id === id);
      if (idx < 0) return send(res, 404, { error: '预约不存在' });
      const existing = db.reservations[idx];
      if (a.role !== 'admin' && existing.createdBy !== a.userId) return send(res, 403, { error: '只能修改自己的预约' });
      if (method === 'DELETE') { db.reservations.splice(idx, 1); saveDB(); return send(res, 200, { ok: true }); }
      const b = await readBody(req);
      const upd = Object.assign({}, existing, {
        vehicleId: b.vehicleId ?? existing.vehicleId, date: b.date ?? existing.date,
        allDay: b.allDay ?? existing.allDay, startTime: b.startTime ?? existing.startTime,
        endTime: b.endTime ?? existing.endTime, applicant: b.applicant ?? existing.applicant,
        purpose: b.purpose ?? existing.purpose, destination: b.destination ?? existing.destination,
        notes: b.notes ?? existing.notes
      });
      const vehicle = db.vehicles.find(v => v.id === upd.vehicleId);
      const tail = vehicle ? getTail(vehicle.plate) : null;
      if (isRestrictedForReservation(tail, upd.date, upd.allDay, upd.startTime, upd.endTime, db.restriction) && !b.force && !upd.forced) {
        const d = new Date(upd.date + 'T00:00:00');
        const info = dayRestrictionInfo(upd.date, db.restriction);
        const win = info && info.window ? `（限行时段 ${info.window.start}-${info.window.end}）` : '';
        return send(res, 409, {
          error: 'tail_restricted',
          message: `车牌尾号 ${tail} 在 ${upd.date}（周${'日一二三四五六'[d.getDay()]}）限行${win}`,
          tail, weekday: d.getDay(), forced: false
        });
      }
      if (hasConflict(upd, id)) return send(res, 409, { error: 'conflict', message: '该车辆在此时间段已有预约' });
      db.reservations[idx] = upd; saveDB(); return send(res, 200, upd);
    }
  }

  /* ---- 限行规则（写需管理员） ---- */
  if (seg[0] === 'restriction') {
    if (method === 'GET') return send(res, 200, db.restriction);
    if (method === 'PUT') {
      const a = resolveAuth(req); if (!a || a.role !== 'admin') return send(res, 401, { error: '需要管理员权限' });
      const b = await readBody(req);
      db.restriction = Object.assign(db.restriction, {
        enabled: b.enabled ?? db.restriction.enabled, city: b.city ?? db.restriction.city,
        weekendRestricted: b.weekendRestricted ?? db.restriction.weekendRestricted,
        note: b.note ?? db.restriction.note,
        periods: Array.isArray(b.periods) ? b.periods : db.restriction.periods
      });
      saveDB(); return send(res, 200, db.restriction);
    }
  }

  /* ---- 设置（改管理员密码 / 站点名，需管理员） ---- */
  if (seg[0] === 'settings' && method === 'PUT') {
    const a = resolveAuth(req); if (!a || a.role !== 'admin') return send(res, 401, { error: '需要管理员权限' });
    const b = await readBody(req);
    if (b.adminPassword) db.settings.adminPassword = String(b.adminPassword);
    if (b.siteName) db.settings.siteName = String(b.siteName);
    saveDB(); return send(res, 200, { ok: true });
  }

  if (seg[0] === 'stats' && method === 'GET') return send(res, 200, buildStats());

  return send(res, 404, { error: 'not found' });
}

/* ============================ 静态 ============================ */
function serveStatic(req, res, pathname) {
  if (pathname === '/favicon.ico') { res.writeHead(204); return res.end(); }
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  filePath = path.normalize(filePath);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) filePath = path.join(PUBLIC_DIR, 'index.html');
  const ext = path.extname(filePath);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
}

/* ============================ 启动 ============================ */
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(e => { console.error(e); send(res, 500, { error: 'server error' }); });
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`✅ 车辆预约系统已启动: http://localhost:${PORT}`);
  console.log(`   管理员默认密码(无账号时可用): ${db.settings.adminPassword}`);
  if (db.users.length === 0) console.log('   提示：访问后注册首个账号将自动成为管理员。');
});
