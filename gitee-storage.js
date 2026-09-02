// Gitee 存储层：替代原 Node/LeanCloud 后端。前端直接读写 Gitee 仓库的 data.json。
// 暴露 window.LC.api(path, opts)，与原 /api/* 返回结构 {ok,data} 一致，app.js 调用点基本不变。
// 数据模型 data.json: { users:[{username,passwordHash,displayName,role}], vehicles:[], reservations:[], restriction:{}, settings:{} }
(function () {
  const API = 'https://gitee.com/api/v5';

  function conf() { return window.GITEE_CONFIG || {}; }
  function bad() { throw new Error('Gitee 未配置：请在 gitee-config.js 填入 owner/repo/pat'); }

  // ---------- 缓存（整份 data.json 在内存，写回带 sha 乐观锁） ----------
  let _cache = null;
  let _sha = null;
  let _loadPromise = null;

  async function ensureLoaded() {
    if (_cache) return;
    if (_loadPromise) return _loadPromise;
    const c = conf(); if (!c.owner || !c.repo || !c.pat) bad();
    _loadPromise = (async () => {
      const url = `${API}/repos/${c.owner}/${c.repo}/contents/${encodeURIComponent(c.path)}?ref=${c.branch}`;
      const res = await fetch(url, { headers: { 'Authorization': 'token ' + c.pat } });
      if (res.status === 404) {
        // 危险操作防护：404 一律视为「读取失败」，绝不再自动用空数据覆盖写入，
        // 避免 Gitee API 抖动（误报 404）把线上真实数据清空。
        throw new Error('Gitee 读取失败 HTTP 404：数据文件不存在，请确认仓库已初始化');
      }
      if (!res.ok) throw new Error('Gitee 读取失败 HTTP ' + res.status + '，请检查网络或令牌后重试');
      const j = await res.json();
      _cache = JSON.parse(b64decode(j.content));
      _sha = j.sha;
    })();
    try { await _loadPromise; } finally { _loadPromise = null; }
  }

  // 本地时区的「今天」（必须与前端 todayStr() 一致；不能用 toISOString，
  // 否则北京时间 08:00 前会算成前一天，导致当天预约被误判为已过期）
  function localToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // 归档：「已过期且未取消」的预约标记为 completed。
  // 只在写入前顺带执行，不额外增加 Gitee 写次数（纯前端架构下写操作越少越安全）。
  function archiveExpired() {
    const t = localToday(); let n = 0;
    (_cache.reservations || []).forEach(r => {
      if (r.status === 'pending' && r.date && r.date < t) { r.status = 'completed'; n++; }
    });
    return n;
  }

  async function persist(message) {
    const c = conf();
    // 安全护栏：本地数据未成功加载（_cache 为 null）时，拒绝写入，
    // 避免用空数据/失败回退覆盖线上真实数据（本次事故的根因即此）。
    if (_cache == null) {
      throw new Error('本地数据尚未加载，已阻止写入以防覆盖 Gitee 数据，请刷新页面后重试');
    }
    archiveExpired();
    // 每次写回前只刷新 sha（绝不回写内容到 _cache，_cache 已含本地改动）：
    // 避免本地缓存的 sha 过期导致 Gitee 返回 400(Blob SHA does not match)
    try {
      const head = await fetch(`${API}/repos/${c.owner}/${c.repo}/contents/${encodeURIComponent(c.path)}?ref=${c.branch}`, { headers: { 'Authorization': 'token ' + c.pat } });
      if (head.ok) {
        const hj = await head.json();
        _sha = hj.sha;
      } else if (head.status === 404) {
        _sha = null;
      }
    } catch (e) { /* 网络异常时仍尝试用本地 _sha */ }

    const buildBody = () => ({
      message: message || 'update data.json',
      content: b64encode(JSON.stringify(_cache, null, 2)),
      branch: c.branch,
      ...(_sha ? { sha: _sha } : {})
    });

    let res = await giteePut(buildBody());
    // Gitee 在 sha 不匹配/缺失时返回 400（不是 409），需重新拉取 sha 后重试一次
    if (res.status === 400 || res.status === 409) {
      const r2 = await fetch(`${API}/repos/${c.owner}/${c.repo}/contents/${encodeURIComponent(c.path)}?ref=${c.branch}`, { headers: { 'Authorization': 'token ' + c.pat } });
      if (r2.ok) {
        const j2 = await r2.json();
        _sha = j2.sha;
        res = await giteePut(buildBody());
      }
    }
    if (!res.ok) {
      let detail = '';
      try { const ej = await res.json(); detail = ej.message || (ej.messages ? JSON.stringify(ej.messages) : ''); } catch (e) {}
      throw new Error('Gitee 写入失败 HTTP ' + res.status + (detail ? '：' + detail : ''));
    }
    const j = await res.json();
    _sha = j.sha;
  }

  async function giteePut(body) {
    const c = conf();
    return fetch(`${API}/repos/${c.owner}/${c.repo}/contents/${encodeURIComponent(c.path)}`, {
      method: 'PUT',
      headers: { 'Authorization': 'token ' + c.pat, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function defaultData() {
    return {
      users: [],
      vehicles: [],
      reservations: [],
      restriction: { enabled: true, city: '北京', weekendRestricted: false, note: '', periods: [] },
      settings: { siteName: '车辆预约系统' }
    };
  }

  // ---------- base64 (UTF-8 安全) ----------
  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64decode(b64) { return decodeURIComponent(escape(atob(b64.replace(/\s/g, '')))); }

  // ---------- 密码哈希 SHA-256(username:password) ----------
  async function hashPwd(username, password) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(username + ':' + password));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------- 用户/权限 ----------
  function currentUser(session) {
    if (!session) return null;
    return (_cache.users || []).find(u => u.username === session) || null;
  }
  function isAdmin(session) { const u = currentUser(session); return !!(u && u.role === 'admin'); }
  function normUser(u) { return { id: u.username, username: u.username, displayName: u.displayName || u.username, role: u.role || 'user' }; }
  function genId(p) { return (p || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  // ---------- 路径分发 ----------
  async function dispatch(path, method, body, session) {
    await ensureLoaded();

    // 鉴权
    if (path === '/auth/me' && method === 'GET') {
      const u = currentUser(session); if (!u) throw new Error('未登录'); return normUser(u);
    }
    if (path === '/auth/login' && method === 'POST') {
      const u = (_cache.users || []).find(x => x.username === body.username);
      if (!u) throw new Error('用户不存在');
      if ((await hashPwd(body.username, body.password)) !== u.passwordHash) throw new Error('密码错误');
      return { token: u.username, role: u.role || 'user', userId: u.username, username: u.username, displayName: u.displayName || u.username };
    }
    if (path === '/register' && method === 'POST') {
      if ((_cache.users || []).some(x => x.username === body.username)) throw new Error('用户名已存在');
      const role = (_cache.users || []).length === 0 ? 'admin' : 'user';
      const u = { username: body.username, passwordHash: await hashPwd(body.username, body.password), displayName: body.displayName || body.username, role };
      _cache.users = _cache.users || []; _cache.users.push(u);
      await persist('register ' + body.username);
      return { token: u.username, role: u.role, userId: u.username, username: u.username, displayName: u.displayName };
    }
    if (path === '/auth/logout' && method === 'POST') return {};

    // 写操作权限
    const needAdmin = (
      (path === '/vehicles' && method !== 'GET') ||
      /^\/vehicles\//.test(path) ||
      (path === '/restriction' && method !== 'GET') ||
      path.startsWith('/admin/')
    );
    if (needAdmin && !isAdmin(session)) throw new Error('需要管理员权限');

    if ((path === '/auth/change-password' || path === '/auth/password') && method === 'PUT') {
      const u = currentUser(session); if (!u) throw new Error('未登录');
      if ((await hashPwd(u.username, body.oldPassword)) !== u.passwordHash) throw new Error('原密码错误');
      u.passwordHash = await hashPwd(u.username, body.newPassword);
      await persist('change password ' + u.username);
      return {};
    }

    // 车辆
    if (path === '/vehicles' && method === 'GET') return (_cache.vehicles || []).slice();
    if (path === '/vehicles' && method === 'POST') {
      const v = Object.assign({ id: genId('veh') }, body);
      _cache.vehicles = _cache.vehicles || []; _cache.vehicles.push(v);
      await persist('add vehicle'); return { id: v.id };
    }
    let m = path.match(/^\/vehicles\/([^/]+)$/);
    if (m) {
      if (method === 'PUT') {
        const v = (_cache.vehicles || []).find(x => x.id === m[1]); if (!v) throw new Error('车辆不存在');
        Object.assign(v, body); v.id = m[1]; await persist('update vehicle'); return { id: m[1] };
      }
      if (method === 'DELETE') {
        _cache.vehicles = (_cache.vehicles || []).filter(x => x.id !== m[1]);
        await persist('delete vehicle'); return { id: m[1] };
      }
    }
    m = path.match(/^\/vehicles\/([^/]+)\/periods\/([^/]+)$/);
    if (m && method === 'DELETE') {
      const v = (_cache.vehicles || []).find(x => x.id === m[1]); if (!v) throw new Error('车辆不存在');
      v.periods = (v.periods || []).filter(p => p.id !== m[2]); await persist('del period'); return {};
    }
    m = path.match(/^\/vehicles\/([^/]+)\/periods$/);
    if (m && method === 'POST') {
      const v = (_cache.vehicles || []).find(x => x.id === m[1]); if (!v) throw new Error('车辆不存在');
      v.periods = v.periods || []; v.periods.push(Object.assign({ id: genId('p') }, body));
      await persist('add period'); return {};
    }

    // 预约
    if (path === '/reservations' && method === 'GET') {
      return (_cache.reservations || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    }
    if (path === '/reservations' && method === 'POST') {
      const obj = Object.assign({}, body);
      obj.forced = !!obj.force; delete obj.force;
      if (obj.allDay == null) obj.allDay = false;
      obj.status = 'pending';
      obj.createdName = obj.createdName || obj.applicant || '';
      obj.createdBy = obj.createdBy || null;
      obj.createdAt = new Date().toISOString();
      obj.id = genId('res');
      _cache.reservations = _cache.reservations || []; _cache.reservations.push(obj);
      await persist('add reservation'); return { id: obj.id };
    }
    m = path.match(/^\/reservations\/cancel\/([^/]+)$/);
    if (m && method === 'PUT') {
      const r = (_cache.reservations || []).find(x => x.id === m[1]); if (!r) throw new Error('预约不存在');
      r.status = 'cancelled'; await persist('cancel reservation'); return {};
    }
    m = path.match(/^\/reservations\/([^/]+)$/);
    if (m && method === 'PUT') {
      const r = (_cache.reservations || []).find(x => x.id === m[1]); if (!r) throw new Error('预约不存在');
      Object.assign(r, body); r.id = m[1]; await persist('update reservation'); return { id: m[1] };
    }

    // 限行 / 设置
    if (path === '/restriction' && method === 'GET') return _cache.restriction || defaultData().restriction;
    if (path === '/meta' && method === 'GET') return { lastTdocSync: _cache._lastTdocSync || null, tdocSource: _cache._tdocSource || null };
    if (path === '/restriction' && method === 'PUT') { _cache.restriction = body; await persist('update restriction'); return {}; }

    // 用户管理（admin）
    if (path === '/admin/users' && method === 'GET') return (_cache.users || []).map(normUser);
    if (path === '/admin/users' && method === 'POST') {
      if ((_cache.users || []).some(x => x.username === body.username)) throw new Error('用户名已存在');
      const u = { username: body.username, passwordHash: await hashPwd(body.username, body.password || '123456'), displayName: body.displayName || body.username, role: body.role || 'user' };
      _cache.users = _cache.users || []; _cache.users.push(u); await persist('add user'); return { id: u.username };
    }
    m = path.match(/^\/admin\/users\/([^/]+)$/);
    if (m && method === 'DELETE') {
      if (m[1] === session) throw new Error('不能删除自己');
      _cache.users = (_cache.users || []).filter(x => x.username !== m[1]); await persist('delete user'); return { id: m[1] };
    }
    m = path.match(/^\/admin\/users\/([^/]+)\/role$/);
    if (m && method === 'PUT') {
      const u = (_cache.users || []).find(x => x.username === m[1]); if (!u) throw new Error('用户不存在');
      u.role = body.role || 'user'; await persist('set role'); return {};
    }

    throw new Error('未知接口: ' + method + ' ' + path);
  }

  window.LC = {
    _session: null,
    setSession(t) { this._session = t; },
    async api(path, opts = {}) {
      const session = (opts && opts._session) || this._session || null;
      const method = (opts.method || 'GET').toUpperCase();
      try {
        const data = await dispatch(path, method, opts.body, session);
        return { ok: true, data };
      } catch (e) {
        return { ok: false, status: 0, data: { error: e.message } };
      }
    }
  };
})();
