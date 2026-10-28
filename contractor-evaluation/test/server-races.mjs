// اختبارات التزامن والأعطال على منطق الخادم نفسه (دون شبكة): عدة نسخ خادم تتشارك تخزيناً واحداً،
// مع حقن أعطال (رد مفقود، تأخير قراءة، كتابة من نسخة أخرى في اللحظة الحرجة، إعادة نسخة احتياطية).
import { readFileSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url)); const ROOT = path.resolve(here, '..');
const core = await import(path.join(ROOT, 'app/lib/core.mjs'));
const { loadBank } = await import(path.join(ROOT, 'app/lib/runtime.mjs'));
const { fsStore } = await import(path.join(ROOT, 'dev/fs-store.mjs'));
const { Server, hashPassword, LIMITS } = core;
const bank = loadBank(readFileSync(path.join(ROOT, 'app/bank.js'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uuid = () => randomUUID(); const iso = (d = 0) => new Date(Date.now() + d).toISOString();
LIMITS.iter = 10000;                                   // تجزئة أسرع للاختبار فقط
const DEFAULTS = Object.assign({}, LIMITS);
const reset = () => Object.assign(LIMITS, DEFAULTS);

/* «نافذة» على تخزين مشترك بخطافات خاصة بكل نسخة خادم */
function store(from) {
  const dir = from ? from.dir : mkdtempSync(path.join(os.tmpdir(), 'ev-races-')); const base = from ? from.base : fsStore(dir);
  const st = { dbRead: 0, dbWrite: 0, dbWriteFail: 0, del: [] }; const hooks = {};
  return {
    ready: true, dir, base, st, hooks,
    async read(p, o = {}) { if (p.endsWith('db.json.gz')) st.dbRead++; if (hooks.beforeRead) await hooks.beforeRead(p, o); const r = await base.read(p, o); if (hooks.afterRead) await hooks.afterRead(p, o, r); return r; },
    async write(p, b, o = {}) {
      if (hooks.beforeWrite) await hooks.beforeWrite(p, o);
      let etag; try { etag = await base.write(p, b, o); if (p.endsWith('db.json.gz')) st.dbWrite++; } catch (e) { if (p.endsWith('db.json.gz')) st.dbWriteFail++; throw e; }
      if (hooks.afterWrite && (await hooks.afterWrite(p, o, etag)) === 'lose-reply') { const e = new Error('precondition'); e.code = 'precondition'; throw e; }   // كُتب فعلاً ثم ضاع الرد وأعادت المكتبة المحاولة
      return etag;
    },
    async del(p) { st.del.push(p); return base.del(p); }, copy: (a, b) => base.copy(a, b), list: p => base.list(p),
  };
}
const docOf = async s => { const r = await s.base.read('ev/db.json.gz'); return r.status === 200 ? JSON.parse(gunzipSync(r.body).toString('utf8')) : null; };
const SEED = JSON.parse(readFileSync(path.join(ROOT, 'dev/seed.example.json'), 'utf8')); const TEMP = Object.fromEntries(SEED.map(s => [s.username, s.password]));
let seedHashed = null;
async function server(st) {
  if (!seedHashed) { seedHashed = []; for (const s of SEED) { const x = Object.assign({}, s, await hashPassword(s.password)); delete x.password; seedHashed.push(x); } }
  return new Server({ store: st, secret: 'r'.repeat(64), seedUsers: seedHashed, bank });
}
let ipn = 1;
async function rpc(srv, op, payload, token) {
  const headers = { 'content-type': 'application/json', 'x-real-ip': '198.51.100.' + ((ipn++ % 250) + 1) }; if (token) headers.authorization = 'Bearer ' + token;
  const res = await srv.rpc(new Request('https://x.test/api/rpc', { method: 'POST', headers, body: JSON.stringify(Object.assign({ op }, payload || {})) }));
  let body = null; try { body = await res.json(); } catch (e) { } return { status: res.status, body };
}
async function file(srv, method, p, token, buf, type) {
  const headers = {}; if (token) headers.authorization = 'Bearer ' + token; if (type) headers['content-type'] = type;
  const res = await srv.file(new Request('https://x.test/api/file?path=' + encodeURIComponent(p), { method, headers, body: buf }));
  await res.arrayBuffer(); return { status: res.status };
}
const NEWPW = u => 'Vx' + u + '#2026k';
async function signin(srv, u) {
  let l = await rpc(srv, 'login', { username: u, password: TEMP[u] });
  if (l.status !== 200) { l = await rpc(srv, 'login', { username: u, password: NEWPW(u) }); if (l.status !== 200) throw new Error('login ' + u + ' ' + l.status); return l.body.token; }
  if (!l.body.mustChange) return l.body.token;
  const c = await rpc(srv, 'password', { next: NEWPW(u) }, l.body.token); if (c.status !== 200) throw new Error('password ' + u + ' ' + c.status); return c.body.token;
}
const cycleType = Object.keys(bank.labels.cycleType)[0];

let pass = 0, fail = 0; const failures = [];
const t = async (name, fn) => { try { await fn(); pass++; console.log('✔', name); } catch (e) { fail++; failures.push(name + ': ' + e.message); console.log('✘', name, '—', e.message); } finally { reset(); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'expected') + ` ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

await t('a fake attachment record cannot be used to delete a contract\'s signed notice', async () => {
  const s = store(); const A = await server(s); const head = await signin(A, 'head'); const eng = await signin(A, 'eng1');
  const engId = (await docOf(s)).data.users.find(u => u.username === 'eng1').id;
  const K = { id: uuid(), companyId: 'c1', role: 'contractor', status: 'active', leadEngineer: engId, evaluators: [engId], updatedAt: iso() };
  const K2 = { id: uuid(), companyId: 'c2', role: 'contractor', status: 'active', leadEngineer: null, evaluators: [], updatedAt: iso() };
  eq((await rpc(A, 'put', { coll: 'contracts', rec: K, base: null }, head)).status, 200); eq((await rpc(A, 'put', { coll: 'contracts', rec: K2, base: null }, head)).status, 200);
  const notice = `attachments/${K2.id}/9f8e7d6c__notice__signed.pdf`; eq((await file(A, 'POST', notice, head, Buffer.from('%PDF signed'), 'application/pdf')).status, 200);
  eq((await rpc(A, 'put', { coll: 'contracts', rec: Object.assign({}, K2, { noticeFile: notice, noticeStatus: 'acknowledged', updatedAt: iso(5) }), base: K2.updatedAt }, head)).status, 200);
  const cy = { id: uuid(), contractId: K.id, type: cycleType, label: 'q', status: 'open', method: 'mean', excluded: [], evalWeights: {}, updatedAt: iso() }; eq((await rpc(A, 'put', { coll: 'cycles', rec: cy, base: null }, eng)).status, 200);
  const ev = { id: uuid(), cycleId: cy.id, contractId: K.id, evaluatorId: engId, status: 'draft', scores: {}, updatedAt: iso() }; eq((await rpc(A, 'put', { coll: 'evaluations', rec: ev, base: null }, eng)).status, 200);
  const fake = { id: uuid(), contractId: K2.id, evaluationId: ev.id, path: notice, name: 'x.pdf', mime: 'application/pdf', uploadedBy: engId, updatedAt: iso() };
  ok((await rpc(A, 'put', { coll: 'attachments', rec: fake, base: null }, eng)).status >= 400, 'fake record for the notice path accepted');
  ok((await rpc(A, 'put', { coll: 'attachments', rec: Object.assign({}, fake, { id: uuid(), path: `attachments/${K2.id}/aaaa1111__mine.pdf` }), base: null }, eng)).status >= 400, 'engineer outside the team registered an attachment on another contract');
  eq((await file(A, 'DELETE', notice, eng)).status, 403, 'engineer deleted the notice');
  const own = { id: uuid(), contractId: K.id, evaluationId: ev.id, path: `attachments/${K.id}/bbbb2222__own.pdf`, name: 'own.pdf', mime: 'application/pdf', uploadedBy: engId, updatedAt: iso() };
  eq((await file(A, 'POST', own.path, eng, Buffer.from('%PDF own'), 'application/pdf')).status, 200); eq((await rpc(A, 'put', { coll: 'attachments', rec: own, base: null }, eng)).status, 200, 'own attachment');
  const moved = Object.assign({}, own, { path: notice, updatedAt: iso(9) }); ok((await rpc(A, 'put', { coll: 'attachments', rec: moved, base: own.updatedAt }, head)).status >= 400, 'attachment re-pointed to the notice');
  eq((await file(A, 'GET', notice, head)).status, 200, 'notice still downloadable');
});

await t('a remove decided on a stale instance cache still removes the record and its file', async () => {
  const sA = store(), sB = store(sA); const A = await server(sA), B = await server(sB);
  const headA = await signin(A, 'head'), headB = await signin(B, 'head');
  const K = { id: uuid(), companyId: 'c', role: 'contractor', status: 'active', updatedAt: iso() }; eq((await rpc(B, 'put', { coll: 'contracts', rec: K, base: null }, headB)).status, 200);
  await rpc(A, 'load', {}, headA);                                                           // ذاكرة A الآن حديثة ولا تعرف المرفق الآتي
  const fp = `attachments/${K.id}/aa11bb22__wrong.pdf`; eq((await file(B, 'POST', fp, headB, Buffer.from('%PDF x'), 'application/pdf')).status, 200);
  const me = (await rpc(B, 'load', {}, headB)).body.me; const att = { id: uuid(), contractId: K.id, path: fp, name: 'wrong.pdf', mime: 'application/pdf', uploadedBy: me, updatedAt: iso() };
  const put = await rpc(B, 'put', { coll: 'attachments', rec: att, base: null }, headB); eq(put.status, 200);
  const rm = await rpc(A, 'remove', { coll: 'attachments', id: att.id }, headA); eq(rm.status, 200); ok(rm.body.rev > put.body.rev, 'remove reported an older revision ' + rm.body.rev);
  ok(!(await docOf(sA)).data.attachments.some(a => a.id === att.id), 'record still stored'); eq((await file(B, 'GET', fp, headB)).status, 404, 'file still stored');
});

await t('a password reset racing a login never yields a token for the reset account', async () => {
  for (const mode of ['reset', 'own-change']) {
    const sA = store(), sB = store(sA); const A = await server(sA), B = await server(sB);
    const adminB = await signin(B, 'admin'); await signin(A, 'eng1');
    const engId = (await docOf(sA)).data.users.find(u => u.username === 'eng1').id;
    LIMITS.loginRecordMs = 1; await sleep(5);
    let armed = true, other = null;
    sA.hooks.beforeWrite = async p => { if (armed && p.endsWith('db.json.gz')) { armed = false; other = mode === 'reset' ? await rpc(B, 'userReset', { id: engId }, adminB) : await rpc(B, 'password', { next: 'OwnerNew#2026', current: NEWPW('eng1') }, (await rpc(B, 'login', { username: 'eng1', password: NEWPW('eng1') })).body.token); } };
    const l = await rpc(A, 'login', { username: 'eng1', password: NEWPW('eng1') });
    eq(other && other.status, 200, mode + ' on B'); eq(l.status, 403, mode + ': login with the old password');
    if (mode === 'reset') eq((await rpc(B, 'login', { username: 'eng1', password: other.body.tempPassword })).status, 200, 'temporary password after reset');
    reset();
  }
});

await t('a lost write reply is recognised as ours even when another instance writes on top', async () => {
  for (const variant of ['overwrite', 'readfail']) {
    const sA = store(), sB = store(sA); const A = await server(sA), B = await server(sB);
    const adminA = await signin(A, 'admin'), headB = await signin(B, 'head');
    LIMITS.auditKeep = 10; LIMITS.auditChunk = 5;
    while ((await docOf(sA)).audit.length < 10) await rpc(A, 'put', { coll: 'projects', rec: { id: uuid(), name: 'p', type: 'other', updatedAt: iso() }, base: null, audit: { action: 'save', detail: { name: 'fill' } } }, adminA);
    let armed = true;
    sA.hooks.afterWrite = async (p, o) => {
      if (!armed || !p.endsWith('db.json.gz') || !o.ifMatch) return; armed = false;
      if (variant === 'overwrite') eq((await rpc(B, 'put', { coll: 'companies', rec: { id: uuid(), name_ar: 'ش', roles: ['contractor'], status: 'normal', updatedAt: iso() }, base: null }, headB)).status, 200, 'B writes on top');
      if (variant === 'readfail') { let n = 0; sA.hooks.beforeRead = async pp => { if (pp.endsWith('db.json.gz') && n++ === 0) { sA.hooks.beforeRead = null; const e = new Error('net'); e.code = 'unavailable'; throw e; } }; }
      return 'lose-reply';
    };
    const rec = { id: uuid(), name: 'new project', type: 'other', updatedAt: iso() };
    const r = await rpc(A, 'put', { coll: 'projects', rec, base: null, audit: { action: 'save', detail: { name: 'mine' } } }, adminA);
    const d = await docOf(sA); const missing = []; for (const ap of d.auditArchives || []) if ((await sA.base.read(ap)).status !== 200) missing.push(ap);
    eq(missing.length, 0, variant + ': referenced audit archives deleted');
    eq(d.data.projects.filter(x => x.id === rec.id).length, 1, variant + ': record stored once');
    let logged = d.audit.filter(a => a.entityId === rec.id).length; for (const ap of d.auditArchives || []) { const x = await sA.base.read(ap); if (x.status === 200) logged += JSON.parse(gunzipSync(x.body).toString('utf8')).filter(a => a.entityId === rec.id).length; }
    if (r.status === 200) eq(logged, 1, variant + ': audit entries for the save');
    if (variant === 'overwrite') eq(r.status, 200, 'put reported ' + r.status + ' ' + (r.body && r.body.code));
    else ok(r.status === 200 || r.status >= 500, 'readfail: unexpected ' + r.status + ' ' + (r.body && r.body.code));
    reset();
  }
});

await t('restoring an older backup over the database is picked up by warm instances', async () => {
  LIMITS.cacheMs = 300;
  const s = store(); const A = await server(s); const admin = await signin(A, 'admin');
  await rpc(A, 'put', { coll: 'projects', rec: { id: uuid(), name: 'good', type: 'other', updatedAt: iso() }, base: null }, admin);
  await s.base.copy('ev/db.json.gz', 'ev/backups/2026-10-27.json.gz');
  for (let i = 0; i < 3; i++) await rpc(A, 'put', { coll: 'projects', rec: { id: uuid(), name: 'mistake' + i, type: 'other', updatedAt: iso() }, base: null }, admin);
  const restored = JSON.parse(gunzipSync((await s.base.read('ev/backups/2026-10-27.json.gz')).body).toString()).rev;
  await s.base.copy('ev/backups/2026-10-27.json.gz', 'ev/db.json.gz'); await sleep(350);
  const ld = await rpc(A, 'load', {}, admin); eq(ld.body.rev, restored, 'warm instance still shows the pre-restore data');
  const f0 = s.st.dbWriteFail; const w = await rpc(A, 'put', { coll: 'projects', rec: { id: uuid(), name: 'after restore', type: 'other', updatedAt: iso() }, base: null }, admin);
  eq(w.status, 200, 'write after restore'); ok(s.st.dbWriteFail - f0 <= 1, 'failed writes after restore: ' + (s.st.dbWriteFail - f0));
});

await t('a request that joins an in-flight read sent earlier still sees writes acknowledged before it began', async () => {
  LIMITS.cacheMs = 400;
  const sA = store(), sB = store(sA); const A = await server(sA), B = await server(sB);
  const headB = await signin(B, 'head'), engB = await signin(B, 'eng1');
  const engId = (await docOf(sA)).data.users.find(u => u.username === 'eng1').id;
  const K = { id: uuid(), companyId: 'c', role: 'contractor', status: 'active', leadEngineer: engId, evaluators: [engId], updatedAt: iso() }; await rpc(B, 'put', { coll: 'contracts', rec: K, base: null }, headB);
  const cy = { id: uuid(), contractId: K.id, type: cycleType, label: 'c', status: 'open', method: 'mean', excluded: [], evalWeights: {}, updatedAt: iso() }; await rpc(B, 'put', { coll: 'cycles', rec: cy, base: null }, headB);
  const ev = { id: uuid(), cycleId: cy.id, contractId: K.id, evaluatorId: engId, status: 'draft', scores: {}, updatedAt: iso() }; eq((await rpc(B, 'put', { coll: 'evaluations', rec: ev, base: null }, engB)).status, 200);
  const engA = await signin(A, 'eng1'); await rpc(A, 'load', {}, engA); await sleep(450);
  let slow = true; sA.hooks.afterRead = async p => { if (slow && p.endsWith('db.json.gz')) { slow = false; await sleep(300); } };   // لقطة مبكرة، رد متأخر
  const other = rpc(A, 'load', {}, headB); await sleep(20);
  const fp = `attachments/${K.id}/abcd1234__report.pdf`; await file(B, 'POST', fp, engB, Buffer.from('%PDF x'), 'application/pdf');
  eq((await rpc(B, 'put', { coll: 'attachments', rec: { id: uuid(), contractId: K.id, evaluationId: ev.id, path: fp, name: 'report.pdf', mime: 'application/pdf', uploadedBy: engId, updatedAt: iso() }, base: null }, engB)).status, 200);
  eq((await file(A, 'GET', fp, engA)).status, 200, 'download right after the record was saved on another instance'); await other;
});

console.log(`\n${pass} passed, ${fail} failed`); if (fail) { console.log(failures.join('\n')); process.exit(1); }
