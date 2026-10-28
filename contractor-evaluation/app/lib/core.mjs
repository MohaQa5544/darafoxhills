/* سجل الأداء — منطق الخادم السحابي (مستقل عن منصة الاستضافة ومحرك التخزين)
   - قاعدة البيانات مستند واحد مضغوط (ev/db.json.gz) يُكتب بشرط ETag (تزامن تفاؤلي) فلا تضيع تعديلات المستخدمين المتزامنين.
   - الدخول بكلمة مرور مجزأة PBKDF2 ورمز جلسة موقّع HMAC؛ كلمات المرور وتجزئاتها لا تُرسل إلى المتصفح أبداً.
   - الصلاحيات تُفرض هنا على الخادم وفق الأدوار نفسها في الواجهة، وتقييمات الزملاء تُحجب عن المهندس حسب إعداد الرؤية. */
import { createHmac, createHash, pbkdf2 as pbkdf2cb, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2cb);

export const COLLS = ['users', 'companies', 'projects', 'contracts', 'templates', 'cycles', 'evaluations', 'letters', 'attachments'];
export const RANK = { secretary: 0, engineer: 1, section_head: 2, assistant_director: 3, waqf_dev_head: 3, director: 4, admin: 5 };
const ROLES = Object.keys(RANK);
export const PATHS = { db: 'ev/db.json.gz', files: 'ev/files/', audit: 'ev/audit/', backups: 'ev/backups/' };
export const LIMITS = { file: 4 * 1024 * 1024, record: 512 * 1024, body: 4 * 1024 * 1024, settings: 64 * 1024, auditKeep: 3000, auditChunk: 2000, cacheMs: 2000, tokenMs: 12 * 3600e3, iter: 120000, minPassword: 8 };
const SERVER_AUDITED = new Set(['login', 'settings_update', 'backup_import', 'password_change', 'user_password_reset', 'user_create']);
const WEAK = new Set(['12345678', '123456789', '1234567890', '87654321', 'password', 'password1', 'qwertyui', '11111111', '00000000', 'awqaf123', 'awqaf2026', 'abcd1234', 'abc12345']);
const ID_RE = /^[A-Za-z0-9_-]{6,80}$/;
const FILE_RE = /^attachments\/[A-Za-z0-9_-]{6,80}\/[^/\\]{1,240}$/;

export class HttpError extends Error { constructor(status, message, code, extra) { super(message); this.status = status; this.code = code || 'error'; this.extra = extra; } }
const E = {
  auth: () => new HttpError(401, 'انتهت الجلسة أو لم تسجّل الدخول. سجّل الدخول مجدداً.', 'unauthorized'),
  forbid: m => new HttpError(403, m || 'ليست لديك صلاحية لهذا الإجراء.', 'forbidden'),
  bad: m => new HttpError(400, m || 'طلب غير صالح.', 'bad_request'),
  notFound: m => new HttpError(404, m || 'غير موجود.', 'not_found'),
  conflict: () => new HttpError(409, 'عدّل مستخدم آخر هذا السجل بعد أن فتحته. اضغط «⟳ تحديث» ثم أعد المحاولة.', 'conflict'),
  busy: () => new HttpError(503, 'الخادم مشغول حالياً، أعد المحاولة بعد لحظات.', 'busy'),
  config: m => new HttpError(503, m || 'الخادم غير مهيأ بعد.', 'not_configured'),
  limited: () => new HttpError(429, 'محاولات دخول خاطئة كثيرة. انتظر ربع ساعة ثم أعد المحاولة.', 'rate_limited'),
  large: m => new HttpError(413, m || 'حجم البيانات أكبر من المسموح.', 'too_large'),
};

const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const rankOf = u => (u && RANK[u.role] != null ? RANK[u.role] : -1);
const sha256hex = s => createHash('sha256').update(s).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const canon = v => Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.keys(v).sort().reduce((o, k) => { if (v[k] !== undefined) o[k] = canon(v[k]); return o; }, {}) : v;
const same = (a, b) => JSON.stringify(canon(a === undefined ? null : a)) === JSON.stringify(canon(b === undefined ? null : b));
const jsonClone = o => JSON.parse(JSON.stringify(o));
const canViewAll = u => rankOf(u) >= 2 || (u && u.role === 'secretary');

function respond(status, body, req) {
  const text = JSON.stringify(body); const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const ae = req && req.headers.get('accept-encoding') || '';
  if (Buffer.byteLength(text) > 3.5 * 1024 * 1024 && /\bgzip\b/.test(ae)) { headers['content-encoding'] = 'gzip'; headers.vary = 'Accept-Encoding'; return new Response(gzipSync(Buffer.from(text)), { status, headers }); }
  return new Response(text, { status, headers });
}
function clientIp(req) { const f = req.headers.get('x-forwarded-for') || ''; return (req.headers.get('x-real-ip') || f.split(',')[0] || 'local').trim().slice(0, 64); }

