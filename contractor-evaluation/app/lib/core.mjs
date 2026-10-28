/* سجل الأداء — منطق الخادم السحابي (مستقل عن منصة الاستضافة ومحرك التخزين)
   - قاعدة البيانات مستند واحد مضغوط (ev/db.json.gz) يُكتب بشرط ETag (تزامن تفاؤلي)، وتُجمَّع الكتابات المتزامنة في النسخة الواحدة في كتابة واحدة.
   - الدخول بكلمة مرور مجزأة PBKDF2 ورمز جلسة موقّع HMAC؛ كلمات المرور وتجزئاتها لا تُرسل إلى المتصفح أبداً.
   - الصلاحيات تُفرض هنا على الخادم وفق الأدوار نفسها في الواجهة، وتقييمات الزملاء تُحجب عن المهندس حسب إعداد الرؤية. */
import { createHmac, createHash, pbkdf2 as pbkdf2cb, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { promisify } from 'node:util';

const pbkdf2 = promisify(pbkdf2cb);

export const COLLS = ['users', 'companies', 'projects', 'contracts', 'templates', 'cycles', 'evaluations', 'letters', 'attachments'];
export const RANK = { secretary: 0, engineer: 1, section_head: 2, assistant_director: 3, waqf_dev_head: 3, director: 4, admin: 5 };
const ROLES = Object.keys(RANK);
export const pathsFor = p => ({ root: p, db: p + 'db.json.gz', files: p + 'files/', audit: p + 'audit/', backups: p + 'backups/' });
export const LIMITS = {
  file: 4 * 1024 * 1024, record: 512 * 1024, body: 4 * 1024 * 1024, importRaw: 64 * 1024 * 1024, settings: 64 * 1024,
  auditKeep: 3000, auditChunk: 2000, cacheMs: 10000, tokenMs: 12 * 3600e3, iter: 120000, minPassword: 8,
  loginRecordMs: 4 * 3600e3, backupDays: 35, writesPer5Min: 150, uploadsPer10Min: 40,
};
const SERVER_AUDITED = new Set(['login', 'settings_update', 'backup_import', 'backup_export', 'password_change', 'user_password_reset', 'user_create']);
const CLIENT_AUDIT = new Set(['logout']);
const WEAK = new Set(['12345678', '123456789', '1234567890', '87654321', 'password', 'password1', 'qwertyui', '11111111', '00000000', 'awqaf123', 'awqaf2026', 'abcd1234', 'abc12345']);
const ID_RE = /^[A-Za-z0-9_-]{6,80}$/;
const USER_RE = /^[A-Za-z0-9._-]{2,40}$/;
const FILE_RE = /^attachments\/[A-Za-z0-9_-]{6,80}\/[^/\\]{1,240}$/;
const HEX = /^[0-9a-f]+$/i;
export const NOOP = Symbol('noop');

export class HttpError extends Error { constructor(status, message, code, extra) { super(message); this.status = status; this.code = code || 'error'; this.extra = extra; } }
const E = {
  auth: () => new HttpError(401, 'انتهت الجلسة أو لم تسجّل الدخول. سجّل الدخول مجدداً.', 'unauthorized'),
  forbid: m => new HttpError(403, m || 'ليست لديك صلاحية لهذا الإجراء.', 'forbidden'),
  bad: m => new HttpError(400, m || 'طلب غير صالح.', 'bad_request'),
  notFound: m => new HttpError(404, m || 'غير موجود.', 'not_found'),
  conflict: current => new HttpError(409, 'عدّل مستخدم آخر هذا السجل بعد أن فتحته. اضغط «⟳ تحديث» ثم أعد المحاولة.', 'conflict', { current: current == null ? null : current }),
  deleted: () => new HttpError(409, 'حذف مستخدم آخر هذا السجل بعد أن فتحته، فلم يُحفظ تعديلك. اضغط «⟳ تحديث».', 'conflict', { current: null, deleted: true }),
  exists: () => new HttpError(409, 'يوجد ملف بالمسار نفسه. أعد إرفاق الملف.', 'exists'),
  staleInputs: () => new HttpError(409, 'تغيّرت التقييمات المقدَّمة منذ فتحت الصفحة، فلم تُحفظ النتيجة. حدّث البيانات ثم أعد التوحيد.', 'stale_inputs'),
  busy: () => new HttpError(503, 'الخادم مشغول حالياً، أعد المحاولة بعد لحظات.', 'busy'),
  config: m => new HttpError(503, m || 'الخادم غير مهيأ بعد.', 'not_configured'),
  limited: () => new HttpError(429, 'محاولات دخول خاطئة كثيرة. انتظر ربع ساعة ثم أعد المحاولة.', 'rate_limited'),
  tooFast: () => new HttpError(429, 'طلبات كثيرة في وقت قصير. انتظر دقيقة ثم أعد المحاولة.', 'rate_limited'),
  large: m => new HttpError(413, m || 'حجم البيانات أكبر من المسموح.', 'too_large'),
  media: () => new HttpError(415, 'نوع الطلب غير مقبول.', 'unsupported_media'),
};

const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const rankOf = u => (u && RANK[u.role] != null ? RANK[u.role] : -1);
const sha256hex = s => createHash('sha256').update(s).digest('hex');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const canon = v => Array.isArray(v) ? v.map(canon) : isObj(v) ? Object.keys(v).sort().reduce((o, k) => { if (v[k] !== undefined) o[k] = canon(v[k]); return o; }, {}) : v;
const same = (a, b) => JSON.stringify(canon(a === undefined ? null : a)) === JSON.stringify(canon(b === undefined ? null : b));
const jsonClone = o => JSON.parse(JSON.stringify(o));
const canViewAll = u => rankOf(u) >= 2 || (u && u.role === 'secretary');
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isStr = (v, max) => typeof v === 'string' && v.length <= (max || 500);
const lc = s => String(s || '').toLowerCase();

function respond(status, body, req) {
  const text = JSON.stringify(body); const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
  const ae = (req && req.headers.get('accept-encoding')) || '';
  if (Buffer.byteLength(text) > 3.5 * 1024 * 1024 && /\bgzip\b/.test(ae)) { headers['content-encoding'] = 'gzip'; headers.vary = 'Accept-Encoding'; return new Response(gzipSync(Buffer.from(text)), { status, headers }); }
  return new Response(text, { status, headers });
}
/* عنوان العميل كما يضعه Vercel؛ عناوين IPv6 تُجمع على مستوى /64 حتى لا يُتجاوز الحد بتبديل العنوان داخل الشبكة نفسها */
export function ipKey(req) {
  const f = req.headers.get('x-forwarded-for') || ''; const ip = (req.headers.get('x-real-ip') || f.split(',')[0] || 'local').trim().slice(0, 64);
  return ip.includes(':') ? ip.split(':').slice(0, 4).join(':') + '::/64' : ip;
}

/* ---------- كلمات المرور والرموز ---------- */
export function tempPassword() { const A = 'abcdefghjkmnpqrstuvwxyz23456789'; const b = randomBytes(8); let s = ''; for (let i = 0; i < 8; i++) { s += A[b[i] % A.length]; if (i === 3) s += '-'; } return s; }
export async function hashPassword(pw, salt, iter) { salt = salt || randomBytes(16).toString('hex'); iter = iter || LIMITS.iter; const dk = await pbkdf2(String(pw), salt, iter, 32, 'sha256'); return { algo: 'pbkdf2', salt, iter, hash: dk.toString('hex') }; }
export async function verifyPassword(sec, pw) {
  if (!sec || !sec.hash || !sec.salt) return false;
  const h = sec.algo === 'sha256' ? sha256hex(sec.salt + ':' + pw) : (await pbkdf2(String(pw), sec.salt, sec.iter || LIMITS.iter, 32, 'sha256')).toString('hex');
  const a = Buffer.from(h, 'hex'), b = Buffer.from(String(sec.hash), 'hex');
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}
export const isLegacyDefault = sec => !!sec && sec.algo === 'sha256' && sha256hex(sec.salt + ':123456') === sec.hash;
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
  if (WEAK.has(low) || /^(.)\1+$/.test(pw) || low === lc(user.username)) throw E.bad('كلمة المرور سهلة التخمين. اختر كلمة أقوى تجمع حروفاً وأرقاماً.');
  if (!/[A-Za-z؀-ۿ]/.test(pw) || !/[0-9]/.test(pw)) throw E.bad('اجمع في كلمة المرور بين الحروف والأرقام.');
}
/* تحقق من قائمة المستخدمين الأولية قبل إنشاء القاعدة: قائمة معيبة لا تُنشئ قاعدة لا يمكن الدخول إليها */
export function seedProblem(seed) {
  if (!Array.isArray(seed) || !seed.length) return 'لم تُضبط قائمة المستخدمين الأولية (SEED_USERS).';
  const seen = new Set(); let admins = 0;
  for (const s of seed) {
    if (!isObj(s) || !USER_RE.test(String(s.username || ''))) return 'اسم مستخدم غير صالح في SEED_USERS.';
    if (seen.has(lc(s.username))) return 'اسم مستخدم مكرر في SEED_USERS: ' + s.username; seen.add(lc(s.username));
    if (!ROLES.includes(s.role)) return 'دور غير معروف في SEED_USERS: ' + s.username;
    const okHash = typeof s.salt === 'string' && s.salt.length >= 8 && typeof s.hash === 'string' && HEX.test(s.hash) && s.hash.length === 64;
    if (s.algo === 'sha256') { if (!okHash || isLegacyDefault(s)) return 'بيانات دخول غير صالحة في SEED_USERS: ' + s.username; }
    else if (s.algo === 'pbkdf2') { if (!okHash || !Number.isInteger(s.iter) || s.iter < 10000) return 'بيانات دخول غير صالحة في SEED_USERS: ' + s.username; }
    else return 'بيانات دخول ناقصة في SEED_USERS (استخدم dev/make-seed.mjs): ' + s.username;
    if (s.role === 'admin') admins++;
  }
  return admins ? null : 'لا يوجد مدير نظام في SEED_USERS.';
}

