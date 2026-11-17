/* النواة — برنامج المتابعة: الحالة، الدخول، الصلاحيات، المواعيد، الحفظ، أدوات الواجهة، التوجيه */
window.FU = (function () {
  const S = window.FU_STORE, DAY = 864e5, VERSION = '1.0';
  const DEFAULTS = { appName: 'المتابعة', subtitle: 'متابعة الكتب والتكليفات', unitName: 'مكتب المدير العام', orgName: 'الإدارة العامة للأوقاف', ministryName: 'وزارة الأوقاف والشؤون الإسلامية', defaultDays: 7, soonDays: 2, escalateAfter: 3, workdays: false };
  const STATUS = {
    not_received: { t: 'لم يتم استلام المذكرة', c: 'gray', open: true },
    in_progress: { t: 'تحت الإجراء', c: 'warn', open: true },
    problem: { t: 'يوجد مشكلة', c: 'bad', open: true },
    done: { t: 'تم التنفيذ', c: 'ok', open: false },
    no_action: { t: 'لا إجراء للإدارة', c: 'violet', open: false }
  };
  /* النطاق: المدير والمسؤول والمطّلع يرون كل الكتب؛ ممثل الإدارة ومطّلعها يريان كتب إدارتهما فقط */
  const ROLE = { admin: 'مدير البرنامج', officer: 'مسؤول المتابعة', viewer: 'مطّلع على الكل', rep: 'ممثل إدارة', dviewer: 'مطّلع إدارة' };
  const ROLE_HINT = { admin: 'كل الصلاحيات وإدارة المستخدمين', officer: 'يسجّل الكتب ويوزعها ويتابعها — يرى الكل ويعدّل', viewer: 'يرى كل الكتب دون تعديل، ويضيف توجيهاً', rep: 'يرى كتب إدارته فقط ويسجّل إفاداتها (اطلاع وتعديل)', dviewer: 'يرى كتب إدارته فقط (اطلاع فقط)' };
  const KIND = { action: 'إفادة الإدارة', follow: 'متابعة المكتب', directive: 'توجيه', status: 'حركة' };
  const DEFAULT_DEPTS = ['مكتب المدير العام', 'إدارة الاستثمار', 'إدارة المصارف الوقفية', 'إدارة شؤون الأموال الوقفية', 'الخدمات الإدارية'];
  const MAX_FILE = 20 * 1024 * 1024;

  const state = { user: null, store: null, settings: Object.assign({}, DEFAULTS), pendingHandle: null, rev: 0, sig: null };
  const routes = [], actions = {}, forms = {}, api = { screens: {} };
  const db = () => (state.store ? state.store.data : S.empty());
  const $ = s => document.querySelector(s);
  const esc = s => (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nl2br = s => esc(s).replace(/\n/g, '<br>');
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const clone = o => JSON.parse(JSON.stringify(o));
  const nowISO = () => new Date().toISOString();
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), 'ar');
  /* البحث لا يفرّق بين صور الهمزة والتاء المربوطة والألف المقصورة ولا يتأثر بالتشكيل */
  const MARKS = new RegExp('[' + String.fromCharCode(0x64B) + '-' + String.fromCharCode(0x652) + String.fromCharCode(0x640) + ']', 'g');   // التشكيل والتطويل
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(MARKS, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي');

  /* ---------- التواريخ: تُخزَّن نصاً YYYY-MM-DD وتُحسب بالتوقيت العالمي فلا تتأثر بالمنطقة الزمنية ---------- */
  const pad = n => String(n).padStart(2, '0');
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const T = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const okDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(T(s));
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const fmtDate = s => (okDate(s) ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : '—');
  const fmtLong = s => { if (!okDate(s)) return '—'; try { return new Date(T(s)).toLocaleDateString('ar-QA-u-nu-latn', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); } catch (e) { return fmtDate(s); } };
  const fmtDateTime = d => { const x = new Date(d); if (!d || isNaN(x)) return '—'; try { return x.toLocaleString('ar-QA-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(d); } };
  const isWeekend = t => { const d = new Date(t).getUTCDay(); return d === 5 || d === 6; };   // الجمعة والسبت
  /* تاريخ الاستحقاق: بعد n يوماً من البداية؛ وفي وضع أيام العمل تُتخطى الجمعة والسبت */
  function addDays(s, n) {
    n = Math.max(0, Math.round(Number(n) || 0)); let t = T(s);
    if (!state.settings.workdays) return iso(t + n * DAY);
    while (isWeekend(t)) t += DAY;
    while (n > 0) { t += DAY; if (!isWeekend(t)) n--; }
    return iso(t);
  }
  /* عدد الأيام من a إلى b (سالب إن كان b قبل a) بالوضع المختار */
  function span(a, b) {
    let x = T(a), y = T(b);
    if (!state.settings.workdays) return Math.round((y - x) / DAY);
    const sign = y >= x ? 1 : -1; if (sign < 0) { const z = x; x = y; y = z; }
    let n = 0; for (let t = x + DAY; t <= y; t += DAY) if (!isWeekend(t)) n++;
    return sign * n;
  }
  /* obl: صيغة النصب بعد «متأخر» ونحوها (يوماً واحداً، يومين) */
  const daysWord = (n, obl) => (n === 1 ? (obl ? 'يوماً واحداً' : 'يوم واحد') : n === 2 ? (obl ? 'يومين' : 'يومان') : n >= 3 && n <= 10 ? n + ' أيام' : n + ' يوماً');

  /* ---------- SHA-256 (WebCrypto مع بديل JS) ---------- */
  function sha256js(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    const mathPow = Math.pow, maxWord = mathPow(2, 32); let result = '';
    const words = [], asciiBitLength = ascii.length * 8; let hash = sha256js.h = sha256js.h || [], k = sha256js.k = sha256js.k || [], primeCounter = k.length; const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) { if (!isComposite[candidate]) { for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate; hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0; k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0; } }
    ascii += '\x80'; while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) { const j = ascii.charCodeAt(i); if (j >> 8) return; words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = ((asciiBitLength / maxWord) | 0); words[words.length] = (asciiBitLength);
    for (let j = 0; j < words.length;) { const w = words.slice(j, j += 16); const oldHash = hash; hash = hash.slice(0, 8);
      for (let i = 0; i < 64; i++) { const w15 = w[i - 15], w2 = w[i - 2]; const a = hash[0], e = hash[4]; const temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0); const temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2])); hash = [(temp1 + temp2) | 0].concat(hash); hash[4] = (hash[4] + temp1) | 0; }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0; }
    for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) { const b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  }
  async function sha256(str) {
    const bytes = new TextEncoder().encode(str);
    if (window.crypto && crypto.subtle) { try { const buf = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (e) { } }
    let bin = ''; bytes.forEach(b => { bin += String.fromCharCode(b); }); return sha256js(bin);
  }
  const hashPassword = (pw, salt) => sha256(salt + ':' + pw);

  /* ---------- الصلاحيات ---------- */
  const role = () => (state.user ? state.user.role : null);
  const isOfficer = () => role() === 'officer' || role() === 'admin';
  const isAdmin = () => role() === 'admin';
  const isRep = () => role() === 'rep';
  const isViewer = () => role() === 'viewer';
  const inDept = () => role() === 'rep' || role() === 'dviewer';
  const canSeeTask = t => !inDept() || t.deptId === state.user.deptId;
  const canActTask = t => isOfficer() || (isRep() && t.deptId === state.user.deptId);

  /* ---------- البيانات ---------- */
  const byId = (coll, id) => db()[coll].find(r => r.id === id);
  const list = (coll, f) => (f ? db()[coll].filter(f) : db()[coll].slice());
  const deptName = id => { const d = byId('depts', id); return d ? d.name : '—'; };
  const userName = id => { const u = byId('users', id); return u ? u.name : '—'; };
  const depts = all => list('depts', d => all || d.active).sort((a, b) => (a.order || 0) - (b.order || 0));
  const officers = () => list('users', u => u.active && u.role === 'officer').sort(byName);
  /* فهرس الإفادات لكل تكليف والتكليفات لكل كتاب؛ يُعاد بناؤه عند أي تغيير */
  let cache = null;
  function idx() {
    const d = db(); if (cache && cache.rev === state.rev && cache.d === d) return cache;
    const ups = new Map(), tasks = new Map();
    for (const u of d.updates) { if (!ups.has(u.taskId)) ups.set(u.taskId, []); ups.get(u.taskId).push(u); }
    for (const a of ups.values()) a.sort((x, y) => ((x.date || '') + (x.createdAt || '') < (y.date || '') + (y.createdAt || '') ? -1 : 1));
    const ord = new Map(depts(true).map((x, i) => [x.id, i]));
    for (const t of d.tasks) { if (!tasks.has(t.letterId)) tasks.set(t.letterId, []); tasks.get(t.letterId).push(t); }
    for (const a of tasks.values()) a.sort((x, y) => (ord.get(x.deptId) || 0) - (ord.get(y.deptId) || 0));
    return (cache = { rev: state.rev, d, ups, tasks });
  }
  const taskUpdates = id => idx().ups.get(id) || [];
  const letterTasks = id => idx().tasks.get(id) || [];
  /* وضع التكليف: الاستحقاق، الباقي أو التأخر، عدد الإفادات، آخر إفادة، وهل تجاوز حد الإفادات دون إنجاز */
  function taskInfo(t) {
    const st = STATUS[t.status] || STATUS.in_progress, ups = taskUpdates(t.id), s = state.settings;
    const due = (t.days === '' || t.days == null || !okDate(t.startDate)) ? null : addDays(t.startDate, t.days);
    const o = { st, open: !!st.open, due, left: null, overdue: false, soon: false, lateBy: 0, last: null };
    o.n = ups.filter(u => u.text && (u.kind === 'action' || u.kind === 'follow')).length;
    for (let i = ups.length - 1; i >= 0 && !o.last; i--) if (ups[i].text) o.last = ups[i];
    if (due && o.open) { o.left = span(today(), due); o.overdue = o.left < 0; o.soon = !o.overdue && o.left <= s.soonDays; }
    if (due && t.status === 'done' && okDate(t.doneDate)) o.lateBy = Math.max(0, span(due, t.doneDate));
    o.escal = o.open && s.escalateAfter > 0 && o.n >= s.escalateAfter;
    o.attention = o.overdue || t.status === 'problem' || o.escal;
    return o;
  }
  function stats(tasks) {
    const s = { total: tasks.length, open: 0, overdue: 0, soon: 0, escal: 0, late: 0, ontime: 0, not_received: 0, in_progress: 0, problem: 0, done: 0, no_action: 0 };
    for (const t of tasks) {
      const i = taskInfo(t); s[t.status] = (s[t.status] || 0) + 1;
      if (i.open) s.open++; if (i.overdue) s.overdue++; if (i.soon) s.soon++; if (i.escal) s.escal++;
      if (t.status === 'done') { if (i.lateBy > 0) s.late++; else s.ontime++; }
    }
    return s;
  }
  const letterState = l => { const ts = letterTasks(l.id); return !ts.length ? 'unassigned' : ts.some(t => (STATUS[t.status] || {}).open) ? 'open' : 'closed'; };

  let auditQ = Promise.resolve();
  function audit(action, entity, entityId, detail) {
    const rec = { id: uid(), at: nowISO(), actor: state.user ? state.user.id : null, actorName: state.user ? state.user.username : 'system', action, entity, entityId: entityId || null, detail: detail || null };
    auditQ = auditQ.then(() => state.store.appendAudit(rec)).catch(e => console.warn('audit', e)); return auditQ;
  }
  const touch = () => { if (state.store) state.store.scan().then(s => { state.sig = s; }).catch(() => { }); };
  /* الحفظ يجري دائماً على نسخة من السجل؛ السجل الحي لا يتغير إلا إذا قُبل الحفظ */
  async function save(coll, rec, action, detail) {
    const base = rec.updatedAt || null, keep = [rec.updatedAt, rec.createdAt, rec.createdBy];
    rec.updatedAt = nowISO(); if (!rec.createdAt) { rec.createdAt = rec.updatedAt; if (state.user) rec.createdBy = state.user.id; }
    try { await state.store.put(coll, rec, base); } catch (e) { rec.updatedAt = keep[0]; rec.createdAt = keep[1]; rec.createdBy = keep[2]; throw e; }
    state.rev++; touch(); if (action !== null) audit(action || 'save', coll, rec.id, detail); return rec;
  }
  async function update(coll, id, mutate, action, detail) { const cur = byId(coll, id); if (!cur) throw new Error('السجل غير موجود. حدّث البيانات.'); const c = clone(cur); mutate(c); return save(coll, c, action, detail); }
  async function remove(coll, id, detail) { await state.store.remove(coll, id); state.rev++; touch(); audit('delete', coll, id, detail); }

  /* ---------- المرفقات ---------- */
  function safeFileName(name) {
    let s = String(name || '').normalize('NFC').replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_').replace(/\.{2,}/g, '.').replace(/^[.\s]+|[.\s]+$/g, '');
    if (!s) s = 'file';
    if (s.length > 120) { const m = /\.[A-Za-z0-9]{1,10}$/.exec(s); const ext = m ? m[0] : ''; s = s.slice(0, 120 - ext.length) + ext; }
    return s;
  }
  async function storeFiles(ownerId, fileList) {
    const out = [];
    for (const f of Array.from(fileList || [])) {
      if (!f || !f.size) continue;
      if (f.size > MAX_FILE) throw new Error('حجم الملف «' + f.name + '» أكبر من 20 ميجابايت.');
      const id = uid().slice(0, 8), name = safeFileName(f.name), path = ownerId + '/' + id + '__' + name;
      await state.store.saveFile(path, f); out.push({ id, name, path, size: f.size, by: state.user.id, at: nowISO() });
    }
    return out;
  }
  async function removeFiles(arr) { for (const a of (arr || [])) await state.store.deleteFile(a.path); }
  const filesHtml = (arr, delAct, ownerId) => (arr || []).map(a => `<span class="file"><button type="button" class="linkbtn" data-act="openFile" data-path="${esc(a.path)}" data-name="${esc(a.name)}">📎 ${esc(a.name)}</button>${delAct ? `<button type="button" class="icon-btn no-print" data-act="${delAct}" data-id="${esc(ownerId)}" data-fid="${esc(a.id)}" title="حذف المرفق">✕</button>` : ''}</span>`).join(' ');
  /* الصور وPDF والنص تُعرض، وما عداها يُنزَّل فقط */
  async function openFile(path, name) {
    const blob = await state.store.fileBlob(path); if (!blob) throw new Error('تعذر فتح الملف. ربما لم تكتمل مزامنته بعد.');
    const safe = /^(image\/(png|jpe?g|gif|webp|bmp)|application\/pdf|text\/plain)$/i.test(blob.type);
    const url = URL.createObjectURL(safe ? blob : new Blob([blob], { type: 'application/octet-stream' }));
    if (safe) window.open(url, '_blank', 'noopener'); else { const a = document.createElement('a'); a.href = url; a.download = name || 'file'; document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain;charset=utf-8' })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
  /* خلية CSV: نص يبدأ بـ = أو + أو - أو @ يُسبق بفاصلة عليا حتى لا تنفّذه برامج الجداول صيغةً */
  const csvCell = v => { if (v == null) return '""'; if (typeof v === 'number') return String(v); let t = String(v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
  const csvText = rows => String.fromCharCode(0xFEFF) + rows.map(r => r.map(csvCell).join(',')).join('\r\n');

  /* ---------- التهيئة الأولى والدخول ---------- */
  function applySettings() { state.settings = Object.assign({}, DEFAULTS, db().settings || {}); }
  /* معرّفات السجلات الأولية ثابتة، فلو فتح زميلان البرنامج لأول مرة معاً لا تتكرر الإدارات ولا المستخدمون */
  async function seedIfEmpty() {
    const seed = window.FU_SEED || {}, at = nowISO();
    if (!db().settings) await state.store.putSettings(clone(DEFAULTS));
    if (!db().depts.length) {
      const names = (seed.depts && seed.depts.length) ? seed.depts : DEFAULT_DEPTS;
      for (let i = 0; i < names.length; i++) await state.store.put('depts', { id: 'dept-' + (i + 1), name: names[i], order: i + 1, active: true, createdAt: at, updatedAt: at });
    }
    if (!db().users.length) {
      const us = (seed.users && seed.users.length) ? seed.users : [{ username: 'admin', name: 'مدير البرنامج', role: 'admin' }];
      for (const s of us) {
        const dep = s.dept ? db().depts.find(x => x.name === s.dept) : null;
        const u = { id: 'u-' + s.username, username: s.username, name: s.name, title: s.title || '', email: s.email || '', role: ROLE[s.role] ? s.role : 'viewer', deptId: dep ? dep.id : null, active: true, mustChange: true, salt: uid(), createdAt: at, updatedAt: at };
        u.hash = await hashPassword(s.password || '123456', u.salt); await state.store.put('users', u);
      }
    }
    applySettings();
  }
  async function login(username, password) {
    const name = String(username || '').trim().toLowerCase().replace(/@.*$/, '');
    const u = list('users').find(x => String(x.username).toLowerCase() === name); if (!u) throw new Error('اسم المستخدم غير موجود');
    if (!u.active) throw new Error('هذا الحساب معطَّل. راجع مسؤول البرنامج');
    const ok = async p => (await hashPassword(p, u.salt)) === u.hash, pw = String(password || '');
    if (!(await ok(pw)) && !(pw.trim() !== pw && (await ok(pw.trim())))) throw new Error('كلمة المرور غير صحيحة');
    state.user = u; sessionStorage.setItem('fu_user', u.id);
    audit('login', 'users', u.id);
  }
  function logout() { if (state.user) audit('logout', 'users', state.user.id); state.user = null; sessionStorage.removeItem('fu_user'); if (location.hash === '#/home') render(); else location.hash = '#/home'; }
  async function setPassword(userId, pw, must) {
    const salt = uid(), hash = await hashPassword(pw, salt);
    await update('users', userId, u => { u.salt = salt; u.hash = hash; u.mustChange = !!must; }, must ? 'password_reset' : 'password_change', { name: userName(userId) });
    if (state.user && state.user.id === userId) state.user = byId('users', userId);
  }

  /* ---------- الواجهة ---------- */
  function toast(msg, type) { const t = $('#toast'), el = document.createElement('div'); el.className = 'toast ' + (type || 'info'); el.textContent = msg; t.appendChild(el); setTimeout(() => el.classList.add('show'), 10); setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, type === 'bad' ? 6000 : 3600); }
  function formData(form) {
    const o = {}; new FormData(form).forEach((v, k) => { if (v instanceof File) return; if (k.endsWith('[]')) (o[k.slice(0, -2)] = o[k.slice(0, -2)] || []).push(v); else o[k] = typeof v === 'string' ? v.trim() : v; });
    form.querySelectorAll('input[type=checkbox]').forEach(c => { if (c.name && !c.name.endsWith('[]')) o[c.name] = c.checked; }); return o;
  }
  /* نافذة حوار: onOk(form, data) يعيد false لإبقائها مفتوحة، وأي خطأ يُعرض دون إغلاقها */
  const stack = [];
  function modal(o) {
    return new Promise(resolve => {
      const m = document.createElement('div'); m.className = 'modal-layer'; document.body.appendChild(m);
      m.innerHTML = `<form class="modal-box ${o.wide ? 'wide' : ''}" role="dialog" aria-modal="true" novalidate><div class="modal-head"><h3>${esc(o.title || '')}</h3><button type="button" class="icon-btn" data-m="cancel" aria-label="إغلاق">✕</button></div><div class="modal-body">${o.body || ''}</div><div class="modal-foot">${o.hideOk ? '' : `<button type="submit" class="btn primary">${esc(o.okText || 'حفظ')}</button>`}<button type="button" class="btn" data-m="cancel">${esc(o.cancelText || (o.hideOk ? 'إغلاق' : 'إلغاء'))}</button></div></form>`;
      const form = m.firstElementChild; let busy = false;
      const done = v => { if (!m.isConnected) return; m.remove(); stack.splice(stack.indexOf(entry), 1); resolve(v); };
      const entry = { cancel: () => { if (!busy) done(false); } }; stack.push(entry);
      m.addEventListener('click', e => { if (e.target.closest('[data-m="cancel"]')) entry.cancel(); });
      form.addEventListener('submit', async e => {
        e.preventDefault(); if (busy) return;
        if (!form.checkValidity()) { form.reportValidity(); return; }
        if (!o.onOk) return done(true);
        busy = true; const b = form.querySelector('[type=submit]'); b.disabled = true;
        try { const r = await o.onOk(form, formData(form)); busy = false; b.disabled = false; if (r === false) return; done(r === undefined ? true : r); }
        catch (err) { logErr(err); busy = false; b.disabled = false; toast(err.message || String(err), 'bad'); if (err.status === 409) { done(false); reload(true).catch(() => { }); } }
      });
      if (o.onOpen) o.onOpen(form);
      const f = form.querySelector('input:not([type=hidden]):not([type=checkbox]):not([type=file]),select,textarea'); if (f) f.focus();
    });
  }
  const confirm = (msg, okText) => modal({ title: 'تأكيد', body: `<p>${esc(msg)}</p>`, okText: okText || 'نعم، متابعة' });
  const badge = (text, cls) => `<span class="badge b-${esc(cls || 'soft')}">${esc(text)}</span>`;
  const statusBadge = code => { const s = STATUS[code] || { t: code, c: 'soft' }; return badge(s.t, s.c); };
  function dueBadge(t, i) {
    i = i || taskInfo(t); if (!i.due) return '<span class="muted">—</span>';
    if (i.open) return i.overdue ? badge('متأخر ' + daysWord(-i.left, true), 'bad') : i.left === 0 ? badge('يستحق اليوم', 'warn') : badge('باقٍ ' + daysWord(i.left), i.soon ? 'warn' : 'soft');
    if (t.status === 'done') return i.lateBy > 0 ? badge('أُنجز متأخراً ' + daysWord(i.lateBy, true), 'bad') : badge('أُنجز في موعده', 'ok');
    return '<span class="muted">—</span>';
  }
  const field = (label, input, hint, cls) => `<label class="field ${cls || ''}"><span class="lbl">${esc(label)}</span>${input}${hint ? `<small class="hint">${esc(hint)}</small>` : ''}</label>`;
  const opts = (pairs, sel) => pairs.map(p => `<option value="${esc(p[0])}" ${String(sel == null ? '' : sel) === String(p[0]) ? 'selected' : ''}>${esc(p[1])}</option>`).join('');
  const logo = (which, cls) => { const src = which === 'moe' ? window.LOGO_MOE : window.LOGO_AWQAF; return src ? `<img src="${src}" alt="" class="${cls}">` : ''; };

  function page(html, o) {
    o = o || {}; const u = state.user, s = state.settings; document.title = (o.title ? o.title + ' — ' : '') + s.appName; document.body.classList.remove('print-mode');
    const nav = [['#/home', 'الرئيسية'], ['#/register', 'سجل المتابعة']]; if (isOfficer()) nav.push(['#/settings', 'الإعدادات']);
    const seg = location.hash.split('/')[1] || 'home', cur = seg === 'letter' ? '#/register' : '#/' + seg;
    $('#app').innerHTML = `<header class="top"><div class="brand">${logo('moe', 'logo-moe')}<div class="app-title"><h1>${esc(s.appName)}</h1><p>${esc(s.subtitle)} — ${esc(s.unitName)} · ${esc(s.orgName)}</p></div>${logo('awqaf', 'logo-awqaf')}</div>
      <div class="userbar"><span class="who"><b>${esc(u.name)}</b> · ${esc(ROLE[u.role])}${inDept() ? ' · ' + esc(deptName(u.deptId)) : ''}</span><button class="btn small" data-act="reload" title="قراءة ما حفظه الزملاء">⟳ تحديث</button><a class="btn small" href="#/password">كلمة المرور</a><button class="btn small" data-act="logout">خروج</button></div></header>
      <nav class="tabs">${nav.map(n => `<a href="${n[0]}" ${cur === n[0] ? 'aria-current="page"' : ''}>${n[1]}</a>`).join('')}<span class="grow"></span><span class="store-info" title="${esc(state.store.describe())}">${state.store.mode === 'folder' ? '📁 مجلد مشترك' : '💾 هذا الجهاز'}</span></nav>
      <main id="main" class="${o.wide ? 'wide' : ''}">${html}</main>
      <footer class="foot"><span>${esc(s.unitName)} · ${esc(s.orgName)} · ${esc(s.ministryName)}</span><span>${esc(s.appName)} · الإصدار ${VERSION}</span></footer>`;
    if (!o.keepScroll) window.scrollTo(0, 0);
  }
  function setOrientation(o) { let st = $('#page-style'); if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); } st.textContent = `@page{size:A4 ${o};margin:10mm}`; document.body.classList.toggle('landscape', o === 'landscape'); }
  function printPage(html, o) {
    o = o || {}; document.title = o.title || 'تقرير'; document.body.classList.add('print-mode'); setOrientation(o.orientation || 'portrait');
    $('#app').innerHTML = `<div class="print-bar no-print"><button class="btn" data-act="back">→ رجوع</button><span class="grow"></span><button class="btn primary" data-act="print">🖨 طباعة / حفظ PDF</button></div>${html}`; window.scrollTo(0, 0);
  }

  /* ---------- التوجيه ---------- */
  function route(re, fn) { routes.push({ re, fn }); }
  function navigate(h) { if (location.hash === h) render(); else location.hash = h; }
  let keepScroll = false;
  async function render() {
    try {
      if (!state.store) return renderSetup();
      if (!state.user) return api.screens.login();
      const h = location.hash || '#/home';
      if (state.user.mustChange && h !== '#/password') return navigate('#/password');
      for (const r of routes) { const m = h.match(r.re); if (m) return await r.fn(...m.slice(1).map(decodeURIComponent)); }
      navigate('#/home');
    } catch (e) { console.error(e); toast('حدث خطأ: ' + e.message, 'bad'); }
  }
  function renderSetup() {
    const folderOk = S.supportsFolder(), pend = state.pendingHandle, s = state.settings; document.body.classList.remove('print-mode');
    $('#app').innerHTML = `<div class="setup"><div class="setup-card">${logo('awqaf', 'setup-logo')}<h1>${esc(s.appName)}</h1><p class="muted">${esc(s.subtitle)} — ${esc(s.unitName)} · ${esc(s.orgName)}</p>
      <h2>أين تُحفظ البيانات؟</h2>
      ${pend ? `<div class="note ok"><b>المجلد المحفوظ:</b> ${esc(pend.name)} — يحتاج إذنك لإعادة فتحه. <button class="btn primary" data-act="resumeFolder">فتح المجلد</button></div>` : ''}
      <div class="choices">
        <div class="choice ${folderOk ? '' : 'disabled'}"><h3>📁 مجلد البيانات المشترك (موصى به)</h3><p>اختر مجلد البرنامج داخل دروب بوكس (المجلد الذي فيه هذا الملف). تُحفظ البيانات والمرفقات في مجلد <code>data</code> ويتشاركها الفريق تلقائياً عبر المزامنة.</p><button class="btn primary" data-act="pickFolder" ${folderOk ? '' : 'disabled'}>اختيار المجلد</button>${folderOk ? '' : '<p class="hint">يحتاج متصفح Chrome أو Edge على الحاسوب.</p>'}</div>
        <div class="choice"><h3>💾 المتصفح على هذا الجهاز</h3><p>تُحفظ البيانات داخل هذا المتصفح فقط ولا يراها الزملاء. مناسب للتجربة.</p><button class="btn" data-act="useLocal">المتابعة بهذا الجهاز</button></div>
      </div></div></div>`;
  }
  async function useFolder(h) { state.store = await new S.FolderStore(h).init(); await state.store.load(); localStorage.setItem('fu_mode', 'folder'); await afterStore(); }
  async function useLocal() { state.store = await new S.LocalStore().init(); localStorage.setItem('fu_mode', 'local'); await afterStore(); }
  async function afterStore() {
    await seedIfEmpty(); state.rev++; state.pendingHandle = null;
    const id = sessionStorage.getItem('fu_user'); if (id) { const u = byId('users', id); if (u && u.active) state.user = u; }
    if (state.store.conflicts) toast(`تنبيه: ${state.store.conflicts} ملف متعارض في مجلد البيانات تم تجاهله`, 'warn');
    touch(); render();
  }
  async function reload(silent) {
    if (!state.store) return; const y = window.scrollY;
    await state.store.load(); applySettings(); state.rev++;
    if (state.user) { const u = byId('users', state.user.id); if (!u || !u.active) return logout(); state.user = u; }
    touch(); await render(); if (silent) window.scrollTo(0, y); else toast('تم تحديث البيانات');
  }
  /* كل دقيقة وعند العودة إلى النافذة: إن أضاف الزملاء شيئاً تُحمَّل البيانات تلقائياً ما لم يكن المستخدم يكتب أو أمامه نافذة حوار */
  let watching = false;
  async function watch() {
    if (watching || !state.store || !state.user || document.hidden || state.sig == null) return; watching = true;
    try {
      const s = await state.store.scan(); if (s == null || s === state.sig) return;
      const a = document.activeElement, typing = a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
      if (stack.length || typing || document.body.classList.contains('print-mode')) { const b = $('[data-act="reload"]'); if (b) { b.classList.add('has-updates'); b.textContent = '⟳ توجد تعديلات جديدة'; } }
      else await reload(true);
    } catch (e) { console.warn(e); } finally { watching = false; }
  }
  async function resetStore() { await S.forgetFolder(); localStorage.removeItem('fu_mode'); sessionStorage.removeItem('fu_user'); state.store = null; state.user = null; state.sig = null; location.hash = '#/home'; render(); }

  actions.pickFolder = async () => { try { await useFolder(await S.pickFolder()); } catch (e) { if (e.name !== 'AbortError') toast('تعذر فتح المجلد: ' + e.message, 'bad'); } };
  actions.resumeFolder = async () => { const h = state.pendingHandle; if (!h) return; if (await S.ensurePermission(h, true)) await useFolder(h); else toast('لم يُمنح الإذن', 'warn'); };
  actions.useLocal = () => useLocal();
  actions.reload = () => reload();
  actions.logout = () => logout();
  actions.back = () => history.back();
  actions.print = () => window.print();
  actions.openFile = el => openFile(el.dataset.path, el.dataset.name);

  /* رسائل التحقق المتوقعة تُعرض للمستخدم وتُسجَّل تحذيراً؛ أخطاء البرمجة تُسجَّل خطأً */
  function logErr(err) { (err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError || err instanceof SyntaxError ? console.error : console.warn)(err); }
  function fail(err) { logErr(err); toast((err && err.message) || String(err), 'bad'); if (err && err.status === 409) reload(true).catch(() => { }); }
  function bind() {
    const running = new Set();   // إجراء جارٍ على الزر نفسه لا يُبدأ مرة ثانية (النقر المزدوج)
    document.addEventListener('click', e => {
      const el = e.target.closest('[data-act]'); if (!el || el.disabled) return; const fn = actions[el.dataset.act]; if (!fn) return; e.preventDefault();
      const key = JSON.stringify(el.dataset); if (running.has(key)) return; running.add(key);
      Promise.resolve().then(() => fn(el, e)).catch(fail).finally(() => running.delete(key));
    });
    document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); const fn = forms[f.dataset.form]; if (fn) Promise.resolve().then(() => fn(f, formData(f))).catch(fail); });
    document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (!el) return; const fn = actions['change:' + el.dataset.change]; if (fn) Promise.resolve().then(() => fn(el, e)).catch(fail); });
    document.addEventListener('input', e => { const el = e.target.closest('[data-input]'); if (!el) return; const fn = actions['input:' + el.dataset.input]; if (fn) fn(el, e); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && stack.length) stack[stack.length - 1].cancel(); });
    window.addEventListener('hashchange', render);
    window.addEventListener('focus', watch); setInterval(watch, 60000);
  }
  async function boot() {
    bind(); const mode = localStorage.getItem('fu_mode');
    if (S.supportsFolder() && mode !== 'local') {
      const h = await S.savedFolder();
      if (h) { if (await S.ensurePermission(h, false)) { try { await useFolder(h); return; } catch (e) { console.warn(e); } } state.pendingHandle = h; }
    }
    if (mode === 'local') { await useLocal(); return; }
    render();
  }

  return Object.assign(api, { VERSION, DEFAULTS, STATUS, ROLE, ROLE_HINT, KIND, state, db, actions, forms, route, navigate, render, page, printPage, boot, reload, resetStore, $, esc, nl2br, uid, clone, nowISO, byName, norm, today, okDate, fmtDate, fmtLong, fmtDateTime, addDays, span, daysWord, hashPassword, isAdmin, isOfficer, isRep, isViewer, inDept, canSeeTask, canActTask, byId, list, deptName, userName, depts, officers, taskUpdates, letterTasks, taskInfo, stats, letterState, audit, save, update, remove, storeFiles, removeFiles, filesHtml, download, csvText, applySettings, login, logout, setPassword, toast, modal, confirm, badge, statusBadge, dueBadge, field, opts, logo, formData });
})();