/* ---------- كلمات المرور والرموز ---------- */
export function tempPassword() { const A = 'abcdefghjkmnpqrstuvwxyz23456789'; const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) { s += A[b[i] % A.length]; if (i === 3) s += '-'; } return s; }
export async function hashPassword(pw, salt, iter) { salt = salt || randomBytes(16).toString('hex'); iter = iter || LIMITS.iter; const dk = await pbkdf2(String(pw), salt, iter, 32, 'sha256'); return { algo: 'pbkdf2', salt, iter, hash: dk.toString('hex') }; }
export async function verifyPassword(sec, pw) {
  if (!sec || !sec.hash || !sec.salt) return false;
  const h = sec.algo === 'sha256' ? sha256hex(sec.salt + ':' + pw) : (await pbkdf2(String(pw), sec.salt, sec.iter || LIMITS.iter, 32, 'sha256')).toString('hex');
  const a = Buffer.from(h, 'hex'), b = Buffer.from(String(sec.hash), 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
const isLegacyDefault = sec => !!sec && sec.algo === 'sha256' && sha256hex(sec.salt + ':123456') === sec.hash;
function signToken(secret, userId, pwv) { const p = Buffer.from(JSON.stringify({ u: userId, v: pwv || 0, e: Date.now() + LIMITS.tokenMs })).toString('base64url'); return p + '.' + createHmac('sha256', secret).update(p).digest('base64url'); }
function readToken(secret, tok) {
  if (!tok || typeof tok !== 'string' || tok.length > 800) return null;
  const i = tok.indexOf('.'); if (i < 1) return null; const p = tok.slice(0, i), s = tok.slice(i + 1);
  const want = createHmac('sha256', secret).update(p).digest(); let got; try { got = Buffer.from(s, 'base64url'); } catch (e) { return null; }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  let o; try { o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')); } catch (e) { return null; }
  return o && typeof o.u === 'string' && typeof o.e === 'number' && o.e > Date.now() ? o : null;
}
function checkNewPassword(pw, user) {
  if (typeof pw !== 'string' || pw.length < LIMITS.minPassword) throw E.bad(`كلمة المرور يجب ألا تقل عن ${LIMITS.minPassword} أحرف.`);
  if (pw.length > 128) throw E.bad('كلمة المرور طويلة جداً.');
  const low = pw.toLowerCase();
  if (WEAK.has(low) || /^(.)\1+$/.test(pw) || low === String(user.username || '').toLowerCase()) throw E.bad('كلمة المرور سهلة التخمين. اختر كلمة أقوى تجمع حروفاً وأرقاماً.');
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/[0-9]/.test(pw)) throw E.bad('اجمع في كلمة المرور بين الحروف والأرقام.');
}

class Limiter {
  constructor(max, win) { this.max = max; this.win = win; this.m = new Map(); }
  blocked(k) { const r = this.m.get(k); if (!r) return false; if (Date.now() - r.t > this.win) { this.m.delete(k); return false; } return r.n >= this.max; }
  fail(k) { const now = Date.now(); const r = this.m.get(k); if (!r || now - r.t > this.win) this.m.set(k, { n: 1, t: now }); else r.n++; if (this.m.size > 10000) this.m.clear(); }
  ok(k) { this.m.delete(k); }
}

/* ---------- تنقية السجلات ---------- */
function sanitize(coll, rec) {
  const r = jsonClone(rec);
  if (coll === 'users') { delete r.hash; delete r.salt; delete r.password; delete r.mustChange; delete r.lastLoginAt; delete r.pwv; }
  return r;
}
function cleanSettings(s) { const r = jsonClone(s); return r; }

/* ---------- الخادم ---------- */
export class Server {
  constructor(o) {
    this.store = o.store; this.secret = o.secret || ''; this.seedUsers = Array.isArray(o.seedUsers) ? o.seedUsers : []; this.bank = o.bank;
    this.log = o.log || (() => { }); this.cache = null; this.pending = []; this.limUser = new Limiter(8, 15 * 60e3); this.limIp = new Limiter(40, 15 * 60e3);
    this.ops = { login: this.opLogin, load: this.opLoad, put: this.opPut, remove: this.opRemove, settings: this.opSettings, audit: this.opAudit, password: this.opPassword, userCreate: this.opUserCreate, userReset: this.opUserReset, export: this.opExport, import: this.opImport };
  }
  configured() { return !!(this.secret && this.secret.length >= 32 && this.store && this.store.ready !== false); }

  /* المستند وذاكرة التخزين المؤقت للنسخة الدافئة */
  async readDoc(fresh) {
    const c = this.cache;
    if (c && !fresh && Date.now() - c.at < LIMITS.cacheMs) return c;
    const r = await this.store.read(PATHS.db, c && c.etag ? { ifNoneMatch: c.etag } : {});
    if (r.status === 304 && c) { c.at = Date.now(); return c; }
    if (r.status === 404) { this.cache = null; return { doc: null, etag: null, at: Date.now() }; }
    const doc = JSON.parse(gunzipSync(r.body).toString('utf8'));
    this.cache = { doc, etag: r.etag, at: Date.now() }; return this.cache;
  }
  initialDoc() {
    if (!this.seedUsers.length) throw E.config('لم تُضبط قائمة المستخدمين الأولية على الخادم.');
    if (!this.bank || !Array.isArray(this.bank.templates)) throw E.config('تعذر تحميل بنك الأسئلة على الخادم.');
    const now = new Date().toISOString();
    const doc = { v: 1, rev: 0, createdAt: now, updatedAt: now, data: Object.fromEntries(COLLS.map(c => [c, []])), settings: jsonClone(this.bank.defaultSettings), audit: [], auditArchives: [], secrets: {}, logins: {}, lastBackupDay: now.slice(0, 10) };
    for (const t of this.bank.templates) doc.data.templates.push({ id: randomUUID(), role: t.role, name: t.name, version: 1, status: 'active', axes: jsonClone(t.axes), note: 'الإصدار الافتراضي من المنهجية المرجعية', createdAt: now, updatedAt: now });
    const seen = new Set();
    for (const s of this.seedUsers) {
      const username = String(s.username || '').trim(); if (!username || seen.has(username.toLowerCase())) continue; seen.add(username.toLowerCase());
      const id = s.id && ID_RE.test(s.id) ? s.id : randomUUID();
      doc.data.users.push({ id, username, name: String(s.name || username), email: String(s.email || ''), role: ROLES.includes(s.role) ? s.role : 'engineer', active: true, createdAt: now, updatedAt: now });
      if (s.hash && s.salt) doc.secrets[id] = { algo: s.algo === 'sha256' ? 'sha256' : 'pbkdf2', salt: s.salt, iter: s.iter || LIMITS.iter, hash: s.hash, mustChange: true, pwv: 1 };
    }
    doc.audit.push(this.entry(null, 'system_init', 'system', null, { name: 'تهيئة قاعدة البيانات السحابية' }));
    return doc;
  }
  queue(p) { this.pending.push(p); if (this.pending.length > 500) this.pending.splice(0, this.pending.length - 500); }
  async mutate(fn) {
    let forceFresh = false;
    for (let attempt = 0; attempt < 7; attempt++) {
      const t0 = Date.now(); const cur = await this.readDoc(forceFresh || attempt > 0); const fresh = cur.at >= t0;
      const create = !cur.doc; const doc = create ? this.initialDoc() : jsonClone(cur.doc);
      const applied = this.pending.slice();
      for (const p of applied) { if (p.type === 'login') doc.logins[p.userId] = p.at; else if (p.type === 'audit') doc.audit.push(p.entry); }
      let result;
      // رفضٌ بُني على نسخة مؤقتة قد تكون أقدم من آخر حفظ في نسخة أخرى للخادم: يُعاد تقييمه مرة على أحدث نسخة قبل اعتماده
      try { result = await fn(doc); } catch (e) { if (e instanceof HttpError && !fresh && !create) { forceFresh = true; continue; } throw e; }
      doc.rev = (doc.rev || 0) + 1; doc.updatedAt = new Date().toISOString();
      const extra = [];
      if (doc.audit.length > LIMITS.auditKeep) { const chunk = doc.audit.splice(0, LIMITS.auditChunk); const p = PATHS.audit + doc.updatedAt.replace(/[^0-9]/g, '').slice(0, 14) + '-' + randomBytes(3).toString('hex') + '.json.gz'; extra.push({ path: p, body: gzipSync(Buffer.from(JSON.stringify(chunk))) }); (doc.auditArchives = doc.auditArchives || []).push(p); }
      const today = doc.updatedAt.slice(0, 10); const backup = !create && doc.lastBackupDay !== today; if (backup) doc.lastBackupDay = today;
      try {
        for (const w of extra) await this.store.write(w.path, w.body, { contentType: 'application/gzip' });
        if (backup) await this.backup(today);
        const etag = await this.store.write(PATHS.db, gzipSync(Buffer.from(JSON.stringify(doc))), create ? { create: true, contentType: 'application/gzip' } : { ifMatch: cur.etag, contentType: 'application/gzip' });
        this.cache = { doc, etag, at: Date.now() };
        this.pending = this.pending.filter(p => !applied.includes(p));
        return result;
      } catch (e) {
        if (e && e.code === 'precondition') { await sleep(40 + Math.floor(Math.random() * 120) * (attempt + 1)); continue; }
        if (create) { const again = await this.readDoc(true).catch(() => null); if (again && again.doc) continue; }
        throw e;
      }
    }
    throw E.busy();
  }
  async backup(day) {
    try { await this.store.copy(PATHS.db, PATHS.backups + day + '.json.gz'); const old = new Date(Date.parse(day) - 35 * 864e5).toISOString().slice(0, 10); await this.store.del(PATHS.backups + old + '.json.gz'); } catch (e) { this.log('backup failed', e && e.message); }
  }
  entry(user, action, entity, entityId, detail) {
    return { id: randomUUID(), at: new Date().toISOString(), actor: user ? user.id : null, actorName: user ? user.username : 'system', action: String(action || 'event').slice(0, 60), entity: String(entity || '').slice(0, 40), entityId: entityId ? String(entityId).slice(0, 80) : null, detail: isObj(detail) ? { name: String(detail.name == null ? '' : detail.name).slice(0, 200) } : null };
  }
  clientEntry(user, a, entity, entityId) {
    if (!isObj(a)) return null; const action = String(a.action || ''); if (!/^[a-z0-9_]{2,60}$/.test(action)) return null;
    return this.entry(user, action, a.entity || entity, a.entityId || entityId, a.detail);
  }

  /* التحقق من الجلسة */
  async authed(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
    const t = m && readToken(this.secret, m[1].trim()); if (!t) throw E.auth();
    const t0 = Date.now(); let cur = await this.readDoc(false);
    const ok = c => { if (!c.doc) throw E.auth(); return this.check(c.doc, t); };
    try { return { user: ok(cur), doc: cur.doc, token: t, fresh: cur.at >= t0 }; }
    catch (e) { if (!(e instanceof HttpError) || e.status !== 401 || cur.at >= t0) throw e; cur = await this.readDoc(true); return { user: ok(cur), doc: cur.doc, token: t, fresh: true }; }
  }
  /* نسخة محدّثة للعمليات التي يجب أن ترى آخر ما حُفظ (تحميل البيانات والمرفقات): طلب مشروط رخيص يعيد 304 إن لم يتغير شيء */
  async freshAuthed(req) { const a = await this.authed(req); if (a.fresh) return a; const cur = await this.readDoc(true); if (!cur.doc) throw E.auth(); return { user: this.check(cur.doc, a.token), doc: cur.doc, token: a.token, fresh: true }; }
  check(doc, t) {
    const user = doc.data.users.find(u => u.id === t.u); const sec = doc.secrets[t.u];
    if (!user || !user.active || !sec || (sec.pwv || 0) !== t.v) throw E.auth();
    return user;
  }

  /* ما يراه المستخدم */
  project(doc, user) {
    const out = {}; for (const c of COLLS) out[c] = doc.data[c];
    out.users = doc.data.users.map(u => { const s = doc.secrets[u.id] || {}; const x = Object.assign({}, u, { mustChange: !!s.mustChange, lastLoginAt: doc.logins[u.id] || null }); delete x.hash; delete x.salt; delete x.password; delete x.pwv; return x; });
    if (!canViewAll(user)) {
      const vis = this.visibleEvals(doc, user); out.evaluations = vis;
      const ids = new Set(vis.map(e => e.id)); out.attachments = doc.data.attachments.filter(a => !a.evaluationId || ids.has(a.evaluationId));
    }
    out.settings = doc.settings; out.audit = rankOf(user) >= 3 ? doc.audit.slice(-1500) : [];
    return out;
  }
  visibleEvals(doc, user) {
    const v = (doc.settings && doc.settings.visibility) || 'after_submit'; const evs = doc.data.evaluations;
    const mine = new Set(evs.filter(e => e.evaluatorId === user.id && e.status === 'submitted').map(e => e.cycleId));
    return evs.filter(e => e.evaluatorId === user.id || (e.status === 'submitted' && (v === 'always' || (v === 'after_submit' && mine.has(e.cycleId)))));
  }

  /* قواعد الكتابة */
  authorizePut(doc, me, coll, rec, prev) {
    const r = rankOf(me);
    if (r < 1) throw E.forbid('حساب المتابعة للاطلاع فقط ولا يملك صلاحية التعديل.');
    const contract = id => doc.data.contracts.find(c => c.id === id); const cycle = id => doc.data.cycles.find(c => c.id === id);
    switch (coll) {
      case 'users': {
        if (me.role !== 'admin') throw E.forbid('إدارة المستخدمين لمدير النظام فقط.');
        if (!prev) throw E.bad('أضف المستخدم من شاشة المستخدمين.');
        if (!ROLES.includes(rec.role)) throw E.bad('دور غير معروف.');
        if (String(rec.username) !== String(prev.username)) throw E.bad('لا يمكن تغيير اسم المستخدم.');
        if (rec.id === me.id && (rec.active === false || rec.role !== 'admin')) throw E.bad('لا يمكنك تعطيل حسابك أو تغيير دورك.');
        const others = doc.data.users.filter(u => u.role === 'admin' && u.active && u.id !== rec.id).length;
        if (prev.role === 'admin' && prev.active && (rec.role !== 'admin' || rec.active === false) && !others) throw E.bad('لا يمكن تعطيل آخر مدير نظام أو تغيير دوره.');
        return;
      }
      case 'templates': if (r < 3) throw E.forbid('تعديل النماذج والأوزان للمعتمدين فقط.'); return;
      case 'companies': {
        if (r < 2) throw E.forbid('إضافة الشركات وتعديلها لرئيس القسم فما فوق.');
        const keys = ['status', 'status_until', 'status_reason'];
        const changed = prev ? keys.some(k => !same(prev[k], rec[k])) : !!(rec.status && rec.status !== 'normal');
        if (changed && r < 3) throw E.forbid('تغيير حالة الشركة (مفضلة / مراقبة / قائمة سوداء) للمعتمدين فقط.');
        return;
      }
      case 'projects': case 'contracts': case 'letters': if (r < 2) throw E.forbid('هذا الإجراء لرئيس القسم فما فوق.'); return;
      case 'cycles': {
        const k = contract(rec.contractId); if (!k) throw E.bad('العقد غير موجود.');
        if (!prev) { if (r < 2 && k.leadEngineer !== me.id) throw E.forbid('فتح دورات التقييم لرئيس القسم أو المهندس المسؤول عن العقد.'); if (rec.status !== 'open') throw E.bad('تُفتح الدورة الجديدة بحالة «مفتوحة».'); return; }
        if (r < 2) throw E.forbid('تعديل الدورات لرئيس القسم فما فوق.');
        if (prev.contractId !== rec.contractId) throw E.bad('لا يمكن نقل الدورة إلى عقد آخر.');
        const approving = (rec.status === 'approved' && prev.status !== 'approved') || ['approvedBy', 'approvedAt', 'consequence', 'approvalNote'].some(x => !same(prev[x], rec[x]));
        if (approving && r < 3) throw E.forbid('اعتماد النتيجة لمدير الإدارة أو مساعده أو رئيس قسم تنمية الوقف.');
        const locked = s => s === 'approved' || s === 'closed';
        if (locked(prev.status) && !locked(rec.status) && me.role !== 'admin') throw E.forbid('إعادة فتح دورة معتمدة لمدير النظام فقط.');
        return;
      }
      case 'evaluations': {
        const own = rec.evaluatorId === me.id && (!prev || prev.evaluatorId === me.id);
        if (own) {
          const cy = cycle(rec.cycleId); if (!cy) throw E.bad('الدورة غير موجودة.');
          if (!prev && cy.status !== 'open') throw E.forbid('الدورة غير مفتوحة للتقييم.');
          if (cy.status === 'approved' || cy.status === 'closed') throw E.forbid('الدورة معتمدة ومقفلة، ولا تُعدَّل تقييماتها.');
          if (prev && prev.status === 'submitted') throw E.forbid('قُدِّم هذا التقييم، ولا يُعدَّل إلا بعد إعادته من المراجع.');
          if (prev && (prev.cycleId !== rec.cycleId || prev.contractId !== rec.contractId)) throw E.bad();
          if (!prev) { if (cy.contractId !== rec.contractId) throw E.bad(); if (doc.data.evaluations.some(e => e.cycleId === rec.cycleId && e.evaluatorId === me.id)) throw E.bad('لديك تقييم في هذه الدورة.'); }
          return;
        }
        if (r < 2) throw E.forbid('لا يمكنك تعديل تقييم زميل.');
        if (!prev) throw E.forbid('لا يمكن إنشاء تقييم باسم مقيّم آخر.');
        const allowed = new Set(['status', 'returnedNote', 'returnedBy', 'returnedAt', 'updatedAt']);
        for (const k2 of new Set([...Object.keys(prev), ...Object.keys(rec)])) if (!allowed.has(k2) && !same(prev[k2], rec[k2])) throw E.forbid('لا يجوز للمراجع تعديل تقييم زميل؛ أعِده إلى صاحبه مع الملاحظة.');
        if (rec.status !== 'returned' || prev.status !== 'submitted') throw E.bad('يُعاد التقييم المقدَّم فقط.');
        return;
      }
      case 'attachments': {
        if (prev) { if (r < 2) throw E.forbid(); return; }
        if (rec.uploadedBy !== me.id) throw E.bad();
        if (rec.evaluationId) { const e = doc.data.evaluations.find(x => x.id === rec.evaluationId); if (!e) throw E.bad('التقييم غير موجود.'); if (e.evaluatorId !== me.id && r < 2) throw E.forbid(); }
        return;
      }
    }
    throw E.bad();
  }
  authorizeRemove(doc, me, coll, prev) {
    const r = rankOf(me);
    if (r < 1) throw E.forbid('حساب المتابعة للاطلاع فقط ولا يملك صلاحية التعديل.');
    switch (coll) {
      case 'attachments': if (prev.uploadedBy !== me.id && r < 2) throw E.forbid(); return;
      case 'cycles': if (r < 2) throw E.forbid(); if (prev.status !== 'open' || doc.data.evaluations.some(e => e.cycleId === prev.id)) throw E.bad('لا تُحذف إلا دورة مفتوحة بلا تقييمات.'); return;
      case 'companies': case 'projects': case 'contracts': case 'templates': case 'letters': case 'evaluations': if (me.role !== 'admin') throw E.forbid('الحذف لمدير النظام فقط.'); return;
    }
    throw E.forbid('هذا السجل لا يُحذف.');
  }

  /* ---------- نقاط الدخول ---------- */
  health() { return respond(200, { ok: true, app: 'sijil-alada', mode: 'cloud', configured: this.configured() }); }
  errorResponse(e, req) {
    if (e instanceof HttpError) return respond(e.status, Object.assign({ error: e.message, code: e.code }, e.extra || {}), req);
    this.log('server error', e && (e.stack || e.message));
    return respond(500, { error: 'حدث خطأ في الخادم. أعد المحاولة، وإن تكرر فأبلغ مدير النظام.', code: 'server_error' }, req);
  }
  async rpc(req) {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed', 'method');
      if (!this.configured()) throw E.config('الخادم غير مهيأ بعد (مفتاح الجلسات أو التخزين).');
      if (Number(req.headers.get('content-length') || 0) > LIMITS.body) throw E.large();
      const raw = Buffer.from(await req.arrayBuffer()); if (raw.length > LIMITS.body) throw E.large();
      let body; try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (e) { throw E.bad(); }
      if (!isObj(body) || typeof body.op !== 'string' || !Object.prototype.hasOwnProperty.call(this.ops, body.op)) throw E.bad('عملية غير معروفة.');
      return respond(200, await this.ops[body.op].call(this, body, req), req);
    } catch (e) { return this.errorResponse(e, req); }
  }

  async opLogin(b, req) {
    const username = String(b.username || '').trim().toLowerCase(); const pw = typeof b.password === 'string' ? b.password : '';
    if (!username || !pw || username.length > 80 || pw.length > 200) throw E.bad('أدخل اسم المستخدم وكلمة المرور.');
    const ip = clientIp(req);
    if (this.limIp.blocked(ip) || this.limUser.blocked(username)) throw E.limited();
    let cur = await this.readDoc(true);   // يُتحقق دائماً على أحدث نسخة (مستخدم أُضيف أو كلمة مرور أُعيدت للتو من نسخة أخرى للخادم)
    if (!cur.doc) { await this.mutate(() => null); cur = await this.readDoc(false); }
    let doc = cur.doc;
    const user = doc.data.users.find(x => String(x.username).toLowerCase() === username); const sec = user && doc.secrets[user.id];
    const ok = sec ? await verifyPassword(sec, pw) : (await hashPassword(pw, '0'.repeat(32)), false);
    if (!ok || !user.active) { this.limIp.fail(ip); this.limUser.fail(username); throw new HttpError(403, ok && !user.active ? 'هذا الحساب معطَّل. راجع مدير النظام.' : 'اسم المستخدم أو كلمة المرور غير صحيحة.', 'bad_credentials'); }
    this.limUser.ok(username);
    const at = new Date().toISOString();
    if (sec.algo === 'sha256') { const h = await hashPassword(pw); await this.mutate(d => { const s = d.secrets[user.id]; if (s && s.algo === 'sha256') Object.assign(s, h); d.logins[user.id] = at; d.audit.push(this.entry(user, 'login', 'users', user.id)); }); doc = (await this.readDoc(false)).doc; }
    else { this.queue({ type: 'login', userId: user.id, at }); this.queue({ type: 'audit', entry: this.entry(user, 'login', 'users', user.id) }); }
    const s2 = doc.secrets[user.id];
    return { token: signToken(this.secret, user.id, s2.pwv || 0), me: user.id, mustChange: !!s2.mustChange, data: this.project(doc, user), rev: doc.rev };
  }
  async opLoad(b, req) { const { user, doc } = await this.freshAuthed(req); return { me: user.id, data: this.project(doc, user), rev: doc.rev }; }
  async opPut(b, req) {
    const { token } = await this.authed(req);
    if (!COLLS.includes(b.coll)) throw E.bad('مجموعة غير معروفة.');
    if (!isObj(b.rec) || typeof b.rec.id !== 'string' || !ID_RE.test(b.rec.id)) throw E.bad('سجل غير صالح.');
    if (Buffer.byteLength(JSON.stringify(b.rec)) > LIMITS.record) throw E.large('السجل أكبر من الحد المسموح.');
    const rec = sanitize(b.coll, b.rec); const base = typeof b.base === 'string' ? b.base : null;
    let prevRev;
    await this.mutate(doc => {
      prevRev = doc.rev; const me = this.check(doc, token); const arr = doc.data[b.coll]; const i = arr.findIndex(x => x.id === rec.id); const prev = i >= 0 ? arr[i] : null;
      this.authorizePut(doc, me, b.coll, rec, prev);
      if (prev && (prev.updatedAt || null) !== base) throw E.conflict();
      if (b.coll === 'users') Object.assign(rec, { username: prev.username, createdAt: prev.createdAt });
      if (i >= 0) arr[i] = rec; else arr.push(rec);
      const a = this.clientEntry(me, b.audit, b.coll, rec.id); if (a) doc.audit.push(a);
    });
    return { ok: true, rev: this.cache.doc.rev, prevRev };
  }
  async opRemove(b, req) {
    const { token } = await this.authed(req);
    if (!COLLS.includes(b.coll) || typeof b.id !== 'string') throw E.bad();
    let prevRev;
    await this.mutate(doc => {
      prevRev = doc.rev; const me = this.check(doc, token); const prev = doc.data[b.coll].find(x => x.id === b.id); if (!prev) return;
      this.authorizeRemove(doc, me, b.coll, prev);
      doc.data[b.coll] = doc.data[b.coll].filter(x => x.id !== b.id);
      const a = this.clientEntry(me, b.audit, b.coll, b.id); if (a) doc.audit.push(a);
    });
    return { ok: true, rev: this.cache.doc.rev, prevRev };
  }
  async opSettings(b, req) {
    const { token } = await this.authed(req);
    if (!isObj(b.settings) || Buffer.byteLength(JSON.stringify(b.settings)) > LIMITS.settings) throw E.bad('إعدادات غير صالحة.');
    let prevRev;
    await this.mutate(doc => { prevRev = doc.rev; const me = this.check(doc, token); if (me.role !== 'admin') throw E.forbid('الإعدادات لمدير النظام فقط.'); doc.settings = cleanSettings(b.settings); doc.audit.push(this.entry(me, 'settings_update', 'settings', null)); });
    return { ok: true, rev: this.cache.doc.rev, prevRev };
  }
  async opAudit(b, req) {
    const { user } = await this.authed(req); const a = this.clientEntry(user, b.entry);
    if (a && !SERVER_AUDITED.has(a.action)) this.queue({ type: 'audit', entry: a });
    return { ok: true };
  }
  async opPassword(b, req) {
    const { user, token } = await this.authed(req);
    const next = typeof b.next === 'string' ? b.next : ''; checkNewPassword(next, user);
    const { doc } = await this.readDoc(true); const sec = doc.secrets[user.id];
    if (!sec.mustChange) {
      if (this.limUser.blocked(String(user.username).toLowerCase())) throw E.limited();
      if (typeof b.current !== 'string' || !(await verifyPassword(sec, b.current))) { this.limUser.fail(String(user.username).toLowerCase()); throw new HttpError(403, 'كلمة المرور الحالية غير صحيحة.', 'bad_credentials'); }
    }
    if (await verifyPassword(sec, next)) throw E.bad('اختر كلمة مرور مختلفة عن الحالية.');
    const h = await hashPassword(next); let pwv, prevRev;
    await this.mutate(d => { prevRev = d.rev; const me = this.check(d, token); const s = d.secrets[me.id] || {}; pwv = (s.pwv || 0) + 1; d.secrets[me.id] = Object.assign({}, s, h, { mustChange: false, pwv, changedAt: new Date().toISOString() }); d.audit.push(this.entry(me, 'password_change', 'users', me.id)); });
    return { ok: true, token: signToken(this.secret, user.id, pwv), rev: this.cache.doc.rev, prevRev };
  }
  async opUserCreate(b, req) {
    const { token } = await this.authed(req); const u = isObj(b.user) ? b.user : {};
    const username = String(u.username || '').trim(); const name = String(u.name || '').trim(); const email = String(u.email || '').trim(); const role = String(u.role || 'engineer');
    if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) throw E.bad('اسم المستخدم: حروف إنجليزية وأرقام ونقطة وشرطة فقط.');
    if (!name || name.length > 120 || email.length > 120 || !ROLES.includes(role)) throw E.bad('أكمل بيانات المستخدم.');
    const temp = tempPassword(); const h = await hashPassword(temp); const id = randomUUID(); let created, prevRev;
    await this.mutate(doc => {
      prevRev = doc.rev; const me = this.check(doc, token); if (me.role !== 'admin') throw E.forbid('إدارة المستخدمين لمدير النظام فقط.');
      if (doc.data.users.some(x => String(x.username).toLowerCase() === username.toLowerCase())) throw E.bad('اسم المستخدم مستخدم من قبل.');
      const now = new Date().toISOString(); created = { id, username, name, email, role, active: true, createdAt: now, updatedAt: now, createdBy: me.id };
      doc.data.users.push(created); doc.secrets[id] = Object.assign({}, h, { mustChange: true, pwv: 1 }); doc.audit.push(this.entry(me, 'user_create', 'users', id, { name }));
    });
    return { ok: true, user: Object.assign({}, created, { mustChange: true, lastLoginAt: null }), tempPassword: temp, rev: this.cache.doc.rev, prevRev };
  }
  async opUserReset(b, req) {
    const { token } = await this.authed(req); const temp = tempPassword(); const h = await hashPassword(temp); let prevRev;
    await this.mutate(doc => {
      prevRev = doc.rev; const me = this.check(doc, token); if (me.role !== 'admin') throw E.forbid('إدارة المستخدمين لمدير النظام فقط.');
      const u = doc.data.users.find(x => x.id === b.id); if (!u) throw E.notFound('المستخدم غير موجود.');
      if (u.id === me.id) throw E.bad('غيّر كلمة مرورك من صفحة «كلمة المرور».');
      const s = doc.secrets[u.id] || {}; doc.secrets[u.id] = Object.assign({}, s, h, { mustChange: true, pwv: (s.pwv || 0) + 1 }); doc.audit.push(this.entry(me, 'user_password_reset', 'users', u.id, { name: u.name }));
    });
    return { ok: true, tempPassword: temp, rev: this.cache.doc.rev, prevRev };
  }
  async opExport(b, req) {
    const { user } = await this.authed(req); const { doc } = await this.readDoc(true); const me = doc.data.users.find(u => u.id === user.id) || user;
    const exportedAt = new Date().toISOString();
    if (me.role !== 'admin') return { json: JSON.stringify(Object.assign({ format: 'sijil-alada-cloud', scope: 'user', exportedAt }, this.project(doc, me))) };
    let audit = doc.audit; const archived = [];
    for (const p of (doc.auditArchives || [])) { try { const r = await this.store.read(p, {}); if (r.status === 200) archived.push(...JSON.parse(gunzipSync(r.body).toString('utf8'))); } catch (e) { this.log('archive read failed', p); } }
    audit = archived.concat(audit);
    const out = Object.assign({ format: 'sijil-alada-cloud', scope: 'full', version: 1, exportedAt }, jsonClone(doc.data), { settings: doc.settings, audit, credentials: doc.secrets, logins: doc.logins });
    return { json: JSON.stringify(out) };
  }
  async opImport(b, req) {
    const { token } = await this.authed(req); const P = b.payload;
    if (!isObj(P)) throw E.bad('ملف النسخة غير صالح.');
    const fromCloud = P.format === 'sijil-alada-cloud' && P.scope === 'full';
    const incomingUsers = Array.isArray(P.users) ? P.users.filter(u => isObj(u) && typeof u.id === 'string' && ID_RE.test(u.id) && typeof u.username === 'string' && u.username.trim()) : [];
    const temps = {}; for (const u of incomingUsers) temps[u.id] = { pw: tempPassword() };
    for (const k of Object.keys(temps)) temps[k].h = await hashPassword(temps[k].pw);
    const report = { counts: {}, tempPasswords: [], skipped: 0, files: 0 }; let meNewId = null;
    await this.mutate(doc => {
      const me = this.check(doc, token); if (me.role !== 'admin') throw E.forbid('الاستيراد لمدير النظام فقط.');
      report.counts = {}; report.tempPasswords = []; report.skipped = 0; meNewId = null;
      const remap = {};
      for (const iu of incomingUsers) {
        const u = sanitize('users', iu); if (!ROLES.includes(u.role)) u.role = 'engineer'; u.active = u.active !== false;
        const byId = doc.data.users.find(x => x.id === u.id); const byName = doc.data.users.find(x => String(x.username).toLowerCase() === String(u.username).toLowerCase());
        const target = byId || byName; const oldSec = target ? doc.secrets[target.id] : null;
        let inc = fromCloud ? (P.credentials && P.credentials[iu.id]) : (iu.hash && iu.salt ? { algo: 'sha256', salt: iu.salt, hash: iu.hash, mustChange: !!iu.mustChange } : null);
        if (inc && (!isObj(inc) || !inc.hash || !inc.salt || isLegacyDefault(inc))) inc = null;
        let sec;
        if (oldSec && !oldSec.mustChange) sec = oldSec;                       // من غيّر كلمة مروره على النسخة السحابية يحتفظ بها
        else if (inc) sec = { algo: inc.algo === 'sha256' ? 'sha256' : 'pbkdf2', salt: inc.salt, iter: inc.iter || LIMITS.iter, hash: inc.hash, mustChange: !!inc.mustChange, pwv: ((oldSec && oldSec.pwv) || 0) + 1 };
        else if (oldSec) sec = oldSec;                                       // يبقى على كلمة المرور المؤقتة التي أُرسلت له
        else { sec = Object.assign({}, temps[iu.id].h, { mustChange: true, pwv: 1 }); report.tempPasswords.push({ username: u.username, name: u.name, password: temps[iu.id].pw }); }
        if (target && target.id !== u.id) { remap[target.id] = u.id; doc.data.users = doc.data.users.filter(x => x.id !== target.id); delete doc.secrets[target.id]; if (doc.logins[target.id]) { doc.logins[u.id] = doc.logins[target.id]; delete doc.logins[target.id]; } if (target.id === me.id) meNewId = u.id; }
        const i = doc.data.users.findIndex(x => x.id === u.id); if (i >= 0) doc.data.users[i] = u; else doc.data.users.push(u);
        doc.secrets[u.id] = sec;
      }
      if (Object.keys(remap).length) { const walk = v => { if (typeof v === 'string') return remap[v] || v; if (Array.isArray(v)) return v.map(walk); if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[remap[k] || k] = walk(v[k]); return o; } return v; }; for (const c of COLLS) if (c !== 'users') doc.data[c] = doc.data[c].map(walk); doc.audit = doc.audit.map(walk); }
      report.counts.users = incomingUsers.length;
      for (const c of COLLS) {
        if (c === 'users' || !Array.isArray(P[c])) continue; let n = 0;
        for (const r0 of P[c]) { if (!isObj(r0) || typeof r0.id !== 'string' || !ID_RE.test(r0.id) || Buffer.byteLength(JSON.stringify(r0)) > LIMITS.record) { report.skipped++; continue; } const r = jsonClone(r0); const i = doc.data[c].findIndex(x => x.id === r.id); if (i >= 0) doc.data[c][i] = r; else doc.data[c].push(r); n++; }
        report.counts[c] = n;
      }
      if (isObj(P.settings) && Buffer.byteLength(JSON.stringify(P.settings)) <= LIMITS.settings) doc.settings = cleanSettings(P.settings);
      if (Array.isArray(P.audit)) { const have = new Set(doc.audit.map(a => a.id)); const add = P.audit.filter(a => isObj(a) && a.id && !have.has(a.id)).slice(-LIMITS.auditKeep).map(a => ({ id: String(a.id).slice(0, 80), at: String(a.at || ''), actor: a.actor || null, actorName: String(a.actorName || ''), action: String(a.action || '').slice(0, 60), entity: String(a.entity || '').slice(0, 40), entityId: a.entityId || null, detail: isObj(a.detail) ? { name: String(a.detail.name || '').slice(0, 200) } : null })); doc.audit = add.concat(doc.audit).sort((x, y) => (x.at < y.at ? -1 : 1)).slice(-LIMITS.auditKeep); report.counts.audit = add.length; }
      if (P.files && isObj(P.files)) report.files = Object.keys(P.files).length;
      doc.audit.push(this.entry(me, 'backup_import', 'system', null, { name: Object.entries(report.counts).map(([k, v]) => k + ':' + v).join(' ') }));
    });
    const out = Object.assign({ ok: true, rev: this.cache.doc.rev }, report);
    if (meNewId) { const s = this.cache.doc.secrets[meNewId]; out.token = signToken(this.secret, meNewId, s.pwv || 0); out.me = meNewId; }
    return out;
  }

  /* ---------- المرفقات ---------- */
  canSeeFile(doc, user, path, att) {
    if (doc.data.contracts.some(k => k.noticeFile === path)) return true;
    if (!att) return canViewAll(user);
    if (canViewAll(user) || !att.evaluationId) return true;
    return this.visibleEvals(doc, user).some(e => e.id === att.evaluationId);
  }
  async file(req) {
    try {
      if (!this.configured()) throw E.config();
      const path = new URL(req.url).searchParams.get('path') || '';
      if (!FILE_RE.test(path) || path.includes('..')) throw E.bad('مسار ملف غير صالح.');
      const { user, doc } = await this.freshAuthed(req); const r = rankOf(user);
      const key = PATHS.files + sha256hex(path); const att = doc.data.attachments.find(a => a.path === path);
      if (req.method === 'GET') {
        if (!this.canSeeFile(doc, user, path, att)) throw E.notFound('الملف غير موجود.');
        const f = await this.store.read(key, {}); if (f.status !== 200) throw E.notFound('الملف غير موجود في التخزين.');
        const name = (att && att.name) || path.split('/').pop().replace(/^[0-9a-f]{8}__|^notice__/, '');
        return new Response(f.body, { status: 200, headers: { 'content-type': (att && att.mime) || f.contentType || 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        if (r < 1) throw E.forbid('حساب المتابعة للاطلاع فقط ولا يملك صلاحية التعديل.');
        const k = doc.data.contracts.find(c => c.id === path.split('/')[1]); if (!k) throw E.bad('العقد غير موجود.');
        if (r < 2 && !(k.leadEngineer === user.id || (k.evaluators || []).includes(user.id) || doc.data.evaluations.some(e => e.contractId === k.id && e.evaluatorId === user.id))) throw E.forbid('لست ضمن فريق تقييم هذا العقد.');
        if (Number(req.headers.get('content-length') || 0) > LIMITS.file) throw E.large('حجم الملف أكبر من 4 ميجابايت.');
        const buf = Buffer.from(await req.arrayBuffer()); if (!buf.length) throw E.bad('الملف فارغ.'); if (buf.length > LIMITS.file) throw E.large('حجم الملف أكبر من 4 ميجابايت.');
        await this.store.write(key, buf, { contentType: String(req.headers.get('content-type') || 'application/octet-stream').slice(0, 120) });
        return respond(200, { ok: true, size: buf.length }, req);
      }
      if (req.method === 'DELETE') {
        if (r < 1) throw E.forbid();
        if (att ? (att.uploadedBy !== user.id && r < 2) : r < 2) throw E.forbid();
        await this.store.del(key); return respond(200, { ok: true }, req);
      }
      throw new HttpError(405, 'Method not allowed', 'method');
    } catch (e) { return this.errorResponse(e, req); }
  }
}