/* حدّ محاولات في الذاكرة لكل نسخة؛ عند الامتلاء يُحذف الأقدم من غير المحظورين أولاً حتى لا يُمحى حظر حساب بإغراق القائمة */
class Limiter {
  constructor(max, win, cap) { this.max = max; this.win = win; this.cap = cap || 20000; this.m = new Map(); }
  live(k, now) { const r = this.m.get(k); if (r && now - r.t > this.win) { this.m.delete(k); return null; } return r || null; }
  blocked(k) { const r = this.live(k, Date.now()); return !!r && r.n >= this.max; }
  hit(k) {
    const now = Date.now(); let r = this.live(k, now); if (!r) { r = { n: 0, t: now }; this.m.set(k, r); }
    r.n++; if (this.m.size > this.cap) this.evict(now); return r.n > this.max;
  }
  evict(now) {
    for (const [k, r] of this.m) if (now - r.t > this.win) this.m.delete(k);
    for (const [k, r] of this.m) { if (this.m.size <= this.cap) break; if (r.n < this.max) this.m.delete(k); }
    for (const k of this.m.keys()) { if (this.m.size <= this.cap) break; this.m.delete(k); }
  }
  ok(k) { this.m.delete(k); }
}

/* ---------- تنقية السجلات والتحقق من شكلها ---------- */
function sanitize(coll, rec) {
  const r = jsonClone(rec);
  if (coll === 'users') { delete r.hash; delete r.salt; delete r.password; delete r.mustChange; delete r.lastLoginAt; delete r.pwv; }
  return r;
}
function checkConsolidated(c, ratings) {
  if (c == null) return;
  if (!isObj(c) || !Array.isArray(c.axes) || c.axes.length > 40) throw E.bad('نتيجة موحدة غير صالحة.');
  if (c.inputs != null && !(isObj(c.inputs) && Object.entries(c.inputs).every(([k, v]) => ID_RE.test(k) && (v === null || (typeof v === 'string' && v.length < 40))))) throw E.bad('نتيجة موحدة غير صالحة.');
  if (c.total != null && !isNum(c.total)) throw E.bad('نتيجة موحدة غير صالحة.');
  if (c.count != null && !(Number.isInteger(c.count) && c.count >= 0)) throw E.bad('نتيجة موحدة غير صالحة.');
  if (c.rating != null && !ratings.includes(c.rating)) throw E.bad('تصنيف غير معروف.');
  if (c.method != null && !['mean', 'weighted'].includes(c.method)) throw E.bad('طريقة توحيد غير معروفة.');
  if (c.axes != null && !(Array.isArray(c.axes) && c.axes.every(a => isObj(a) && (a.score == null || isNum(a.score)) && (a.weight == null || isNum(a.weight)) && (a.spread == null || isNum(a.spread)) && (a.n == null || Number.isInteger(a.n)) && (a.name == null || isStr(a.name, 300))))) throw E.bad('محاور النتيجة الموحدة غير صالحة.');
  if (c.evaluationIds != null && !(Array.isArray(c.evaluationIds) && c.evaluationIds.every(x => typeof x === 'string' && ID_RE.test(x)))) throw E.bad('نتيجة موحدة غير صالحة.');
  if (c.evalWeights != null && !(isObj(c.evalWeights) && Object.entries(c.evalWeights).every(([u, w]) => ID_RE.test(u) && isNum(w)))) throw E.bad('نتيجة موحدة غير صالحة.');
}
/* شكل السجلات: الواجهة تفترض أن الأسماء والتواريخ نصوص وأن البنى المعروفة كائنات أو قوائم، وسجل واحد مخالف كان يكفي
   لإيقاف شاشات كل المستخدمين. ولا يُقبل اسم حقل من خصائص Object.prototype في أي عمق (toString و__proto__ وأمثالهما). */
const PROTO_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));
const TEXT_FIELDS = new Set(['id', 'name', 'name_ar', 'name_en', 'label', 'subject', 'to', 'contract_no', 'code', 'location', 'description', 'contact_name', 'contact_phone', 'contact_email', 'email', 'cr_number', 'mof_grade', 'notes', 'note', 'reviewNote', 'approvalNote', 'returnedNote', 'reopenReason', 'strengths', 'weaknesses', 'recommendation', 'refNo', 'type', 'role', 'status', 'model', 'username', 'bodyHtml', 'path', 'mime', 'itemKey', 'axisKey', 'consequence', 'method', 'templateId', 'companyId', 'projectId', 'contractId', 'cycleId', 'evaluationId', 'evaluatorId', 'leadEngineer', 'uploadedBy', 'issuedBy', 'createdBy', 'approvedBy', 'reviewedBy', 'returnedBy', 'noticeFile', 'noticeLetterId', 'noticeStatus', 'status_reason']);
const isDateField = k => /(At|Date|_date|_until)$/.test(k);
const NUM_FIELDS = new Set(['value', 'durationMonths', 'version', 'size']);
const LIST_FIELDS = new Set(['roles', 'evaluators', 'excluded', 'axes']);
const OBJ_FIELDS = new Set(['scores', 'computed', 'consolidated', 'objection', 'weights', 'evalWeights']);
const REQUIRED = { companies: ['name_ar'], projects: ['name'], templates: ['name', 'role'], attachments: ['name', 'path'] };
const KEY_RE = /^[a-z][a-z0-9_]{0,40}$/;
function deepCheck(v, depth) {
  if (depth > 12) throw E.bad('بنية السجل معقدة أكثر من اللازم.');
  if (Array.isArray(v)) { if (v.length > 5000) throw E.bad('قائمة أطول من المسموح.'); for (const x of v) deepCheck(x, depth + 1); return; }
  if (isObj(v)) { for (const k of Object.keys(v)) { if (PROTO_KEYS.has(k)) throw E.bad('اسم حقل غير مسموح: ' + k.slice(0, 40)); deepCheck(v[k], depth + 1); } }
}
export function checkRecord(coll, rec) {
  deepCheck(rec, 0);
  for (const k of Object.keys(rec)) {
    const v = rec[k]; if (v === null) continue;
    const bad = () => { throw E.bad('قيمة غير صالحة في الحقل ' + k + '.'); };
    if (TEXT_FIELDS.has(k) || isDateField(k)) { if (typeof v !== 'string') bad(); if (v.length > (k === 'bodyHtml' ? 100000 : 20000)) throw E.bad('النص في الحقل ' + k + ' أطول من المسموح (' + (k === 'bodyHtml' ? 100000 : 20000) + ' حرف).'); }
    else if (NUM_FIELDS.has(k)) { if (!(isNum(v) || (typeof v === 'string' && v.length < 40 && (v.trim() === '' || Number.isFinite(Number(v)))))) bad(); }
    else if (LIST_FIELDS.has(k)) { if (!Array.isArray(v)) bad(); }
    else if (OBJ_FIELDS.has(k)) { if (!isObj(v)) bad(); }
  }
  for (const k of REQUIRED[coll] || []) if (typeof rec[k] !== 'string' || !rec[k].trim()) throw E.bad('حقل مطلوب ناقص: ' + k + '.');
  if (coll === 'templates') checkTemplate(rec);
  if (coll === 'evaluations') checkEvaluation(rec);
}
/* مفاتيح المحاور والأسئلة تُستخدم أسماءَ حقول في الدرجات، فتُقصر على نمط آمن (مفاتيح البنك والمحرر كلها عليه) */
function checkTemplate(t) {
  if (!Array.isArray(t.axes) || !t.axes.length || t.axes.length > 40) throw E.bad('محاور النموذج غير صالحة.');
  const axes = new Set(), items = new Set();
  for (const a of t.axes) {
    if (!isObj(a) || typeof a.key !== 'string' || !KEY_RE.test(a.key) || PROTO_KEYS.has(a.key) || axes.has(a.key) || !isStr(a.name, 300) || !Number.isFinite(Number(a.weight)) || !Array.isArray(a.items) || a.items.length > 300) throw E.bad('محور غير صالح في النموذج.');
    axes.add(a.key);
    for (const i of a.items) if (!isObj(i) || typeof i.key !== 'string' || !KEY_RE.test(i.key) || PROTO_KEYS.has(i.key) || items.has(i.key) || !isStr(i.text, 3000) || (i.importance != null && !Number.isFinite(Number(i.importance))) || (i.hint != null && !isStr(i.hint, 3000))) throw E.bad('سؤال غير صالح في النموذج.'); else items.add(i.key);
  }
}
function checkEvaluation(e) {
  if (e.scores != null) for (const [k, s] of Object.entries(e.scores)) {
    if (!KEY_RE.test(k) || PROTO_KEYS.has(k) || !isObj(s) || (s.s != null && !isNum(s.s)) || (s.na != null && typeof s.na !== 'boolean') || (s.n != null && typeof s.n !== 'string')) throw E.bad('درجة غير صالحة في التقييم (السؤال ' + k.slice(0, 40) + ').');
    if (s.n != null && s.n.length > 10000) throw E.bad('ملاحظة السؤال ' + k.slice(0, 40) + ' أطول من 10000 حرف؛ اختصرها أو أرفق المستند بدلاً منها.');
  }
  /* نتيجة التقييم تقرؤها شاشات الجميع: محاور في قائمة، لكل محور مفتاح ودرجة وقائمة أسئلة */
  const c = e.computed;
  if (c != null && (!isObj(c) || (c.total != null && !isNum(c.total)) || !Array.isArray(c.axes) || c.axes.length > 40 || !c.axes.every(a => isObj(a) && typeof a.key === 'string' && (a.score == null || isNum(a.score)) && Array.isArray(a.items) && a.items.every(isObj)))) throw E.bad('نتيجة غير صالحة في التقييم.');
}

/* ---------- الخادم ---------- */
export class Server {
  constructor(o) {
    this.store = o.store; this.secret = o.secret || ''; this.seedUsers = Array.isArray(o.seedUsers) ? o.seedUsers : []; this.bank = o.bank;
    this.P = pathsFor(o.prefix || 'ev/'); this.log = o.log || (() => { });
    this.cache = null; this.jobs = []; this.flushing = false; this.reading = null;
    this.limUser = new Limiter(8, 15 * 60e3); this.limIp = new Limiter(40, 15 * 60e3); this.limWrite = new Limiter(LIMITS.writesPer5Min, 5 * 60e3); this.limUpload = new Limiter(LIMITS.uploadsPer10Min, 10 * 60e3);
    this.userGate = new Map(); this.unknownGate = 0; this.lastPrune = '';
    this.seedError = seedProblem(this.seedUsers); if (this.seedError) this.log('SEED_USERS: ' + this.seedError);
    this.ops = { login: this.opLogin, load: this.opLoad, put: this.opPut, batch: this.opBatch, remove: this.opRemove, settings: this.opSettings, audit: this.opAudit, password: this.opPassword, userCreate: this.opUserCreate, userReset: this.opUserReset, export: this.opExport, import: this.opImport };
  }
  configured() { return !!(this.secret && this.secret.length >= 32 && this.store && this.store.ready !== false); }
  get labels() { return (this.bank && this.bank.labels) || {}; }

  /* ---------- المستند وذاكرته المؤقتة ---------- */
  /* «at» في الذاكرة = وقت إرسال القراءة التي جاءت بالنسخة (أو وقت كتابتنا لها)، فلا تُعدّ قراءةٌ أُرسلت قبل بدء طلب ما «حديثةً» له.
     قراءة أُرسلت قبل أن تُخزَّن نسختنا الحالية قد تكون أقدم منها فتُترك؛ وقراءة أُرسلت بعدها هي الحقيقة حتى لو كان رقمها أصغر
     (نسخة احتياطية أُعيدت فوق القاعدة مثلاً). */
  setCache(doc, etag, sent) {
    const c = this.cache;
    if (c && c.doc && doc && c.at >= sent && c.doc.createdAt === doc.createdAt && (c.doc.rev || 0) > (doc.rev || 0)) return c;
    this.cache = { doc, etag, at: sent }; return this.cache;
  }
  /* maxAge: أقصى عمر مقبول للذاكرة (الافتراضي cacheMs). القراءة المشروطة تعيد 304 رخيصة إن لم يتغير شيء. */
  async readDoc(fresh, maxAge) {
    const c = this.cache; const age = maxAge == null ? LIMITS.cacheMs : maxAge;
    if (c && !fresh && Date.now() - c.at < age) return c;
    if (!fresh && this.reading) return this.reading;                       // قراءة جارية تُشارك بين الطلبات المتزامنة
    const p = (async () => {
      const sent = Date.now();
      const r = await this.store.read(this.P.db, c && c.etag ? { ifNoneMatch: c.etag } : {});
      if (r.status === 304) { if (this.cache && this.cache !== c) return this.cache; c.at = Math.max(c.at, sent); this.cache = c; return c; }
      if (r.status === 404) { if (this.cache && this.cache.at >= sent) return this.cache; this.cache = null; return { doc: null, etag: null, at: sent }; }
      return this.setCache(JSON.parse(gunzipSync(r.body).toString('utf8')), r.etag || null, sent);
    })();
    if (!fresh) { this.reading = p; p.finally(() => { if (this.reading === p) this.reading = null; }).catch(() => { }); }
    return p;
  }
  initialDoc() {
    if (this.seedError) throw E.config(this.seedError);
    if (!this.bank || !Array.isArray(this.bank.templates)) throw E.config('تعذر تحميل بنك الأسئلة على الخادم.');
    const now = new Date().toISOString();
    const doc = { v: 1, rev: 0, createdAt: now, updatedAt: now, data: Object.fromEntries(COLLS.map(c => [c, []])), settings: jsonClone(this.bank.defaultSettings), audit: [], auditArchives: [], secrets: {}, logins: {}, counters: {}, lastBackupDay: now.slice(0, 10) };
    for (const t of this.bank.templates) doc.data.templates.push({ id: randomUUID(), role: t.role, name: t.name, version: 1, status: 'active', axes: jsonClone(t.axes), note: 'الإصدار الافتراضي من المنهجية المرجعية', createdAt: now, updatedAt: now });
    for (const s of this.seedUsers) {
      const id = s.id && ID_RE.test(s.id) ? s.id : randomUUID();
      doc.data.users.push({ id, username: String(s.username).trim(), name: String(s.name || s.username), email: String(s.email || ''), role: s.role, active: true, createdAt: now, updatedAt: now });
      doc.secrets[id] = { algo: s.algo, salt: s.salt, iter: s.iter || LIMITS.iter, hash: s.hash, mustChange: true, pwv: 1 };
    }
    doc.audit.push(this.entry(null, 'system_init', 'system', null, { name: 'تهيئة قاعدة البيانات السحابية' }));
    return doc;
  }

  /* ---------- الكتابة: طابور لكل نسخة يجمع الطلبات المتزامنة في كتابة واحدة مشروطة ---------- */
  mutate(fn) { return new Promise((resolve, reject) => { this.jobs.push({ fn, resolve, reject }); if (!this.flushing) this.flush(); }); }
  async flush() {
    this.flushing = true;
    try { while (this.jobs.length) { await new Promise(r => setImmediate(r)); const batch = this.jobs.splice(0); try { await this.commit(batch); } catch (e) { for (const j of batch) j.reject(e); } } }
    finally { this.flushing = false; if (this.jobs.length) this.flush(); }
  }
  async commit(batch) {
    let forceFresh = false, createErr = null; const wid = randomBytes(6).toString('hex');
    const tried = [];   // محاولات فشل ردها وقد تكون كُتبت: { wid, settle, archives, sure } — sure: رُفضت يقيناً (تعارض الشرط)
    for (let attempt = 0; attempt < 8; attempt++) {
      if (!batch.length) return;
      const t0 = Date.now(); const cur = await this.readDoc(forceFresh || attempt > 0); const fresh = cur.at >= t0; const create = !cur.doc;
      /* كل نسخة تحمل معرّفات آخر الكتابات التي بُنيت عليها، فإن وُجد فيها معرّف محاولة سابقة لنا فقد كُتبت وتُعتمد نتيجتها */
      if (tried.length && fresh) {
        const ids = (cur.doc && cur.doc.wids) || [];
        const landed = tried.find(t => ids.includes(t.wid));
        if (landed) { landed.settle(); return; }
        for (let i = tried.length - 1; i >= 0; i--) if (tried[i].sure) { for (const a of tried[i].archives) await this.store.del(a.path).catch(() => { }); tried.splice(i, 1); }
        if (create && createErr) throw createErr;
      }
      if (!create && !cur.etag) { forceFresh = true; continue; }            // لا كتابة غير مشروطة أبداً
      /* كل طلب يُطبَّق على النسخة نفسها بالترتيب. الطلب المرفوض قد يكون عدّل النسخة قبل رفضه،
         لذلك يُستبعد ويُعاد تطبيق الباقين على نسخة نظيفة. والرفض المبني على ذاكرة قديمة يُعاد على أحدث نسخة. */
      let doc, outs, stale = false;
      for (;;) {
        doc = create ? this.initialDoc() : jsonClone(cur.doc); outs = []; let dropped = false;
        for (let i = 0; i < batch.length; i++) {
          let v;
          try { v = await batch[i].fn(doc); }
          catch (e) {
            if (e instanceof HttpError && !fresh && !create) { stale = true; break; }
            if (!(e instanceof HttpError)) this.log('job failed', e && (e.stack || e.message));
            batch[i].reject(e); batch.splice(i, 1); dropped = true; break;
          }
          outs.push(v);
        }
        if (stale || !dropped) break;
        if (!batch.length) return;
      }
      if (stale) { forceFresh = true; continue; }
      const base = cur.doc ? (cur.doc.rev || 0) : 0; const nChanged = outs.filter(v => v !== NOOP).length; const jobs = batch.slice(), res = outs.slice();
      const settle = rev => jobs.forEach((j, i) => j.resolve({ value: res[i] === NOOP ? undefined : res[i], rev, prevRev: base, others: Math.max(0, nChanged - (res[i] === NOOP ? 0 : 1)) }));
      if (!create && !nChanged) { if (!fresh) { forceFresh = true; continue; } settle(base); return; }   // «لا تغيير» لا يُقبل إلا على أحدث نسخة
      const now = new Date().toISOString(); doc.rev = base + 1; doc.updatedAt = now; doc.wid = wid + '.' + attempt; doc.wids = (doc.wids || []).slice(-31).concat([doc.wid]);
      const archives = [];
      while (doc.audit.length > LIMITS.auditKeep) { const chunk = doc.audit.splice(0, LIMITS.auditChunk); const ap = this.P.audit + now.replace(/[^0-9]/g, '').slice(0, 14) + '-' + randomBytes(3).toString('hex') + '.json.gz'; archives.push({ path: ap, body: gzipSync(Buffer.from(JSON.stringify(chunk))) }); (doc.auditArchives = doc.auditArchives || []).push(ap); }
      const today = now.slice(0, 10);
      if (!create && doc.lastBackupDay !== today && await this.backup(today)) doc.lastBackupDay = today;
      try {
        for (const a of archives) await this.store.write(a.path, a.body, { contentType: 'application/gzip' });
        const etag = await this.store.write(this.P.db, gzipSync(Buffer.from(JSON.stringify(doc))), create ? { create: true, contentType: 'application/gzip' } : { ifMatch: cur.etag, contentType: 'application/gzip' });
        this.cache = etag ? { doc, etag, at: Date.now() } : null;
        settle(doc.rev); return;
      } catch (e) {
        const code = e && e.code;
        if (['suspended', 'rate_limited', 'store_denied', 'store_missing'].includes(code)) { for (const a of archives) await this.store.del(a.path).catch(() => { }); throw e; }   // رُفضت الكتابة نفسها
        /* تعارض الشرط: كتب غيرنا قبلنا، إلا إن كانت المكتبة أعادت طلبنا بعد نجاح لم يصل رده. غير ذلك (انقطاع): النتيجة مجهولة،
           فلا يُحذف أرشيفها. في الحالتين تُقرأ أحدث نسخة في المحاولة التالية ويُبحث فيها عن معرّف هذه المحاولة. */
        tried.push({ wid: doc.wid, settle: () => settle(doc.rev), archives, sure: code === 'precondition' || code === 'exists' });
        if (create) createErr = e;
        forceFresh = true;
        await sleep(30 + Math.floor(Math.random() * 90) * (attempt + 1));
      }
    }
    throw E.busy();
  }
  /* نسخة احتياطية يومية قبل أول كتابة في اليوم، ثم حذف ما تجاوز 35 يوماً */
  async backup(day) {
    try { await this.store.copy(this.P.db, this.P.backups + day + '.json.gz'); }
    catch (e) { this.log('backup failed', e && e.message); return false; }
    if (this.lastPrune !== day && this.store.list) {
      this.lastPrune = day; const cutoff = new Date(Date.parse(day) - LIMITS.backupDays * 864e5).toISOString().slice(0, 10);
      try { for (const b of await this.store.list(this.P.backups)) { const d = b.path.slice(this.P.backups.length, this.P.backups.length + 10); if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < cutoff) await this.store.del(b.path).catch(() => { }); } } catch (e) { this.log('backup prune failed', e && e.message); }
    }
    return true;
  }
  entry(user, action, entity, entityId, detail) {
    return { id: randomUUID(), at: new Date().toISOString(), actor: user ? user.id : null, actorName: user ? user.username : 'system', action: String(action || 'event').slice(0, 60), entity: String(entity || '').slice(0, 40), entityId: entityId ? String(entityId).slice(0, 80) : null, detail: isObj(detail) ? { name: String(detail.name == null ? '' : detail.name).slice(0, 200) } : null };
  }
  clientEntry(user, a, entity, entityId) {
    if (!isObj(a)) return null; const action = String(a.action || ''); if (!/^[a-z0-9_]{2,60}$/.test(action)) return null;
    return this.entry(user, action, entity || a.entity, entityId || a.entityId, a.detail);
  }
  writeGate(user) { if (this.limWrite.hit('w:' + user.id)) throw E.tooFast(); }

  /* ---------- الجلسة ---------- */
  async authed(req) {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') || '');
    const t = m && readToken(this.secret, m[1].trim()); if (!t) throw E.auth();
    const t0 = Date.now(); let cur = await this.readDoc(false);
    const ok = c => { if (!c.doc) throw E.auth(); return this.check(c.doc, t); };
    try { return { user: ok(cur), doc: cur.doc, token: t, fresh: cur.at >= t0 }; }
    catch (e) { if (!(e instanceof HttpError) || e.status !== 401 || cur.at >= t0) throw e; cur = await this.readDoc(true); return { user: ok(cur), doc: cur.doc, token: t, fresh: true }; }
  }
  /* ما يجب أن يرى آخر ما حُفظ (تحميل البيانات والمرفقات والتصدير): طلب مشروط رخيص يعيد 304 إن لم يتغير شيء */
  async freshAuthed(req) { const a = await this.authed(req); if (a.fresh) return a; const cur = await this.readDoc(true); if (!cur.doc) throw E.auth(); return { user: this.check(cur.doc, a.token), doc: cur.doc, token: a.token, fresh: true }; }
  check(doc, t) {
    const user = doc.data.users.find(u => u.id === t.u); const sec = doc.secrets[t.u];
    if (!user || !user.active || !sec || (sec.pwv || 0) !== t.v) throw E.auth();
    return user;
  }

  /* ---------- ما يراه المستخدم ---------- */
  project(doc, user) {
    const out = {}; for (const c of COLLS) out[c] = doc.data[c];
    const logins = doc.logins || {};
    out.users = doc.data.users.map(u => { const s = doc.secrets[u.id] || {}; const x = Object.assign({}, u, { mustChange: !!s.mustChange, lastLoginAt: logins[u.id] || null }); delete x.hash; delete x.salt; delete x.password; delete x.pwv; return x; });
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
  staleConsolidation(doc, cy) {
    const c = cy.consolidated; const excl = new Set(cy.excluded || []);
    const cur = doc.data.evaluations.filter(e => e.cycleId === cy.id && e.status === 'submitted' && !excl.has(e.id));
    const got = Array.isArray(c.evaluationIds) ? c.evaluationIds.slice().sort() : null; const inputs = isObj(c.inputs) ? c.inputs : {};
    const method = cy.method || 'mean', w = o => Object.keys(isObj(o) ? o : {}).sort().map(k => [k, o[k]]);
    if ((c.method || 'mean') !== method || (method === 'weighted' && !same(w(c.evalWeights), w(cy.evalWeights)))) return true;
    return !got || !same(cur.map(e => e.id).sort(), got) || (c.count != null && c.count !== cur.length) || cur.some(e => inputs[e.id] !== (e.updatedAt || null));
  }
  /* دورة المرفق (من سجله أو من تقييمه) ومدى قفلها */
  attLock(doc, a) {
    const ev = a.evaluationId ? doc.data.evaluations.find(e => e.id === a.evaluationId) : null;
    const cy = doc.data.cycles.find(c => c.id === (a.cycleId || (ev && ev.cycleId)));
    return { ev, locked: !!cy && (cy.status === 'approved' || cy.status === 'closed') };
  }
  onTeam(doc, user, contractId) { const k = doc.data.contracts.find(c => c.id === contractId); return !!k && (k.leadEngineer === user.id || (k.evaluators || []).includes(user.id)); }

  /* ---------- قواعد الكتابة ---------- */
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
        const types = Object.keys(this.labels.cycleType || {}); if (types.length && !types.includes(rec.type)) throw E.bad('نوع دورة غير معروف.');
        if (rec.method != null && !['mean', 'weighted'].includes(rec.method)) throw E.bad('طريقة توحيد غير معروفة.');
        if (rec.evalWeights != null && !(isObj(rec.evalWeights) && Object.entries(rec.evalWeights).every(([u, w]) => ID_RE.test(u) && isNum(w) && w >= 0 && w <= 100))) throw E.bad('أوزان المقيّمين غير صالحة.');
        if (rec.excluded != null && !(Array.isArray(rec.excluded) && rec.excluded.every(x => typeof x === 'string' && ID_RE.test(x)))) throw E.bad('قائمة الاستبعاد غير صالحة.');
        if (rec.label != null && !isStr(rec.label, 200)) throw E.bad('تسمية الدورة طويلة جداً.');
        if (!Object.keys(this.labels.cycleStatus || { open: 1, consolidated: 1, approved: 1, closed: 1 }).includes(rec.status)) throw E.bad('حالة دورة غير معروفة.');
        checkConsolidated(rec.consolidated, Object.keys(this.labels.rating || {}).concat(['none', 'negative']));
        if (rec.objection != null && !isObj(rec.objection)) throw E.bad('بيانات التظلم غير صالحة.');
        /* النتيجة الموحدة تُحسب من التقييمات المقدَّمة الحالية غير المستبعدة كلها، وبصيغتها الحالية (وقت آخر تعديل لكل تقييم):
           تُفحص عند التوحيد وعند الاعتماد، فلا يُحفظ ولا يُعتمد توحيد قديم (بعد إعادة تقييم وتقديمه مثلاً) */
        const entering = s => rec.status === s && (!prev || prev.status !== s);
        if (rec.consolidated && (!same(prev ? prev.consolidated : null, rec.consolidated) || entering('approved')) && this.staleConsolidation(doc, rec)) throw E.staleInputs();
        if (entering('closed') && me.role !== 'admin') throw E.forbid('إقفال الدورة دون اعتماد لمدير النظام فقط.');
        if (!prev) {
          if (r < 2) {
            if (k.leadEngineer !== me.id) throw E.forbid('فتح دورات التقييم لرئيس القسم أو المهندس المسؤول عن العقد.');
            const allowed = new Set(['id', 'contractId', 'type', 'label', 'dueDate', 'status', 'method', 'excluded', 'evalWeights', 'createdAt', 'updatedAt', 'createdBy']);
            for (const f of Object.keys(rec)) if (!allowed.has(f)) throw E.bad('حقول غير مسموحة في دورة جديدة.');
            if ((rec.excluded || []).length || Object.keys(rec.evalWeights || {}).length || (rec.method || 'mean') !== 'mean') throw E.bad('تُفتح الدورة الجديدة بإعداداتها الافتراضية.');
          }
          if (rec.status !== 'open') throw E.bad('تُفتح الدورة الجديدة بحالة «مفتوحة».');
          return;
        }
        if (r < 2) throw E.forbid('تعديل الدورات لرئيس القسم فما فوق.');
        if (prev.contractId !== rec.contractId) throw E.bad('لا يمكن نقل الدورة إلى عقد آخر.');
        const approving = (rec.status === 'approved' && prev.status !== 'approved') || ['approvedBy', 'approvedAt', 'consequence', 'approvalNote'].some(x => !same(prev[x], rec[x]));
        if (approving && r < 3) throw E.forbid('اعتماد النتيجة لمدير الإدارة أو مساعده أو رئيس قسم تنمية الوقف.');
        const locked = s => s === 'approved' || s === 'closed';
        if (locked(prev.status) && !locked(rec.status) && me.role !== 'admin') throw E.forbid('إعادة فتح دورة معتمدة لمدير النظام فقط.');
        /* الدورة المعتمدة مقفلة: لا يتغير فيها لغير مدير النظام إلا التظلم (يسجله رئيس القسم ويقرر فيه المعتمد) */
        if (locked(prev.status) && me.role !== 'admin') {
          for (const f of new Set([...Object.keys(prev), ...Object.keys(rec)])) if (f !== 'objection' && f !== 'updatedAt' && !same(prev[f], rec[f]) && !((f === 'createdAt' || f === 'createdBy') && prev[f] == null)) throw E.forbid('الدورة معتمدة ومقفلة؛ لا يُعدَّل فيها إلا التظلم، وإعادة فتحها لمدير النظام.');
        }
        const po = prev.objection || {}, ro = rec.objection || {};
        if (['outcome', 'decision', 'decidedBy', 'decidedAt'].some(x => !same(po[x], ro[x])) && r < 3) throw E.forbid('القرار في التظلم لمدير الإدارة أو مساعده أو رئيس قسم تنمية الوقف.');
        return;
      }
      case 'evaluations': {
        if (!['draft', 'submitted', 'returned'].includes(rec.status)) throw E.bad('حالة تقييم غير معروفة.');
        const own = rec.evaluatorId === me.id && (!prev || prev.evaluatorId === me.id);
        if (own) {
          const cy = cycle(rec.cycleId); if (!cy) throw E.bad('الدورة غير موجودة.');
          if (!prev && cy.status !== 'open') throw E.forbid('الدورة غير مفتوحة للتقييم.');
          if (cy.status === 'approved' || cy.status === 'closed') throw E.forbid('الدورة معتمدة ومقفلة، ولا تُعدَّل تقييماتها.');
          if (prev && prev.status === 'submitted') throw E.forbid('قُدِّم هذا التقييم، ولا يُعدَّل إلا بعد إعادته من المراجع.');
          if (rec.status === 'returned' && (!prev || prev.status !== 'returned')) throw E.bad();
          if (prev && (prev.cycleId !== rec.cycleId || prev.contractId !== rec.contractId)) throw E.bad();
          if (!prev) {
            if (cy.contractId !== rec.contractId) throw E.bad();
            if (r < 2 && !this.onTeam(doc, me, rec.contractId)) throw E.forbid('لست ضمن فريق تقييم هذا العقد.');
            if (doc.data.evaluations.some(e => e.cycleId === rec.cycleId && e.evaluatorId === me.id)) throw E.bad('لديك تقييم في هذه الدورة.');
          }
          return;
        }
        if (r < 2) throw E.forbid('لا يمكنك تعديل تقييم زميل.');
        if (!prev) throw E.forbid('لا يمكن إنشاء تقييم باسم مقيّم آخر.');
        { const cy = cycle(prev.cycleId); if (cy && (cy.status === 'approved' || cy.status === 'closed') && me.role !== 'admin') throw E.forbid('الدورة معتمدة ومقفلة، ولا تُعاد تقييماتها.'); }
        const allowed = new Set(['status', 'returnedNote', 'returnedBy', 'returnedAt', 'updatedAt']);
        for (const k2 of new Set([...Object.keys(prev), ...Object.keys(rec)])) if (!allowed.has(k2) && !same(prev[k2], rec[k2])) throw E.forbid('لا يجوز للمراجع تعديل تقييم زميل؛ أعِده إلى صاحبه مع الملاحظة.');
        if (rec.status !== 'returned' || prev.status !== 'submitted') throw E.bad('يُعاد التقييم المقدَّم فقط.');
        return;
      }
      case 'attachments': {
        if (me.role !== 'admin' && (this.attLock(doc, rec).locked || (prev && this.attLock(doc, prev).locked))) throw E.forbid('مستندات الدورة المعتمدة مقفلة.');
        if (prev) {
          if (r < 2) throw E.forbid();
          if (rec.path !== prev.path || rec.contractId !== prev.contractId || rec.uploadedBy !== prev.uploadedBy) throw E.bad('لا يُغيَّر ملف المرفق أو عقده أو رافعه.');
          return;
        }
        if (rec.uploadedBy !== me.id) throw E.bad();
        if (!isStr(rec.path, 400) || !FILE_RE.test(rec.path) || rec.path.includes('..') || rec.path.split('/')[1] !== rec.contractId) throw E.bad('مسار مرفق غير صالح.');
        if (!contract(rec.contractId)) throw E.bad('العقد غير موجود.');
        /* سجل مرفق لا يُنشأ لملف موجود (ولا لإخطار عقد موقّع)، وإلا صار وسيلة لحذف ملفات الآخرين */
        if (doc.data.attachments.some(a => a.path === rec.path) || doc.data.contracts.some(c => c.noticeFile === rec.path)) throw E.bad('المرفق مسجل من قبل.');
        if (r < 2 && !this.onTeam(doc, me, rec.contractId)) throw E.forbid('لست ضمن فريق تقييم هذا العقد.');
        if (rec.evaluationId) { const e = doc.data.evaluations.find(x => x.id === rec.evaluationId); if (!e) throw E.bad('التقييم غير موجود.'); if (e.contractId !== rec.contractId) throw E.bad('التقييم لا يتبع هذا العقد.'); if (e.evaluatorId !== me.id && r < 2) throw E.forbid(); if (r < 2 && e.status === 'submitted') throw E.forbid('قُدِّم التقييم، فلا تُضاف إليه مستندات إلا بعد إعادته.'); }
        else if (r < 2) throw E.forbid();
        return;
      }
    }
    throw E.bad();
  }
  authorizeRemove(doc, me, coll, prev) {
    const r = rankOf(me);
    if (r < 1) throw E.forbid('حساب المتابعة للاطلاع فقط ولا يملك صلاحية التعديل.');
    switch (coll) {
      case 'attachments': {
        if (prev.uploadedBy !== me.id && r < 2) throw E.forbid();
        const { ev, locked } = this.attLock(doc, prev);
        if (locked && me.role !== 'admin') throw E.forbid('مستندات الدورة المعتمدة مقفلة.');
        if (r < 2 && ev && ev.status === 'submitted') throw E.forbid('قُدِّم التقييم، فلا تُحذف مستنداته إلا بعد إعادته.');
        return;
      }
      case 'cycles': if (r < 2) throw E.forbid(); if (prev.status !== 'open' || doc.data.evaluations.some(e => e.cycleId === prev.id)) throw E.bad('لا تُحذف إلا دورة مفتوحة بلا تقييمات.'); return;
      case 'companies': case 'projects': case 'contracts': case 'templates': case 'letters': case 'evaluations': if (me.role !== 'admin') throw E.forbid('الحذف لمدير النظام فقط.'); return;
    }
    throw E.forbid('هذا السجل لا يُحذف.');
  }
  /* أرقام الخطابات الرسمية تُخصَّص هنا داخل الكتابة الذرية نفسها، فلا يتكرر رقم حتى لو أصدر مديران خطابين في اللحظة نفسها */
  allocRef(doc, rec) {
    const y = /^\d{4}/.test(String(rec.issuedAt || '')) ? String(rec.issuedAt).slice(0, 4) : String(new Date().getFullYear());
    doc.counters = doc.counters || {}; const key = 'letters:' + y;
    let max = Number.isInteger(doc.counters[key]) ? doc.counters[key] : 0;               // العداد، ولا يقل عن أكبر رقم مسجل فعلاً (خطابات مستوردة مثلاً)
    for (const l of doc.data.letters) if (String(l.issuedAt || '').startsWith(y)) { const m = /(\d+)\s*$/.exec(String(l.refNo || '')); if (m) max = Math.max(max, Number(m[1])); }
    doc.counters[key] = max + 1;
    return `${(doc.settings && doc.settings.letterRefPrefix) || ''}${y}/${String(doc.counters[key]).padStart(3, '0')}`;
  }

  /* ---------- نقاط الدخول ---------- */
  health() { return respond(200, Object.assign({ ok: true, app: 'sijil-alada', mode: 'cloud', version: '1.1', configured: this.configured() }, this.seedError ? { seedWarning: 'قائمة المستخدمين الأولية SEED_USERS غير صالحة؛ التفاصيل في سجلات الخادم.' } : {})); }
  mapError(e) {
    if (e instanceof HttpError) return e;
    if (e && e.code === 'suspended') return new HttpError(503, 'التخزين السحابي موقوف (غالباً لتجاوز حدود الخطة هذا الشهر). راجع مدير النظام: لوحة Vercel ← Storage.', 'storage_suspended');
    if (e && (e.code === 'rate_limited' || e.code === 'unavailable')) return new HttpError(503, 'التخزين السحابي مشغول، أعد المحاولة بعد دقيقة.', 'storage_busy');
    if (e && e.code === 'store_denied') return new HttpError(503, 'تعذر الوصول إلى التخزين السحابي: المتجر موقوف أو مفتاحه غير صالح. راجع مدير النظام.', 'storage_denied');
    if (e && e.code === 'store_missing') return E.config('متجر البيانات غير موجود أو غير مربوط بالمشروع.');
    return null;
  }
  errorResponse(e, req) {
    const h = this.mapError(e);
    if (h) return respond(h.status, Object.assign({ error: h.message, code: h.code }, h.extra || {}), req);
    this.log('server error', e && (e.stack || e.message));
    return respond(500, { error: 'حدث خطأ في الخادم. أعد المحاولة، وإن تكرر فأبلغ مدير النظام.', code: 'server_error' }, req);
  }
  async rpc(req) {
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed', 'method');
      if (!this.configured()) throw E.config('الخادم غير مهيأ بعد (مفتاح الجلسات أو التخزين).');
      const ct = lc(req.headers.get('content-type'));
      if (Number(req.headers.get('content-length') || 0) > LIMITS.body) throw E.large();
      let body;
      if (ct.startsWith('application/json')) {
        const raw = Buffer.from(await req.arrayBuffer()); if (raw.length > LIMITS.body) throw E.large();
        try { body = JSON.parse(raw.toString('utf8') || '{}'); } catch (e) { throw E.bad(); }
      } else if (ct.startsWith('application/gzip')) {
        const a = await this.authed(req); if (a.user.role !== 'admin') throw E.forbid('الاستيراد لمدير النظام فقط.');   // يُفك الضغط بعد التحقق من المدير فقط
        const raw = Buffer.from(await req.arrayBuffer()); if (raw.length > LIMITS.body) throw E.large();
        try { body = JSON.parse(gunzipSync(raw, { maxOutputLength: LIMITS.importRaw }).toString('utf8')); } catch (e) { throw E.large('ملف النسخة تالف أو أكبر من المسموح.'); }
        if (!isObj(body) || body.op !== 'import') throw E.bad();
      } else throw E.media();
      if (!isObj(body) || typeof body.op !== 'string' || !Object.prototype.hasOwnProperty.call(this.ops, body.op)) throw E.bad('عملية غير معروفة.');
      return respond(200, await this.ops[body.op].call(this, body, req), req);
    } catch (e) { return this.errorResponse(e, req); }
  }

  async opLogin(b, req) {
    const username = lc(String(b.username || '').trim()); const pw = typeof b.password === 'string' ? b.password : '';
    if (!username || !pw || username.length > 80 || pw.length > 200) throw E.bad('أدخل اسم المستخدم وكلمة المرور.');
    const ip = ipKey(req);
    if (this.limIp.blocked(ip) || this.limUser.blocked(username)) throw E.limited();
    /* الذاكرة أولاً أياً كان عمرها، فمحاولات الدخول المجهولة لا تستهلك عمليات التخزين؛ والقراءة الجديدة عند الحاجة فقط */
    const t0 = Date.now(); let cur = await this.readDoc(false, Infinity);
    if (!cur.doc) { await this.mutate(() => null); cur = await this.readDoc(false, Infinity); }
    const attempt = async d => { const u = d ? d.data.users.find(x => lc(x.username) === username) : null; const s = u && d.secrets[u.id]; return { u, s, ok: s ? await verifyPassword(s, pw) : (await hashPassword(pw, '0'.repeat(32)), false) }; };
    let res = await attempt(cur.doc);
    if (res.ok && cur.at < t0) { cur = await this.readDoc(true); res = await attempt(cur.doc); }           // نجاح على نسخة مؤقتة: يُؤكَّد على أحدث نسخة
    else if (!res.ok && cur.at < t0 && this.loginRefresh(username, !!res.u)) { cur = await this.readDoc(true); res = await attempt(cur.doc); }   // مستخدم أُضيف أو كلمة أُعيدت للتو من نسخة أخرى — بقدر محدود
    if (!cur.doc) throw E.auth();
    const { u: user, s: sec, ok } = res;
    if (!ok || !user.active) { this.limIp.hit(ip); this.limUser.hit(username); throw new HttpError(403, ok && !user.active ? 'هذا الحساب معطَّل. راجع مدير النظام.' : 'اسم المستخدم أو كلمة المرور غير صحيحة.', 'bad_credentials'); }
    this.limUser.ok(username);
    const at = new Date().toISOString(); const last = (cur.doc.logins || {})[user.id]; const upgrade = sec.algo === 'sha256' ? await hashPassword(pw) : null;
    if (upgrade || !last || Date.now() - Date.parse(last) > LIMITS.loginRecordMs) {
      await this.mutate(d => {
        const u = d.data.users.find(x => x.id === user.id); const s = d.secrets[user.id];
        if (!u || !s || (s.pwv || 0) !== (sec.pwv || 0) || s.hash !== sec.hash) return NOOP;  // تغيّرت كلمة المرور في هذه الأثناء: لا تسجيل
        if (upgrade && s.algo === 'sha256') Object.assign(s, upgrade);
        (d.logins = d.logins || {})[u.id] = at; d.audit.push(this.entry(u, 'login', 'users', u.id));
      });
      cur = await this.readDoc(false);
    }
    /* الرمز يُوقَّع من كلمة المرور التي تحققنا منها نفسها؛ إن أُعيدت أو غُيّرت أو عُطّل الحساب أثناء الدخول يُرفض الدخول */
    const doc = cur.doc; const s2 = doc.secrets[user.id]; const me = doc.data.users.find(x => x.id === user.id);
    if (!me || !s2 || !me.active || (s2.pwv || 0) !== (sec.pwv || 0)) throw new HttpError(403, 'اسم المستخدم أو كلمة المرور غير صحيحة.', 'bad_credentials');
    return { token: signToken(this.secret, user.id, sec.pwv || 0), me: user.id, mustChange: !!sec.mustChange, data: this.project(doc, me), rev: doc.rev };
  }
  loginRefresh(username, known) {
    const now = Date.now();
    if (known) { if (now - (this.userGate.get(username) || 0) < 5 * 60e3) return false; this.userGate.set(username, now); if (this.userGate.size > 5000) this.userGate.clear(); return true; }
    if (now - this.unknownGate < 60e3) return false; this.unknownGate = now; return true;
  }
  async opLoad(b, req) { const { user, doc } = await this.freshAuthed(req); return { me: user.id, data: this.project(doc, user), rev: doc.rev }; }
  /* التحقق من طلب حفظ قبل إدخاله الطابور */
  putItem(x) {
    if (!isObj(x) || !COLLS.includes(x.coll)) throw E.bad('مجموعة غير معروفة.');
    if (!isObj(x.rec) || typeof x.rec.id !== 'string' || !ID_RE.test(x.rec.id)) throw E.bad('سجل غير صالح.');
    if (Buffer.byteLength(JSON.stringify(x.rec)) > LIMITS.record) throw E.large('السجل أكبر من الحد المسموح.');
    const rec = sanitize(x.coll, x.rec); checkRecord(x.coll, rec);
    return { coll: x.coll, rec, base: typeof x.base === 'string' ? x.base : null, audit: x.audit };
  }
  /* تطبيق حفظ واحد على النسخة داخل الكتابة الذرية؛ يعيد ما يحدده الخادم في السجل (رقم الخطاب) */
  applyPut(doc, me, x) {
    const arr = doc.data[x.coll]; const i = arr.findIndex(r => r.id === x.rec.id); const prev = i >= 0 ? arr[i] : null;
    this.authorizePut(doc, me, x.coll, x.rec, prev);
    if (prev && (prev.updatedAt || null) !== x.base) throw E.conflict(prev.updatedAt || null);
    if (!prev && x.base) throw E.deleted();
    const out = Object.assign({}, x.rec);
    if (x.coll === 'users') Object.assign(out, { username: prev.username, createdAt: prev.createdAt });
    if (x.coll === 'letters') out.refNo = prev ? prev.refNo : this.allocRef(doc, out);
    if (i >= 0) arr[i] = out; else arr.push(out);
    const a = this.clientEntry(me, x.audit, x.coll, x.rec.id); if (a) doc.audit.push(a);
    return x.coll === 'letters' ? { refNo: out.refNo } : null;
  }
  async opPut(b, req) {
    const { token, user } = await this.authed(req);
    if (rankOf(user) < 1) throw E.forbid('حساب المتابعة للاطلاع فقط ولا يملك صلاحية التعديل.');
    const x = this.putItem(b);
    this.writeGate(user);
    const r = await this.mutate(doc => this.applyPut(doc, this.check(doc, token), x));
    return { ok: true, rev: r.rev, prevRev: r.prevRev, others: r.others, patch: r.value || null };
  }
  /* عدة سجلات في كتابة واحدة: تُحفظ كلها أو لا يُحفظ شيء (الاعتماد مع حالة الشركة، إصدار الخطاب مع العقد…) */
  async opBatch(b, req) {
    const { token, user } = await this.authed(req);
    if (rankOf(user) < 1) throw E.forbid('حساب المتابعة للاطلاع فقط ولا يملك صلاحية التعديل.');
    if (!Array.isArray(b.items) || !b.items.length || b.items.length > 10) throw E.bad('طلب غير صالح.');
    const items = b.items.map(x => this.putItem(x));
    if (new Set(items.map(x => x.coll + '/' + x.rec.id)).size !== items.length) throw E.bad('سجل مكرر في الطلب نفسه.');
    this.writeGate(user);
    const r = await this.mutate(doc => { const me = this.check(doc, token); return items.map(x => this.applyPut(doc, me, x)); });
    return { ok: true, rev: r.rev, prevRev: r.prevRev, others: r.others, patches: r.value || [] };
  }
  async opRemove(b, req) {
    const { token, user } = await this.authed(req);
    if (rankOf(user) < 1) throw E.forbid('حساب المتابعة للاطلاع فقط ولا يملك صلاحية التعديل.');
    if (!COLLS.includes(b.coll) || typeof b.id !== 'string') throw E.bad();
    this.writeGate(user);
    let removed = null;
    const r = await this.mutate(doc => {
      removed = null; const me = this.check(doc, token); const prev = doc.data[b.coll].find(x => x.id === b.id); if (!prev) return NOOP;
      this.authorizeRemove(doc, me, b.coll, prev);
      doc.data[b.coll] = doc.data[b.coll].filter(x => x.id !== b.id);
      const a = this.clientEntry(me, b.audit, b.coll, b.id); if (a) doc.audit.push(a);
      removed = doc.data.contracts.some(c => c.noticeFile === prev.path) ? null : prev;     // ملف إخطار عقد لا يُحذف مع سجل مرفق
    });
    if (b.coll === 'attachments' && removed && typeof removed.path === 'string' && FILE_RE.test(removed.path)) await this.store.del(this.P.files + sha256hex(removed.path)).catch(e => this.log('file delete failed', e && e.message));   // حذف السجل يحذف ملفه أيضاً
    return { ok: true, rev: r.rev, prevRev: r.prevRev, others: r.others };
  }
  async opSettings(b, req) {
    const { token, user } = await this.authed(req);
    if (user.role !== 'admin') throw E.forbid('الإعدادات لمدير النظام فقط.');
    if (!isObj(b.settings) || Buffer.byteLength(JSON.stringify(b.settings)) > LIMITS.settings) throw E.bad('إعدادات غير صالحة.');
    deepCheck(b.settings, 0);
    this.writeGate(user);
    const r = await this.mutate(doc => { const me = this.check(doc, token); if (me.role !== 'admin') throw E.forbid('الإعدادات لمدير النظام فقط.'); doc.settings = jsonClone(b.settings); doc.audit.push(this.entry(me, 'settings_update', 'settings', null)); });
    return { ok: true, rev: r.rev, prevRev: r.prevRev, others: r.others };
  }
  async opAudit(b, req) {
    const { user, token } = await this.authed(req); const action = isObj(b.entry) ? String(b.entry.action || '') : '';
    if (!CLIENT_AUDIT.has(action)) return { ok: true };
    const a = this.entry(user, action, 'users', user.id);                                    // نص السجل من الخادم وحده، لا من المتصفح
    this.writeGate(user);
    await this.mutate(d => { this.check(d, token); d.audit.push(a); });
    return { ok: true };
  }
  async opPassword(b, req) {
    const { user, token } = await this.authed(req);
    const next = typeof b.next === 'string' ? b.next : ''; checkNewPassword(next, user);
    const { doc } = await this.readDoc(true); const sec = doc.secrets[user.id]; if (!sec) throw E.auth();
    const key = lc(user.username);
    if (!sec.mustChange) {
      if (this.limUser.blocked(key)) throw E.limited();
      if (typeof b.current !== 'string' || !(await verifyPassword(sec, b.current))) { this.limUser.hit(key); throw new HttpError(403, 'كلمة المرور الحالية غير صحيحة.', 'bad_credentials'); }
    }
    if (await verifyPassword(sec, next)) throw E.bad('اختر كلمة مرور مختلفة عن الحالية.');
    this.writeGate(user);
    const h = await hashPassword(next); let pwv;
    const r = await this.mutate(d => { const me = this.check(d, token); const s = d.secrets[me.id] || {}; pwv = (s.pwv || 0) + 1; d.secrets[me.id] = Object.assign({}, s, h, { mustChange: false, pwv, changedAt: new Date().toISOString() }); d.audit.push(this.entry(me, 'password_change', 'users', me.id)); });
    return { ok: true, token: signToken(this.secret, user.id, pwv), rev: r.rev, prevRev: r.prevRev, others: r.others };
  }
  async opUserCreate(b, req) {
    const { token, user } = await this.authed(req); if (user.role !== 'admin') throw E.forbid('إدارة المستخدمين لمدير النظام فقط.');
    const u = isObj(b.user) ? b.user : {};
    const username = String(u.username || '').trim(); const name = String(u.name || '').trim(); const email = String(u.email || '').trim(); const role = String(u.role || 'engineer');
    if (!USER_RE.test(username)) throw E.bad('اسم المستخدم: حروف إنجليزية وأرقام ونقطة وشرطة فقط.');
    if (!name || name.length > 120 || email.length > 120 || !ROLES.includes(role)) throw E.bad('أكمل بيانات المستخدم.');
    this.writeGate(user);
    const temp = tempPassword(); const h = await hashPassword(temp); const id = randomUUID(); let created;
    const r = await this.mutate(doc => {
      const me = this.check(doc, token); if (me.role !== 'admin') throw E.forbid('إدارة المستخدمين لمدير النظام فقط.');
      if (doc.data.users.some(x => lc(x.username) === lc(username))) throw E.bad('اسم المستخدم مستخدم من قبل.');
      const now = new Date().toISOString(); created = { id, username, name, email, role, active: true, createdAt: now, updatedAt: now, createdBy: me.id };
      doc.data.users.push(created); doc.secrets[id] = Object.assign({}, h, { mustChange: true, pwv: 1 }); doc.audit.push(this.entry(me, 'user_create', 'users', id, { name }));
    });
    return { ok: true, user: Object.assign({}, created, { mustChange: true, lastLoginAt: null }), tempPassword: temp, rev: r.rev, prevRev: r.prevRev, others: r.others };
  }
  async opUserReset(b, req) {
    const { token, user } = await this.authed(req); if (user.role !== 'admin') throw E.forbid('إدارة المستخدمين لمدير النظام فقط.');
    this.writeGate(user);
    const temp = tempPassword(); const h = await hashPassword(temp);
    const r = await this.mutate(doc => {
      const me = this.check(doc, token); if (me.role !== 'admin') throw E.forbid('إدارة المستخدمين لمدير النظام فقط.');
      const u = doc.data.users.find(x => x.id === b.id); if (!u) throw E.notFound('المستخدم غير موجود.');
      if (u.id === me.id) throw E.bad('غيّر كلمة مرورك من صفحة «كلمة المرور».');
      const s = doc.secrets[u.id] || {}; doc.secrets[u.id] = Object.assign({}, s, h, { mustChange: true, pwv: (s.pwv || 0) + 1 }); doc.audit.push(this.entry(me, 'user_password_reset', 'users', u.id, { name: u.name }));
    });
    return { ok: true, tempPassword: temp, rev: r.rev, prevRev: r.prevRev, others: r.others };
  }
  async readArchives(doc) {
    const out = [];
    for (const p of (doc.auditArchives || [])) { try { const r = await this.store.read(p, {}); if (r.status === 200) out.push(...JSON.parse(gunzipSync(r.body).toString('utf8'))); } catch (e) { this.log('archive read failed', p); } }
    return out;
  }
  async opExport(b, req) {
    const { user, doc, token } = await this.freshAuthed(req); const exportedAt = new Date().toISOString();
    const full = user.role === 'admin';
    const out = full ? Object.assign({ format: 'sijil-alada-cloud', scope: 'full', version: 1, exportedAt }, jsonClone(doc.data), { settings: doc.settings, audit: (await this.readArchives(doc)).concat(doc.audit), credentials: doc.secrets, logins: doc.logins, counters: doc.counters || {} })
      : Object.assign({ format: 'sijil-alada-cloud', scope: 'user', exportedAt }, this.project(doc, user));
    await this.mutate(d => { const me = this.check(d, token); d.audit.push(this.entry(me, 'backup_export', 'system', null, { name: full ? 'نسخة كاملة' : 'نسخة المستخدم' })); });
    return { json: JSON.stringify(out) };
  }
  async opImport(b, req) {
    const { token, user, doc: doc0 } = await this.freshAuthed(req); if (user.role !== 'admin') throw E.forbid('الاستيراد لمدير النظام فقط.');
    const P = b.payload; if (!isObj(P)) throw E.bad('ملف النسخة غير صالح.');
    const fromCloud = P.format === 'sijil-alada-cloud' && P.scope === 'full';
    if (P.format === 'sijil-alada-cloud' && P.scope !== 'full') throw E.bad('هذه نسخة مستخدم وليست نسخة كاملة؛ صدّر النسخة من حساب مدير النظام.');
    const problems = []; const valid = (coll, r0) => { try { if (!isObj(r0) || typeof r0.id !== 'string' || !ID_RE.test(r0.id) || Buffer.byteLength(JSON.stringify(r0)) > LIMITS.record) throw E.bad('سجل غير صالح.'); checkRecord(coll, coll === 'users' ? sanitize('users', r0) : r0); return true; } catch (e) { if (problems.length < 20) problems.push(coll + ' ' + String(isObj(r0) ? r0.id : '?').slice(0, 40) + ': ' + (e instanceof HttpError ? e.message : 'غير صالح')); return false; } };
    const incoming = Array.isArray(P.users) ? P.users.filter(u => isObj(u) && USER_RE.test(String(u.username || '').trim()) && valid('users', u)) : [];
    const names = new Map(); for (const u of incoming) { const k = lc(String(u.username).trim()); if (names.has(k)) throw E.bad('اسم مستخدم مكرر في النسخة: ' + u.username); names.set(k, u); }
    const temps = new Map(); for (const u of incoming) temps.set(u.id, tempPassword());
    const tempHashes = new Map(); for (const [id, pw] of temps) tempHashes.set(id, await hashPassword(pw));
    const archivedIds = new Set((await this.readArchives(doc0)).map(a => a.id));
    let settingsOk = isObj(P.settings) && Buffer.byteLength(JSON.stringify(P.settings)) <= LIMITS.settings;
    if (settingsOk) try { deepCheck(P.settings, 0); } catch (e) { settingsOk = false; problems.push('settings: ' + e.message); }
    const report = { counts: {}, tempPasswords: [], skipped: 0, files: 0, problems }; let meNewId = null;
    const r = await this.mutate(doc => {
      const me = this.check(doc, token); if (me.role !== 'admin') throw E.forbid('الاستيراد لمدير النظام فقط.');
      /* تخطيط كامل قبل أي تعديل: أي تعارض يرفض الاستيراد كله دون أن يمس البيانات */
      const plan = [];
      for (const iu of incoming) {
        const u = sanitize('users', iu); u.username = String(u.username).trim(); if (!ROLES.includes(u.role)) u.role = 'engineer'; u.active = u.active !== false;
        const byId = doc.data.users.find(x => x.id === u.id); const byName = doc.data.users.find(x => lc(x.username) === lc(u.username));
        if (byId && byName && byId.id !== byName.id) throw E.bad(`تعارض في المستخدم ${u.username}: المعرّف واسم المستخدم يشيران إلى حسابين مختلفين.`);
        if (byId && lc(byId.username) !== lc(u.username) && doc.data.users.some(x => x.id !== byId.id && lc(x.username) === lc(u.username))) throw E.bad('تعارض في أسماء المستخدمين: ' + u.username);
        if (lc(u.username) === lc(me.username)) { u.role = 'admin'; u.active = true; }                 // مدير النظام الذي يستورد يبقى مديراً نشطاً
        plan.push({ iu, u, target: byId || byName || null });
      }
      const remap = {}; for (const p of plan) if (p.target && p.target.id !== p.u.id) remap[p.target.id] = p.u.id;
      report.counts = {}; report.tempPasswords = []; report.skipped = (Array.isArray(P.users) ? P.users.length : 0) - incoming.length; meNewId = remap[me.id] || null;
      for (const p of plan) {
        const { iu, u, target } = p; const oldSec = target ? doc.secrets[target.id] : null;
        let inc = fromCloud ? (P.credentials && P.credentials[iu.id]) : (iu.hash && iu.salt ? { algo: 'sha256', salt: iu.salt, hash: iu.hash, mustChange: !!iu.mustChange } : null);
        if (inc && (!isObj(inc) || !inc.hash || !inc.salt || isLegacyDefault(inc))) inc = null;
        let sec;
        if (oldSec && !oldSec.mustChange) sec = oldSec;                                        // من غيّر كلمة مروره على النسخة السحابية يحتفظ بها
        else if (inc) sec = { algo: inc.algo === 'sha256' ? 'sha256' : 'pbkdf2', salt: inc.salt, iter: inc.iter || LIMITS.iter, hash: inc.hash, mustChange: !!inc.mustChange, pwv: ((oldSec && oldSec.pwv) || 0) + 1 };
        else if (oldSec) sec = oldSec;                                                         // يبقى على كلمة المرور المؤقتة التي أُرسلت له
        else { sec = Object.assign({}, tempHashes.get(iu.id), { mustChange: true, pwv: 1 }); report.tempPasswords.push({ username: u.username, name: u.name, password: temps.get(iu.id) }); }
        if (target && target.id !== u.id) { doc.data.users = doc.data.users.filter(x => x.id !== target.id); delete doc.secrets[target.id]; doc.logins = doc.logins || {}; if (doc.logins[target.id]) { doc.logins[u.id] = doc.logins[target.id]; delete doc.logins[target.id]; } }
        const i = doc.data.users.findIndex(x => x.id === u.id); if (i >= 0) doc.data.users[i] = u; else doc.data.users.push(u);
        doc.secrets[u.id] = sec;
      }
      if (Object.keys(remap).length) { const walk = v => { if (typeof v === 'string') return remap[v] || v; if (Array.isArray(v)) return v.map(walk); if (isObj(v)) { const o = {}; for (const k of Object.keys(v)) o[remap[k] || k] = walk(v[k]); return o; } return v; }; for (const c of COLLS) if (c !== 'users') doc.data[c] = doc.data[c].map(walk); doc.audit = doc.audit.map(walk); }
      report.counts.users = incoming.length;
      for (const c of COLLS) {
        if (c === 'users' || !Array.isArray(P[c])) continue; let n = 0;
        for (const r0 of P[c]) { if (!valid(c, r0)) { report.skipped++; continue; } const rr = jsonClone(r0); const i = doc.data[c].findIndex(x => x.id === rr.id); if (i >= 0) doc.data[c][i] = rr; else doc.data[c].push(rr); n++; }
        report.counts[c] = n;
      }
      if (settingsOk) doc.settings = jsonClone(P.settings);
      if (fromCloud && isObj(P.counters)) { doc.counters = doc.counters || {}; for (const [k, v] of Object.entries(P.counters)) if (Number.isInteger(v) && (!Number.isInteger(doc.counters[k]) || doc.counters[k] < v)) doc.counters[k] = v; }
      if (Array.isArray(P.audit)) {
        const have = new Set(doc.audit.map(a => a.id)); let added = 0;
        for (const a of P.audit) { if (!isObj(a) || !a.id || have.has(String(a.id)) || archivedIds.has(String(a.id))) continue; have.add(String(a.id)); added++; doc.audit.push({ id: String(a.id).slice(0, 80), at: String(a.at || ''), actor: typeof a.actor === 'string' ? a.actor : null, actorName: String(a.actorName || ''), action: String(a.action || '').slice(0, 60), entity: String(a.entity || '').slice(0, 40), entityId: a.entityId ? String(a.entityId).slice(0, 80) : null, detail: isObj(a.detail) ? { name: String(a.detail.name || '').slice(0, 200) } : null }); }
        doc.audit.sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0)); report.counts.audit = added;   // ما زاد عن الحد يُؤرشف في الكتابة نفسها ولا يُحذف
      }
      if (P.files && isObj(P.files)) report.files = Object.keys(P.files).length;
      if (!doc.data.users.some(x => x.role === 'admin' && x.active)) throw E.bad('بعد الاستيراد لن يبقى مدير نظام نشط؛ أُلغي الاستيراد.');
      doc.audit.push(this.entry(me, 'backup_import', 'system', null, { name: Object.entries(report.counts).map(([k, v]) => k + ':' + v).join(' ') }));
    });
    const out = Object.assign({ ok: true, rev: r.rev, prevRev: r.prevRev, others: r.others }, report);
    if (meNewId) { const s = this.cache.doc.secrets[meNewId]; out.token = signToken(this.secret, meNewId, s.pwv || 0); out.me = meNewId; }
    return out;
  }

  /* ---------- المرفقات ---------- */
  canSeeFile(doc, user, path, att) {
    if (doc.data.contracts.some(k => k.noticeFile === path)) return true;                 // إخطار العقد الموقّع وثيقة رسمية متاحة لكل موظفي الإدارة
    if (!att) return canViewAll(user);
    if (canViewAll(user) || !att.evaluationId) return true;
    return this.visibleEvals(doc, user).some(e => e.id === att.evaluationId);
  }
  async file(req) {
    try {
      if (!this.configured()) throw E.config();
      const m = req.method === 'PUT' ? 'POST' : req.method;
      if (!['GET', 'POST', 'DELETE'].includes(m)) throw new HttpError(405, 'Method not allowed', 'method');
      const path = new URL(req.url).searchParams.get('path') || '';
      if (!FILE_RE.test(path) || path.includes('..')) throw E.bad('مسار ملف غير صالح.');
      const key = this.P.files + sha256hex(path);
      const decide = ({ user, doc }) => {
        const r = rankOf(user); const att = doc.data.attachments.find(a => a.path === path) || null; const notice = doc.data.contracts.some(c => c.noticeFile === path);
        if (m === 'GET') { if (!this.canSeeFile(doc, user, path, att)) throw E.notFound('الملف غير موجود.'); return { user, att }; }
        if (r < 1) throw E.forbid('حساب المتابعة للاطلاع فقط ولا يملك صلاحية التعديل.');
        if (m === 'DELETE') {
          if (notice ? r < 2 : att ? (att.uploadedBy !== user.id && r < 2) : r < 2) throw E.forbid();
          if (att) { const { ev, locked } = this.attLock(doc, att); if ((locked && user.role !== 'admin') || (r < 2 && ev && ev.status === 'submitted')) throw E.forbid('مستندات هذا التقييم مقفلة.'); }
          return { user, att };
        }
        const k = doc.data.contracts.find(c => c.id === path.split('/')[1]); if (!k) throw E.bad('العقد غير موجود.');
        if (r < 2 && !this.onTeam(doc, user, k.id)) throw E.forbid('لست ضمن فريق تقييم هذا العقد.');
        if (att || notice) throw E.exists();
        return { user, att };
      };
      /* القرار على ذاكرة النسخة أولاً، فإن رُفض الطلب أُعيد على أحدث نسخة (مرفق أُضيف للتو من نسخة أخرى مثلاً) */
      let a = await this.authed(req), d;
      try { d = decide(a); } catch (e) { if (!(e instanceof HttpError) || a.fresh) throw e; a = await this.freshAuthed(req); d = decide(a); }
      const { user, att } = d;
      if (m === 'GET') {
        const f = await this.store.read(key, {}); if (f.status !== 200) throw E.notFound('الملف غير موجود في التخزين.');
        const name = (att && att.name) || path.split('/').pop().replace(/^([0-9a-f]{8}__)?(notice__)?/, '');
        return new Response(f.body, { status: 200, headers: { 'content-type': (att && att.mime) || f.contentType || 'application/octet-stream', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
      }
      if (m === 'DELETE') { await this.store.del(key); return respond(200, { ok: true }, req); }
      if (this.limUpload.hit('u:' + user.id)) throw E.tooFast();
      if (Number(req.headers.get('content-length') || 0) > LIMITS.file) throw E.large('حجم الملف أكبر من 4 ميجابايت.');
      const buf = Buffer.from(await req.arrayBuffer()); if (!buf.length) throw E.bad('الملف فارغ.'); if (buf.length > LIMITS.file) throw E.large('حجم الملف أكبر من 4 ميجابايت.');
      try { await this.store.write(key, buf, { create: true, contentType: String(req.headers.get('content-type') || 'application/octet-stream').slice(0, 120) }); }
      catch (e) { if (this.mapError(e)) throw e; const ex = await this.store.read(key, {}).catch(() => ({ status: 0 })); if (ex.status === 200) throw E.exists(); throw e; }   // الرفع لا يكتب فوق ملف موجود
      return respond(200, { ok: true, size: buf.length }, req);
    } catch (e) { return this.errorResponse(e, req); }
  }
}
