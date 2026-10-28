// اختبارات واجهة الخادم السحابي: الدخول، الصلاحيات، حجب تقييمات الزملاء، التعارض، التزامن بين نسختين، المرفقات، الاستيراد
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const PORT = Number(process.env.API_TEST_PORT || 8790); const BASE = `http://localhost:${PORT}/api/`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ev-api-'));
const srv = spawn(process.execPath, ['dev/server.mjs', '--port', String(PORT), '--data', dataDir, '--reset', '--instances', '2', '--audit-keep', '40', '--cache-ms', '2000'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let srvErr = ''; srv.stderr.on('data', d => { srvErr += d; });
const stop = () => { try { srv.kill(); } catch (e) { } };
process.on('exit', stop);

let pass = 0, fail = 0; const failures = [];
const t = async (name, fn) => { try { await fn(); pass++; console.log('✔', name); } catch (e) { fail++; failures.push(name + ': ' + e.message); console.log('✘', name, '—', e.message); } };
const eq = (a, b, m) => { if (a !== b) throw new Error((m || 'expected') + ` ${JSON.stringify(b)} got ${JSON.stringify(a)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
async function rpc(op, payload, token) { const r = await fetch(BASE + 'rpc', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: JSON.stringify(Object.assign({ op }, payload || {})) }); let body = null; try { body = await r.json(); } catch (e) { } return { status: r.status, body }; }
async function upload(token, p, buf, type) { const r = await fetch(BASE + 'file?path=' + encodeURIComponent(p), { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': type || 'application/octet-stream' }, body: buf }); return r.status; }
async function download(token, p) { const r = await fetch(BASE + 'file?path=' + encodeURIComponent(p), { headers: token ? { authorization: 'Bearer ' + token } : {} }); return { status: r.status, buf: Buffer.from(await r.arrayBuffer()) }; }
const deepKeys = (o, out = new Set()) => { if (Array.isArray(o)) o.forEach(x => deepKeys(x, out)); else if (o && typeof o === 'object') for (const k of Object.keys(o)) { out.add(k); deepKeys(o[k], out); } return out; };
const now = () => new Date().toISOString();
const S = {}; // tokens
const U = {}; // user ids by username
async function login(u, p) { const r = await rpc('login', { username: u, password: p }); if (r.status !== 200) throw new Error(`login ${u} → ${r.status} ${r.body && r.body.error}`); return r.body; }
async function first(u, temp, next) { const b = await login(u, temp); const c = await rpc('password', { next }, b.token); eq(c.status, 200, 'password change ' + u); S[u] = c.body.token; return S[u]; }
async function put(who, coll, rec, base, audit) { if (!rec.updatedAt) rec.updatedAt = now(); return rpc('put', { coll, rec, base: base || null, audit: audit === undefined ? { action: 'save', detail: { name: rec.name || rec.name_ar || '' } } : audit }, S[who]); }
async function load(who) { const r = await rpc('load', {}, S[who]); if (r.status !== 200) throw new Error('load ' + who + ' → ' + r.status); return r.body.data; }

for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + 'health'); if (r.ok) break; } catch (e) { } await new Promise(r => setTimeout(r, 200)); }

await t('health reports a configured cloud server', async () => { const r = await (await fetch(BASE + 'health')).json(); eq(r.app, 'sijil-alada'); eq(r.configured, true); });
await t('GET on rpc is rejected', async () => { const r = await fetch(BASE + 'rpc'); eq(r.status, 405); });
await t('invalid JSON and unknown ops are rejected', async () => { const r = await fetch(BASE + 'rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' }); eq(r.status, 400); eq((await rpc('dropTables')).status, 400); eq((await rpc('__proto__')).status, 400); eq((await rpc('constructor')).status, 400); });
await t('wrong password and unknown user get the same message', async () => { const a = await rpc('login', { username: 'admin', password: 'x' }); const b = await rpc('login', { username: 'nobody', password: 'x' }); eq(a.status, 403); eq(b.status, 403); eq(a.body.error, b.body.error); });
let adminLogin;
await t('first login with the temporary password requires a change', async () => { adminLogin = await login('ADMIN', 'temp-admin1'); eq(adminLogin.mustChange, true); ok(adminLogin.token); const me = adminLogin.data.users.find(u => u.id === adminLogin.me); eq(me.mustChange, true); });
await t('no password hash, salt or credentials ever reach the browser', async () => { const keys = deepKeys(adminLogin); for (const k of ['hash', 'salt', 'secrets', 'credentials', 'pwv', 'iter']) ok(!keys.has(k), 'leaked key ' + k); });
await t('missing, garbage and tampered tokens are refused', async () => {
  eq((await rpc('load')).status, 401); eq((await rpc('load', {}, 'garbage')).status, 401);
  const [p, s] = adminLogin.token.split('.'); const o = JSON.parse(Buffer.from(p, 'base64url').toString()); o.u = 'someone-else'; const forged = Buffer.from(JSON.stringify(o)).toString('base64url') + '.' + s; eq((await rpc('load', {}, forged)).status, 401);
});
await t('new password rules: length, weak list, letters and digits', async () => {
  for (const pw of ['short1', '12345678', 'abcdefgh', 'admin', '11111111']) eq((await rpc('password', { next: pw }, adminLogin.token)).status, 400, 'pw ' + pw);
  const r = await rpc('password', { next: 'Admin#2026' }, adminLogin.token); eq(r.status, 200); S.admin = r.body.token;
});
await t('changing the password revokes the old session (within the 2 s cache window)', async () => { await new Promise(r => setTimeout(r, 2100)); eq((await rpc('load', {}, adminLogin.token)).status, 401); eq((await rpc('load', {}, adminLogin.token)).status, 401); eq((await rpc('load', {}, S.admin)).status, 200); eq((await rpc('load', {}, S.admin)).status, 200); });
await t('later changes need the current password', async () => {
  eq((await rpc('password', { next: 'Admin#2027' }, S.admin)).status, 403);
  eq((await rpc('password', { next: 'Admin#2027', current: 'wrong' }, S.admin)).status, 403);
  const r = await rpc('password', { next: 'Admin#2027', current: 'Admin#2026' }, S.admin); eq(r.status, 200); S.admin = r.body.token;
});
await t('repeated wrong logins are throttled', async () => {
  let saw = false; for (let i = 0; i < 20 && !saw; i++) { const r = await rpc('login', { username: 'director', password: 'bad' + i }); if (r.status === 429) saw = true; }
  ok(saw, 'no 429'); const r = await rpc('login', { username: 'director', password: 'temp-dir1' }); ok(r.status === 429 || r.status === 200, 'unexpected ' + r.status);
});

let comp, proj, k1, k2;
await t('admin sets up company, project and two contracts', async () => {
  const d = await load('admin'); for (const u of d.users) U[u.username] = u.id;
  comp = { id: randomUUID(), name_ar: 'شركة الاختبار', roles: ['contractor'], status: 'normal' }; eq((await put('admin', 'companies', comp)).status, 200);
  proj = { id: randomUUID(), name: 'مشروع الاختبار', type: 'mosque' }; eq((await put('admin', 'projects', proj)).status, 200);
  k1 = { id: randomUUID(), companyId: comp.id, projectId: proj.id, role: 'contractor', status: 'active', leadEngineer: U.eng1, evaluators: [U.eng1, U.head] }; eq((await put('admin', 'contracts', k1)).status, 200);
  k2 = { id: randomUUID(), companyId: comp.id, projectId: proj.id, role: 'contractor', status: 'active', leadEngineer: U.head, evaluators: [U.eng2], evalWeights: {} }; eq((await put('admin', 'contracts', k2)).status, 200);
});
await t('engineer cannot touch users, settings, templates or companies', async () => {
  await first('eng1', 'temp-eng1', 'Eng1#2026');
  const d = await load('eng1'); const me = d.users.find(u => u.id === U.eng1);
  eq((await put('eng1', 'users', Object.assign({}, me, { role: 'admin' }))).status, 403);
  eq((await rpc('settings', { settings: { appName: 'x' } }, S.eng1)).status, 403);
  eq((await put('eng1', 'templates', Object.assign({}, d.templates[0], { id: randomUUID() }))).status, 403);
  eq((await put('eng1', 'companies', { id: randomUUID(), name_ar: 'x' })).status, 403);
  eq((await rpc('userCreate', { user: { username: 'evil', name: 'x', role: 'admin' } }, S.eng1)).status, 403);
  eq((await rpc('userReset', { id: U.admin }, S.eng1)).status, 403);
  eq((await rpc('remove', { coll: 'companies', id: comp.id }, S.eng1)).status, 403);
});
let cy1, ev1;
await t('lead engineer opens a cycle; another engineer cannot', async () => {
  cy1 = { id: randomUUID(), contractId: k1.id, type: 'final', label: 'الدورة 1', status: 'open', method: 'mean', excluded: [], evalWeights: {} };
  eq((await put('eng1', 'cycles', cy1)).status, 200);
  S.eng2 = (await login('eng2', 'temp-eng2')).token;   // eng2 keeps the temporary password (used by the import test)
  eq((await put('eng2', 'cycles', Object.assign({}, cy1, { id: randomUUID() }))).status, 403);
});
await t('engineer creates own evaluation, not one in a colleague\'s name', async () => {
  ev1 = { id: randomUUID(), cycleId: cy1.id, contractId: k1.id, evaluatorId: U.eng1, status: 'draft', scores: { c1_1: { s: 7 } }, createdAt: now(), updatedAt: now() };
  eq((await put('eng1', 'evaluations', ev1)).status, 200);
  eq((await put('eng1', 'evaluations', { id: randomUUID(), cycleId: cy1.id, contractId: k1.id, evaluatorId: U.eng2, status: 'draft', scores: {} })).status, 403);
  eq((await put('eng1', 'evaluations', Object.assign({}, ev1, { id: randomUUID() }))).status, 400, 'duplicate evaluation in same cycle');
});
await t('a colleague\'s draft is hidden from other engineers but visible to managers', async () => {
  const d2 = await load('eng2'); ok(!d2.evaluations.some(e => e.id === ev1.id), 'eng2 sees eng1 draft');
  await first('head', 'temp-head1', 'Head#2026'); const dh = await load('head'); ok(dh.evaluations.some(e => e.id === ev1.id), 'head cannot see draft');
  eq((await load('eng2')).audit.length, 0, 'audit leaked to engineer');
});
const attPath = () => `attachments/${k1.id}/abcd1234__تقرير المختبر.pdf`;
await t('attachments: upload by the team, size limit, outsiders blocked', async () => {
  const pdf = Buffer.from('%PDF-1.4\n% test\n'); eq(await upload(S.eng1, attPath(), pdf, 'application/pdf'), 200);
  eq((await put('eng1', 'attachments', { id: randomUUID(), contractId: k1.id, cycleId: cy1.id, evaluationId: ev1.id, itemKey: 'c1_1', path: attPath(), name: 'تقرير المختبر.pdf', size: pdf.length, mime: 'application/pdf', uploadedBy: U.eng1 })).status, 200);
  eq(await upload(S.eng2, `attachments/${k1.id}/ffff0000__x.pdf`, pdf), 403, 'outsider upload');
  eq(await upload(S.eng1, `attachments/${k1.id}/ffff0001__big.bin`, Buffer.alloc(4 * 1024 * 1024 + 10)), 413, 'size limit');
  eq(await upload(S.eng1, `attachments/../../ev/db.json.gz`, pdf), 400, 'traversal');
  eq(await upload(S.eng1, `ev/db.json.gz`, pdf), 400, 'raw path');
});
await t('attachments: download respects evaluation visibility', async () => {
  const a = await download(S.eng1, attPath()); eq(a.status, 200); ok(a.buf.toString().startsWith('%PDF'));
  eq((await download(S.eng2, attPath())).status, 404, 'eng2 must not see eng1 draft attachment');
  eq((await download(S.head, attPath())).status, 200); eq((await download(null, attPath())).status, 401);
});
await t('stale edits are rejected with a conflict instead of overwriting', async () => {
  const d = await load('head'); const c = d.companies.find(x => x.id === comp.id); const base = c.updatedAt || null;
  const fresh = Object.assign({}, c, { contact_name: 'مدير', updatedAt: now() }); eq((await put('admin', 'companies', fresh, base)).status, 200);
  const stale = Object.assign({}, c, { contact_name: 'قديم', updatedAt: now() }); const r = await put('head', 'companies', stale, base); eq(r.status, 409); eq(r.body.code, 'conflict');
});
await t('30 parallel writes through two server instances lose nothing', async () => {
  const recs = Array.from({ length: 30 }, (_, i) => ({ id: randomUUID(), name: 'مشروع متزامن ' + i, type: 'other' }));
  const rs = await Promise.all(recs.map((r, i) => put(i % 2 ? 'admin' : 'head', 'projects', r)));
  ok(rs.every(r => r.status === 200), 'statuses ' + rs.map(r => r.status).join(','));
  const d = await load('admin'); const have = new Set(d.projects.map(p => p.id)); ok(recs.every(r => have.has(r.id)), 'lost ' + recs.filter(r => !have.has(r.id)).length);
});
await t('submitted evaluation is frozen for its author', async () => {
  const d = await load('eng1'); const e = d.evaluations.find(x => x.id === ev1.id);
  const sub = Object.assign({}, e, { status: 'submitted', submittedAt: now(), computed: { total: 7, axes: [] }, updatedAt: now() }); eq((await put('eng1', 'evaluations', sub, e.updatedAt)).status, 200);
  eq((await put('eng1', 'evaluations', Object.assign({}, sub, { scores: { c1_1: { s: 10 } }, updatedAt: now() }), sub.updatedAt)).status, 403);
  ev1 = sub;
});
await t('reviewer may return an evaluation but never change its scores', async () => {
  eq((await put('head', 'evaluations', Object.assign({}, ev1, { scores: { c1_1: { s: 1 } }, updatedAt: now() }), ev1.updatedAt)).status, 403);
  const ret = Object.assign({}, ev1, { status: 'returned', returnedNote: 'راجع البند الأول', returnedBy: U.head, updatedAt: now() }); eq((await put('head', 'evaluations', ret, ev1.updatedAt)).status, 200); ev1 = ret;
  const again = Object.assign({}, ev1, { scores: { c1_1: { s: 8 } }, status: 'submitted', updatedAt: now() }); eq((await put('eng1', 'evaluations', again, ev1.updatedAt)).status, 200); ev1 = again;
});
await t('follow-up account sees everything and can change nothing', async () => {
  await first('sec', 'temp-sec1', 'Sec#2026'); const d = await load('sec'); ok(d.evaluations.some(e => e.id === ev1.id));
  eq((await put('sec', 'companies', Object.assign({}, comp, { name_ar: 'x' }))).status, 403);
  eq((await rpc('remove', { coll: 'attachments', id: d.attachments[0].id }, S.sec)).status, 403);
  eq(await upload(S.sec, `attachments/${k1.id}/aaaa0000__s.pdf`, Buffer.from('x')), 403);
  eq((await rpc('settings', { settings: d.settings }, S.sec)).status, 403);
  eq((await download(S.sec, attPath())).status, 200);
});
await t('only approvers approve; only admin reopens; company status for approvers', async () => {
  let d = await load('head'); let c = d.cycles.find(x => x.id === cy1.id);
  eq((await put('head', 'cycles', Object.assign({}, c, { status: 'consolidated', consolidated: { total: 7.5, rating: 'good', axes: [], evaluationIds: [], count: 0 }, updatedAt: now() }), c.updatedAt)).status, 409, 'consolidation that leaves out a submitted evaluation');
  const e1 = d.evaluations.find(x => x.id === ev1.id);
  const cons = Object.assign({}, c, { status: 'consolidated', consolidated: { total: 7.5, rating: 'good', axes: [], evaluationIds: [ev1.id], count: 1, inputs: { [ev1.id]: e1.updatedAt } }, reviewedBy: U.head, updatedAt: now() }); eq((await put('head', 'cycles', cons, c.updatedAt)).status, 200);
  eq((await put('head', 'cycles', Object.assign({}, cons, { status: 'approved', approvedBy: U.head, updatedAt: now() }), cons.updatedAt)).status, 403);
  await first('waqf', 'temp-waqf1', 'Waqf#2026');
  const appr = Object.assign({}, cons, { status: 'approved', approvedBy: U.waqf, approvedAt: now(), consequence: 'improvement', updatedAt: now() }); eq((await put('waqf', 'cycles', appr, cons.updatedAt)).status, 200);
  eq((await put('waqf', 'cycles', Object.assign({}, appr, { status: 'consolidated', updatedAt: now() }), appr.updatedAt)).status, 403, 'non-admin reopen');
  const objection = Object.assign({}, appr, { objection: { date: '2026-10-28', text: 'تظلم', recordedBy: U.head }, updatedAt: now() }); eq((await put('head', 'cycles', objection, appr.updatedAt)).status, 200, 'manager records objection on approved cycle');
  const reopen = Object.assign({}, objection, { status: 'consolidated', reopenReason: 'تظلم مقبول', updatedAt: now() }); eq((await put('admin', 'cycles', reopen, objection.updatedAt)).status, 200);
  d = await load('head'); c = d.companies.find(x => x.id === comp.id);
  eq((await put('head', 'companies', Object.assign({}, c, { status: 'blacklist', updatedAt: now() }), c.updatedAt)).status, 403);
  eq((await put('waqf', 'companies', Object.assign({}, c, { status: 'watch', status_until: '2027-10-28', updatedAt: now() }), c.updatedAt)).status, 200);
});
let tmpUser;
await t('admin creates users and resets passwords with one-time temporary passwords', async () => {
  const r = await rpc('userCreate', { user: { username: 'newbie', name: 'مستخدم جديد', role: 'engineer', email: 'newbie@awqaf.gov.qa' } }, S.admin); eq(r.status, 200); ok(/^[a-z2-9]{4}-[a-z2-9]{4}$/.test(r.body.tempPassword), 'temp format ' + r.body.tempPassword); tmpUser = r.body.user;
  eq((await rpc('userCreate', { user: { username: 'NEWBIE', name: 'x', role: 'engineer' } }, S.admin)).status, 400, 'duplicate username');
  const l = await login('newbie', r.body.tempPassword); eq(l.mustChange, true);
  const rs = await rpc('userReset', { id: tmpUser.id }, S.admin); eq(rs.status, 200); ok(rs.body.tempPassword !== r.body.tempPassword);
  eq((await rpc('login', { username: 'newbie', password: r.body.tempPassword })).status, 403); eq((await rpc('login', { username: 'newbie', password: r.body.tempPassword })).status, 403); await new Promise(r => setTimeout(r, 2100)); eq((await rpc('load', {}, l.token)).status, 401, 'old session revoked by reset');
  S.newbie = (await login('newbie', rs.body.tempPassword)).token;
});
await t('deactivating a user ends their session; admin cannot lock themself out', async () => {
  const d = await load('admin'); const u = d.users.find(x => x.id === tmpUser.id); eq((await put('admin', 'users', Object.assign({}, u, { active: false, updatedAt: now() }), u.updatedAt)).status, 200);
  await new Promise(r => setTimeout(r, 2100)); eq((await rpc('load', {}, S.newbie)).status, 401); eq((await rpc('load', {}, S.newbie)).status, 401);
  const me = d.users.find(x => x.id === U.admin); eq((await put('admin', 'users', Object.assign({}, me, { active: false, updatedAt: now() }), me.updatedAt)).status, 400);
  eq((await put('admin', 'users', Object.assign({}, me, { role: 'engineer', updatedAt: now() }), me.updatedAt)).status, 400);
  const fake = Object.assign({}, me, { username: 'renamed', updatedAt: now() }); eq((await put('admin', 'users', fake, me.updatedAt)).status, 400, 'username change');
  const sneaky = Object.assign({}, me, { hash: 'aa', salt: 'bb', mustChange: false, updatedAt: now() }); eq((await put('admin', 'users', sneaky, me.updatedAt)).status, 200);
  eq((await rpc('load', {}, S.admin)).status, 200, 'secrets in a user record are ignored');
});
await t('exports: scoped for staff, complete with credentials for admin', async () => {
  const e1 = JSON.parse((await rpc('export', {}, S.eng1)).body.json); eq(e1.scope, 'user'); ok(!e1.credentials); eq(e1.audit.length, 0);
  const e2 = JSON.parse((await rpc('export', {}, S.admin)).body.json); eq(e2.scope, 'full'); ok(e2.credentials && e2.credentials[U.admin] && e2.credentials[U.admin].hash); ok(e2.audit.some(a => a.action === 'login'));
});
const sha = s => createHash('sha256').update(s).digest('hex');
let imp;
await t('import of an offline backup: kept passwords, default 123456 replaced, ids remapped', async () => {
  const L1 = randomUUID(), L2 = randomUUID(), E2 = randomUUID();
  const pTS = { id: randomUUID(), name: 'toString', type: 'other' }; eq((await put('admin', 'projects', pTS)).status, 200);
  const k3 = { id: randomUUID(), companyId: comp.id, projectId: proj.id, role: 'contractor', status: 'active', leadEngineer: E2, evaluators: [E2] };
  const payload = { users: [
    { id: L1, username: 'legacy1', name: 'مستخدم قديم', role: 'engineer', active: true, salt: 's1', hash: sha('s1:Legacy#2026'), mustChange: false },
    { id: L2, username: 'legacy2', name: 'مستخدم افتراضي', role: 'engineer', active: true, salt: 's2', hash: sha('s2:123456'), mustChange: true },
    { id: E2, username: 'eng2', name: 'مهندس ثانٍ', role: 'engineer', active: true, salt: 's3', hash: sha('s3:Eng2Off#2026'), mustChange: false } ],
    companies: [{ id: randomUUID(), name_ar: 'شركة من الأوفلاين', roles: ['designer'] }], contracts: [k3], settings: null, audit: [{ id: randomUUID(), at: '2026-10-01T10:00:00Z', actorName: 'admin', action: 'company_create', entity: 'companies' }] };
  const r = await rpc('import', { payload }, S.admin); eq(r.status, 200, (r.body && r.body.error) || ''); imp = r.body;
  eq(imp.tempPasswords.length, 1); eq(imp.tempPasswords[0].username, 'legacy2');
  eq((await rpc('login', { username: 'legacy1', password: 'Legacy#2026' })).status, 200, 'offline password kept');
  eq((await rpc('login', { username: 'legacy1', password: 'Legacy#2026' })).status, 200, 'still works after pbkdf2 upgrade');
  eq((await rpc('login', { username: 'legacy2', password: '123456' })).status, 403, 'default password must not work online');
  eq((await rpc('login', { username: 'legacy2', password: imp.tempPasswords[0].password })).status, 200);
  eq((await rpc('login', { username: 'eng2', password: 'Eng2Off#2026' })).status, 200, 'eng2 had not changed online temp → adopts offline password');
  const d = await load('admin'); const k2now = d.contracts.find(x => x.id === k2.id); ok(k2now.evaluators.includes(E2) && !k2now.evaluators.includes(U.eng2), 'eng2 id remapped in contracts');
  ok(!d.users.some(u => u.id === U.eng2), 'old eng2 record removed'); ok(d.users.filter(u => u.username === 'eng2').length === 1);
  const pNow = d.projects.find(x => x.id === pTS.id); ok(pNow && pNow.name === 'toString', 'a name equal to a built-in property was lost in the id remap: ' + JSON.stringify(pNow));
  const eng1now = await rpc('login', { username: 'eng1', password: 'Eng1#2026' }); eq(eng1now.status, 200, 'eng1 keeps online password');
});
await t('audit log rotates into archives and export still returns it all', async () => {
  const files = readdirSync(path.join(dataDir, 'ev', 'audit')).filter(f => f.endsWith('.gz')); ok(files.length >= 1, 'no audit archive');
  const e = JSON.parse((await rpc('export', {}, S.admin)).body.json); ok(e.audit.length > 40, 'export audit ' + e.audit.length);
});
await t('letters get server-assigned, unique reference numbers', async () => {
  const mk = () => ({ id: randomUUID(), contractId: k1.id, type: 'notice', refNo: 'client-chosen', subject: 'إخطار', to: 'الشركة', bodyHtml: '<p>نص</p>', issuedAt: now(), issuedBy: U.head });
  const recs = Array.from({ length: 10 }, mk);
  const rs = await Promise.all(recs.map((r, i) => put(i % 2 ? 'head' : 'admin', 'letters', r)));
  ok(rs.every(r => r.status === 200), 'statuses ' + rs.map(r => r.status).join(','));
  const refs = rs.map(r => r.body.patch && r.body.patch.refNo); ok(refs.every(x => x && x !== 'client-chosen'), 'refs ' + refs.join(','));
  eq(new Set(refs).size, refs.length, 'duplicate reference numbers'); ok(refs.every(x => x.includes(new Date().getFullYear() + '/')), 'year in ' + refs[0]);
  const d = await load('head'); const l = d.letters.find(x => x.id === recs[0].id); eq(l.refNo, refs[0]);
  const r2 = await put('head', 'letters', Object.assign({}, l, { subject: 'معدل', refNo: 'changed', updatedAt: now() }), l.updatedAt); eq(r2.status, 200); eq(r2.body.patch.refNo, refs[0], 'refNo kept on update');
});
await t('a save on a record someone deleted is refused instead of resurrecting it', async () => {
  const p = { id: randomUUID(), name: 'مشروع للحذف', type: 'other' }; eq((await put('admin', 'projects', p)).status, 200);
  const cur = (await load('head')).projects.find(x => x.id === p.id);
  eq((await rpc('remove', { coll: 'projects', id: p.id }, S.admin)).status, 200);
  const r = await put('head', 'projects', Object.assign({}, cur, { name: 'تعديل', updatedAt: now() }), cur.updatedAt); eq(r.status, 409); eq(r.body.deleted, true);
  ok(!(await load('admin')).projects.some(x => x.id === p.id), 'record came back');
});
await t('a conflict tells the client which version is current', async () => {
  const c = (await load('admin')).companies.find(x => x.id === comp.id);
  const r = await put('head', 'companies', Object.assign({}, c, { contact_name: 'y', updatedAt: now() }), '2000-01-01T00:00:00.000Z'); eq(r.status, 409); eq(r.body.current, c.updatedAt);
});
await t('cycles: engineers open cycles with defaults only; malformed results are refused', async () => {
  const base = () => ({ id: randomUUID(), contractId: k1.id, type: 'final', label: 'x', status: 'open', method: 'mean', excluded: [], evalWeights: {} });
  for (const b of [{ extra: '<img src=x onerror=alert(1)>' }, { method: 'weighted' }, { excluded: [U.head] }, { consolidated: { total: 9, count: '<b>' } }, { status: 'approved' }, { type: 'nope' }, { label: 'x'.repeat(300) }])
    eq((await put('eng1', 'cycles', Object.assign(base(), b))).status, 400, JSON.stringify(b).slice(0, 60));
  const c = (await load('head')).cycles.find(x => x.id === cy1.id);
  eq((await put('head', 'cycles', Object.assign({}, c, { consolidated: { total: 8, count: '<img src=x>', axes: [] }, updatedAt: now() }), c.updatedAt)).status, 400, 'count');
  eq((await put('head', 'cycles', Object.assign({}, c, { consolidated: { total: '<svg onload=1>', axes: [] }, updatedAt: now() }), c.updatedAt)).status, 400, 'total');
  eq((await put('head', 'cycles', Object.assign({}, c, { evalWeights: { [U.eng1]: 'heavy' }, updatedAt: now() }), c.updatedAt)).status, 400, 'weights');
});
await t('engineers outside the contract team cannot start evaluations there', async () => {
  const cy = { id: randomUUID(), contractId: k2.id, type: 'final', label: 'دورة العقد الثاني', status: 'open', method: 'mean', excluded: [], evalWeights: {} }; eq((await put('head', 'cycles', cy)).status, 200);
  eq((await put('eng1', 'evaluations', { id: randomUUID(), cycleId: cy.id, contractId: k2.id, evaluatorId: U.eng1, status: 'draft', scores: {} })).status, 403);
  eq((await put('head', 'evaluations', { id: randomUUID(), cycleId: cy.id, contractId: k2.id, evaluatorId: U.head, status: 'draft', scores: {} })).status, 200, 'managers may evaluate any contract');
});
await t('uploads never overwrite an existing file', async () => {
  eq(await upload(S.eng1, attPath(), Buffer.from('%PDF-1.4 replaced')), 409);
  const a = await download(S.head, attPath()); ok(a.buf.toString().startsWith('%PDF-1.4\n% test'), 'content was replaced');
});
await t('removing an attachment record also deletes its file', async () => {
  const p = `attachments/${k1.id}/beef0001__صورة.png`; eq(await upload(S.head, p, Buffer.from('png-bytes'), 'image/png'), 200);
  const id = randomUUID(); eq((await put('head', 'attachments', { id, contractId: k1.id, path: p, name: 'صورة.png', size: 9, mime: 'image/png', uploadedBy: U.head })).status, 200);
  eq((await download(S.head, p)).status, 200);
  eq((await rpc('remove', { coll: 'attachments', id }, S.head)).status, 200);
  eq((await download(S.head, p)).status, 404);
});
await t('removing something already gone writes nothing; the follow-up account is refused first', async () => {
  const before = (await rpc('load', {}, S.admin)).body.rev;
  eq((await rpc('remove', { coll: 'projects', id: randomUUID() }, S.admin)).status, 200);
  eq((await rpc('load', {}, S.admin)).body.rev, before, 'rev changed');
  eq((await rpc('remove', { coll: 'projects', id: randomUUID() }, S.sec)).status, 403);
});
await t('the browser can only add a logout entry to the audit log', async () => {
  for (const action of ['user_create', 'approve', 'backup_import']) eq((await rpc('audit', { entry: { action, detail: { name: 'fake-entry' } } }, S.eng1)).status, 200);
  eq((await rpc('audit', { entry: { action: 'logout' } }, S.eng1)).status, 200);
  const e = JSON.parse((await rpc('export', {}, S.admin)).body.json);
  ok(!e.audit.some(a => a.detail && a.detail.name === 'fake-entry'), 'forged entry accepted'); ok(e.audit.some(a => a.action === 'logout' && a.actor === U.eng1), 'logout missing');
  ok(e.audit.some(a => a.action === 'backup_export'), 'export not audited');
});
await t('rpc accepts only JSON, plus gzip for an admin restore', async () => {
  eq((await fetch(BASE + 'rpc', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ op: 'login', username: 'admin', password: 'x' }) })).status, 415);
  const g = gzipSync(Buffer.from(JSON.stringify({ op: 'import', payload: { companies: [{ id: randomUUID(), name_ar: 'شركة من نسخة مضغوطة', roles: ['contractor'] }] } })));
  const send = (body, token) => fetch(BASE + 'rpc', { method: 'POST', headers: Object.assign({ 'content-type': 'application/gzip' }, token ? { authorization: 'Bearer ' + token } : {}), body });
  eq((await send(g)).status, 401); eq((await send(g, S.eng1)).status, 403);
  const a = await send(g, S.admin); eq(a.status, 200); ok((await load('admin')).companies.some(c => c.name_ar === 'شركة من نسخة مضغوطة'), 'gzip import missing');
  eq((await send(Buffer.from('not gzip'), S.admin)).status, 413);
  const bomb = gzipSync(Buffer.alloc(70 * 1024 * 1024, 32)); ok(bomb.length < 4 * 1024 * 1024); eq((await send(bomb, S.admin)).status, 413, 'decompression bomb');
});
await t('imports that would break accounts are refused as a whole', async () => {
  eq((await rpc('import', { payload: { users: [{ id: randomUUID(), username: 'dupe', name: 'a', role: 'engineer' }, { id: randomUUID(), username: 'DUPE', name: 'b', role: 'engineer' }] } }, S.admin)).status, 400, 'duplicate usernames');
  const d = await load('admin'); const head = d.users.find(u => u.username === 'head');
  eq((await rpc('import', { payload: { users: [{ id: head.id, username: 'eng1', name: 'x', role: 'engineer' }] } }, S.admin)).status, 400, 'id and username point to different accounts');
  ok((await load('admin')).users.some(u => u.username === 'head' && u.role === 'section_head'), 'refused import changed data');
  const demote = { users: d.users.filter(u => u.role === 'admin').map(u => Object.assign({}, u, { role: 'engineer', active: false })) };
  eq((await rpc('import', { payload: demote }, S.admin)).status, 200);
  const me = (await load('admin')).users.find(u => u.id === U.admin); eq(me.role, 'admin', 'importer demoted'); eq(me.active, true, 'importer disabled');
  eq((await rpc('import', { payload: { companies: [{ id: 'x' }] } }, S.admin)).status, 200); ok(!(await load('admin')).companies.some(c => c.id === 'x'), 'invalid id imported');
});
await t('seed validation and address grouping', async () => {
  const core = await import('../app/lib/core.mjs');
  const good = Object.assign({ username: 'a1', name: 'a', role: 'admin' }, await core.hashPassword('Xx#12345'));
  eq(core.seedProblem([good]), null);
  for (const [bad, m] of [[[], 'empty'], [[Object.assign({}, good, { role: 'engineer' })], 'no admin'], [[good, Object.assign({}, good, { username: 'A1' })], 'duplicate'], [[Object.assign({}, good, { role: 'boss' })], 'role'], [[Object.assign({}, good, { hash: 'zz' })], 'hash'], [[{ username: 'a1', role: 'admin', password: 'plain' }], 'plaintext']]) ok(core.seedProblem(bad), m);
  eq(core.ipKey(new Request('http://x', { headers: { 'x-real-ip': '2001:db8:1:2:3:4:5:6' } })), '2001:db8:1:2::/64');
  eq(core.ipKey(new Request('http://x', { headers: { 'x-real-ip': '203.0.113.7' } })), '203.0.113.7');
});
await t('per-user write and upload limits (separate server with low limits)', async () => {
  const P2 = PORT + 3; const B2 = `http://localhost:${P2}/api/`; const dir2 = mkdtempSync(path.join(os.tmpdir(), 'ev-api-lim-'));
  const s2 = spawn(process.execPath, ['dev/server.mjs', '--port', String(P2), '--data', dir2, '--reset', '--write-limit', '5', '--upload-limit', '2'], { cwd: root, stdio: 'ignore' }); process.on('exit', () => { try { s2.kill(); } catch (e) { } });
  try {
    for (let i = 0; i < 50; i++) { try { const r = await fetch(B2 + 'health'); if (r.ok) break; } catch (e) { } await new Promise(r => setTimeout(r, 200)); }
    const call = async (op, payload, token) => { const r = await fetch(B2 + 'rpc', { method: 'POST', headers: Object.assign({ 'content-type': 'application/json' }, token ? { authorization: 'Bearer ' + token } : {}), body: JSON.stringify(Object.assign({ op }, payload || {})) }); return { status: r.status, body: await r.json().catch(() => null) }; };
    const l = await call('login', { username: 'admin', password: 'temp-admin1' }); const tok = (await call('password', { next: 'Admin#2026' }, l.body.token)).body.token;
    const st = []; for (let i = 0; i < 6; i++) st.push((await call('put', { coll: 'projects', rec: { id: randomUUID(), name: 'p' + i, type: 'other', updatedAt: now() }, base: null }, tok)).status);
    eq(st.join(','), '200,200,200,200,429,429', 'write limit');
    const h = await call('login', { username: 'head', password: 'temp-head1' }); const ht = (await call('password', { next: 'Head#2026' }, h.body.token)).body.token;
    const k = { id: randomUUID(), companyId: 'none', role: 'contractor', status: 'active', updatedAt: now() }; eq((await call('put', { coll: 'contracts', rec: k, base: null }, ht)).status, 200);
    const up = async i => (await fetch(B2 + 'file?path=' + encodeURIComponent(`attachments/${k.id}/0000000${i}__f.txt`), { method: 'POST', headers: { authorization: 'Bearer ' + ht, 'content-type': 'text/plain' }, body: 'x' })).status;
    eq([await up(1), await up(2), await up(3)].join(','), '200,200,429', 'upload limit');
  } finally { s2.kill(); }
});
await t('server core: lost write replies, batched writes and rejected jobs', async () => {
  const core = await import('../app/lib/core.mjs'); const { fsStore } = await import('../dev/fs-store.mjs'); const { loadBank } = await import('../app/lib/runtime.mjs');
  const bank = loadBank(readFileSync(path.join(root, 'app', 'bank.js'), 'utf8'));
  const base = fsStore(mkdtempSync(path.join(os.tmpdir(), 'ev-core-'))); let lose = 0;
  const store = Object.assign({}, base, { async write(p, b, o) { const etag = await base.write(p, b, o); if (lose && p.endsWith('db.json.gz') && o && o.ifMatch) { lose--; const e = new Error('precondition'); e.code = 'precondition'; throw e; } return etag; } });
  const seed = [Object.assign({ username: 'admin', name: 'a', role: 'admin' }, await core.hashPassword('temp-admin1'))];
  const srv = new core.Server({ store, secret: 'x'.repeat(40), seedUsers: seed, bank });
  eq((await srv.mutate(() => null)).rev, 1, 'create');
  lose = 1; const r = await srv.mutate(d => { d.data.projects.push({ id: 'p-lost-reply' }); }); eq(r.rev, 2, 'write recognised as ours');
  eq((await srv.readDoc(true)).doc.data.projects.filter(p => p.id === 'p-lost-reply').length, 1, 'applied once');
  const [x, y] = await Promise.all([srv.mutate(d => { d.data.projects.push({ id: 'p-a' }); }), srv.mutate(d => { d.data.projects.push({ id: 'p-b' }); })]);
  eq(x.rev, y.rev, 'same tick → one write'); eq(x.others, 1); eq(y.others, 1);
  const n = await srv.mutate(() => core.NOOP); eq(n.rev, x.rev, 'no-op writes nothing');
  const a = srv.mutate(d => { d.data.projects.push({ id: 'p-partial' }); throw new core.HttpError(400, 'no'); });
  const b = srv.mutate(d => { d.data.projects.push({ id: 'p-ok' }); });
  const [ra, rb] = await Promise.allSettled([a, b]); eq(ra.status, 'rejected'); eq(rb.status, 'fulfilled');
  const ids = (await srv.readDoc(true)).doc.data.projects.map(p => p.id); ok(ids.includes('p-ok') && !ids.includes('p-partial'), ids.join(','));
});
await t('an approved cycle is locked: only the objection changes, and only approvers decide it', async () => {
  const cy = { id: randomUUID(), contractId: k1.id, type: 'interim', label: 'دورة القفل', status: 'open', method: 'mean', excluded: [], evalWeights: {} }; eq((await put('head', 'cycles', cy)).status, 200);
  const ev = { id: randomUUID(), cycleId: cy.id, contractId: k1.id, evaluatorId: U.eng1, status: 'submitted', scores: { c1_1: { s: 6 } }, computed: { total: 6, axes: [] }, submittedAt: now() }; eq((await put('eng1', 'evaluations', ev)).status, 200);
  const c = (await load('head')).cycles.find(x => x.id === cy.id);
  const cons = Object.assign({}, c, { status: 'consolidated', consolidated: { total: 6, rating: 'acceptable', axes: [], evaluationIds: [ev.id], count: 1, method: 'mean', inputs: { [ev.id]: ev.updatedAt } }, updatedAt: now() }); eq((await put('head', 'cycles', cons, c.updatedAt)).status, 200);
  const appr = Object.assign({}, cons, { status: 'approved', approvedBy: U.waqf, approvedAt: now(), consequence: 'improvement', updatedAt: now() }); eq((await put('waqf', 'cycles', appr, cons.updatedAt)).status, 200);
  eq((await put('head', 'cycles', Object.assign({}, appr, { consolidated: Object.assign({}, appr.consolidated, { total: 9.8, rating: 'excellent' }), updatedAt: now() }), appr.updatedAt)).status, 403, 'section head rewrote an approved result');
  eq((await put('head', 'cycles', Object.assign({}, appr, { status: 'closed', updatedAt: now() }), appr.updatedAt)).status, 403, 'approved → closed by a section head');
  const evNow = (await load('head')).evaluations.find(x => x.id === ev.id);
  eq((await put('head', 'evaluations', Object.assign({}, evNow, { status: 'returned', returnedNote: 'x', returnedBy: U.head, updatedAt: now() }), evNow.updatedAt)).status, 403, 'evaluation returned on a locked cycle');
  const obj = Object.assign({}, appr, { objection: { date: '2026-10-28', text: 'تظلم', recordedBy: U.head }, updatedAt: now() }); eq((await put('head', 'cycles', obj, appr.updatedAt)).status, 200, 'objection recorded');
  const decided = by => Object.assign({}, obj, { objection: Object.assign({}, obj.objection, { outcome: 'rejected', decision: 'رفض', decidedBy: by, decidedAt: now() }), updatedAt: now() });
  eq((await put('head', 'cycles', decided(U.head), obj.updatedAt)).status, 403, 'section head decided an objection');
  eq((await put('waqf', 'cycles', decided(U.waqf), obj.updatedAt)).status, 200, 'approver decides the objection');
});
await t('an outdated consolidation is refused, can be redone, and locks the evidence once approved', async () => {
  const cy = { id: randomUUID(), contractId: k1.id, type: 'interim', label: 'دورة إعادة التوحيد', status: 'open', method: 'mean', excluded: [], evalWeights: {} }; eq((await put('head', 'cycles', cy)).status, 200);
  const ev = { id: randomUUID(), cycleId: cy.id, contractId: k1.id, evaluatorId: U.eng1, status: 'submitted', scores: { c1_1: { s: 6 } }, computed: { total: 6, axes: [] }, submittedAt: now() }; eq((await put('eng1', 'evaluations', ev)).status, 200);
  const consOf = e => ({ total: e.computed.total, rating: 'acceptable', axes: [], evaluationIds: [e.id], count: 1, method: 'mean', evalWeights: {}, inputs: { [e.id]: e.updatedAt } });
  const c = (await load('head')).cycles.find(x => x.id === cy.id);
  let r = await put('head', 'cycles', Object.assign({}, c, { status: 'consolidated', consolidated: Object.assign(consOf(ev), { inputs: { [ev.id]: '2020-01-01T00:00:00.000Z' } }), updatedAt: now() }), c.updatedAt); eq(r.status, 409, 'consolidation of an older version of the evaluation'); eq(r.body.code, 'stale_inputs');
  const cons = Object.assign({}, c, { status: 'consolidated', consolidated: consOf(ev), updatedAt: now() }); eq((await put('head', 'cycles', cons, c.updatedAt)).status, 200);
  const ret = Object.assign({}, ev, { status: 'returned', returnedNote: 'راجع البند', returnedBy: U.head, updatedAt: now() }); eq((await put('head', 'evaluations', ret, ev.updatedAt)).status, 200, 'returned while consolidated');
  const p = `attachments/${k1.id}/beef0001__دليل.pdf`; eq(await upload(S.eng1, p, Buffer.from('%PDF-1.4 evidence'), 'application/pdf'), 200);
  const att = { id: randomUUID(), contractId: k1.id, cycleId: cy.id, evaluationId: ev.id, itemKey: 'c1_1', path: p, name: 'دليل.pdf', size: 17, mime: 'application/pdf', uploadedBy: U.eng1 }; eq((await put('eng1', 'attachments', att)).status, 200, 'evidence added to a returned evaluation');
  const re = Object.assign({}, ret, { status: 'submitted', scores: { c1_1: { s: 9 } }, computed: { total: 9, axes: [] }, submittedAt: now(), updatedAt: now() }); eq((await put('eng1', 'evaluations', re, ret.updatedAt)).status, 200, 'resubmitted');
  const appr = x => Object.assign({}, x, { status: 'approved', approvedBy: U.waqf, approvedAt: now(), consequence: 'improvement', updatedAt: now() });
  r = await put('waqf', 'cycles', appr(cons), cons.updatedAt); eq(r.status, 409, 'approval of a consolidation made before the resubmission'); eq(r.body.code, 'stale_inputs');
  const redo = Object.assign({}, cons, { consolidated: consOf(re), updatedAt: now() }); eq((await put('head', 'cycles', redo, cons.updatedAt)).status, 200, 're-consolidation of a consolidated cycle');
  const m = Object.assign({}, redo, { method: 'weighted', updatedAt: now() }); eq((await put('head', 'cycles', m, redo.updatedAt)).status, 200, 'method changed after the consolidation');
  eq((await put('waqf', 'cycles', appr(m), m.updatedAt)).status, 409, 'approval after the method changed');
  const back = Object.assign({}, m, { method: 'mean', updatedAt: now() }); eq((await put('head', 'cycles', back, m.updatedAt)).status, 200);
  await load('head'); await load('head');                                    // both server instances now hold the data from just before the approval
  const ok2 = appr(back); eq((await put('waqf', 'cycles', ok2, back.updatedAt)).status, 200, 'approval of the current consolidation');
  for (let i = 1; i <= 2; i++) eq((await fetch(BASE + 'file?path=' + encodeURIComponent(p), { method: 'DELETE', headers: { authorization: 'Bearer ' + S.head } })).status, 403, 'section head deleted the evidence file of a just-approved cycle (request ' + i + ')');
  const p2 = `attachments/${k1.id}/beef0002__لاحق.pdf`; eq(await upload(S.head, p2, Buffer.from('%PDF-1.4 late'), 'application/pdf'), 200);
  eq((await put('head', 'attachments', { id: randomUUID(), contractId: k1.id, cycleId: cy.id, path: p2, name: 'لاحق.pdf', size: 13, mime: 'application/pdf', uploadedBy: U.head })).status, 403, 'evidence added to an approved cycle');
  eq((await rpc('remove', { coll: 'attachments', id: att.id }, S.eng1)).status, 403, 'uploader removed evidence of an approved cycle');
  eq((await rpc('remove', { coll: 'attachments', id: att.id }, S.head)).status, 403, 'section head removed evidence of an approved cycle');
  eq((await fetch(BASE + 'file?path=' + encodeURIComponent(p), { method: 'DELETE', headers: { authorization: 'Bearer ' + S.eng1 } })).status, 403, 'file of an approved cycle deleted directly');
  eq((await download(S.head, p)).status, 200, 'evidence still there');
  const p3 = `attachments/${k1.id}/beef0003__إضافة.pdf`; eq(await upload(S.head, p3, Buffer.from('%PDF-1.4 x'), 'application/pdf'), 200);
  const sneak = x => Object.assign({ id: randomUUID(), contractId: k1.id, evaluationId: ev.id, itemKey: 'c1_1', path: p3, name: 'إضافة.pdf', size: 10, mime: 'application/pdf', uploadedBy: U.head }, x);
  eq((await put('head', 'attachments', sneak({ cycleId: 'nonexistent-cycle' }))).status, 400, 'evidence on the approved evaluation under a made-up cycle');
  const other = { id: randomUUID(), contractId: k1.id, type: 'interim', label: 'دورة أخرى', status: 'open', method: 'mean', excluded: [], evalWeights: {} }; eq((await put('head', 'cycles', other)).status, 200);
  eq((await put('head', 'attachments', sneak({ cycleId: other.id }))).status, 400, 'evidence on the approved evaluation under another open cycle');
  eq((await put('head', 'attachments', sneak({}))).status, 403, 'evidence on the approved evaluation without a cycle');
  const loose = { id: randomUUID(), contractId: k1.id, path: p3, name: 'عام.pdf', size: 10, mime: 'application/pdf', uploadedBy: U.head }; eq((await put('head', 'attachments', loose)).status, 200, 'contract-level document');
  const lr = (await load('head')).attachments.find(a => a.id === loose.id);
  eq((await put('head', 'attachments', Object.assign({}, lr, { evaluationId: ev.id, cycleId: 'bogus-cycle-x', updatedAt: now() }), lr.updatedAt)).status, 400, 'document re-pointed under a made-up cycle');
  eq((await put('head', 'attachments', Object.assign({}, lr, { evaluationId: ev.id, updatedAt: now() }), lr.updatedAt)).status, 403, 'document re-pointed onto the approved evaluation');
});
await t('closing a cycle without approval is for the admin only', async () => {
  const cy = { id: randomUUID(), contractId: k1.id, type: 'interim', label: 'دورة الإقفال', status: 'open', method: 'mean', excluded: [], evalWeights: {} }; eq((await put('head', 'cycles', cy)).status, 200);
  const c = (await load('head')).cycles.find(x => x.id === cy.id);
  eq((await put('waqf', 'cycles', Object.assign({}, c, { status: 'approved', approvedBy: U.waqf, approvedAt: now(), consequence: 'improvement', updatedAt: now() }), c.updatedAt)).status, 400, 'approval without a consolidation');
  eq((await put('head', 'cycles', Object.assign({}, c, { status: 'closed', updatedAt: now() }), c.updatedAt)).status, 403, 'section head closed a cycle');
  eq((await put('waqf', 'cycles', Object.assign({}, c, { status: 'closed', updatedAt: now() }), c.updatedAt)).status, 403, 'approver closed a cycle');
  eq((await put('admin', 'cycles', Object.assign({}, c, { status: 'closed', updatedAt: now() }), c.updatedAt)).status, 200, 'admin closes');
});
await t('an evaluation out for correction blocks consolidation and approval until it is resubmitted or excluded', async () => {
  const cy = { id: randomUUID(), contractId: k1.id, type: 'interim', label: 'دورة الإعادة', status: 'open', method: 'mean', excluded: [], evalWeights: {} }; eq((await put('head', 'cycles', cy)).status, 200);
  const e1 = { id: randomUUID(), cycleId: cy.id, contractId: k1.id, evaluatorId: U.eng1, status: 'submitted', scores: { c1_1: { s: 7 } }, computed: { total: 7, axes: [] }, submittedAt: now() }; eq((await put('eng1', 'evaluations', e1)).status, 200);
  const e2 = { id: randomUUID(), cycleId: cy.id, contractId: k1.id, evaluatorId: U.head, status: 'submitted', scores: { c1_1: { s: 8 } }, computed: { total: 8, axes: [] }, submittedAt: now() }; eq((await put('head', 'evaluations', e2)).status, 200);
  const ret = Object.assign({}, e1, { status: 'returned', returnedNote: 'راجع', returnedBy: U.head, updatedAt: now() }); eq((await put('head', 'evaluations', ret, e1.updatedAt)).status, 200);
  const consOf = es => ({ total: 8, rating: 'good', axes: [], evaluationIds: es.map(e => e.id), count: es.length, method: 'mean', evalWeights: {}, inputs: Object.fromEntries(es.map(e => [e.id, e.updatedAt])) });
  const c0 = (await load('head')).cycles.find(x => x.id === cy.id);
  let r = await put('head', 'cycles', Object.assign({}, c0, { status: 'consolidated', consolidated: consOf([e2]), updatedAt: now() }), c0.updatedAt); eq(r.status, 409, 'consolidation that leaves out the returned evaluation'); eq(r.body.code, 'returned_pending');
  const ex = Object.assign({}, c0, { excluded: [e1.id], excludeReasons: { [e1.id]: 'غادر المقيّم الإدارة' }, updatedAt: now() }); eq((await put('head', 'cycles', ex, c0.updatedAt)).status, 200, 'returned evaluation excluded with a reason');
  const cons = Object.assign({}, ex, { status: 'consolidated', consolidated: consOf([e2]), updatedAt: now() }); eq((await put('head', 'cycles', cons, ex.updatedAt)).status, 200, 'consolidation once it is excluded');
  const inc = Object.assign({}, cons, { excluded: [], updatedAt: now() }); eq((await put('head', 'cycles', inc, cons.updatedAt)).status, 200, 'included again');
  r = await put('waqf', 'cycles', Object.assign({}, inc, { status: 'approved', approvedBy: U.waqf, approvedAt: now(), consequence: 'improvement', updatedAt: now() }), inc.updatedAt); eq(r.status, 409, 'approval while an evaluation is out for correction'); eq(r.body.code, 'returned_pending');
});
await t('a consolidation saved by an earlier version can be approved unless its evaluations changed after it', async () => {
  const mk = label => ({ id: randomUUID(), contractId: k1.id, type: 'interim', label, status: 'consolidated', method: 'mean', excluded: [], evalWeights: {} });
  const cyA = mk('دورة قديمة 1'), cyB = mk('دورة قديمة 2');
  const evA = { id: randomUUID(), cycleId: cyA.id, contractId: k1.id, evaluatorId: U.eng1, status: 'submitted', scores: {}, computed: { total: 7, axes: [] }, submittedAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z' };
  const evB = Object.assign({}, evA, { id: randomUUID(), cycleId: cyB.id, updatedAt: '2026-10-02T09:00:00.000Z' });
  cyA.consolidated = { axes: [], total: 7, rating: 'good', critical: false, count: 1, evaluationIds: [evA.id], method: 'mean', at: '2026-10-01T10:00:00.000Z' };
  cyB.consolidated = Object.assign({}, cyA.consolidated, { evaluationIds: [evB.id] });
  const r0 = await rpc('import', { payload: { cycles: [cyA, cyB], evaluations: [evA, evB] } }, S.admin); eq(r0.status, 200, (r0.body && r0.body.error) || '');
  const d = await load('waqf'); const a = d.cycles.find(x => x.id === cyA.id), b = d.cycles.find(x => x.id === cyB.id);
  const appr = x => Object.assign({}, x, { status: 'approved', approvedBy: U.waqf, approvedAt: now(), consequence: 'improvement', updatedAt: now() });
  eq((await put('waqf', 'cycles', appr(a), a.updatedAt)).status, 200, 'earlier-version consolidation, nothing changed since');
  const r = await put('waqf', 'cycles', appr(b), b.updatedAt); eq(r.status, 409, 'earlier-version consolidation whose evaluation changed after it'); eq(r.body.code, 'stale_inputs');
});
await t('a batch saves several records together or not at all', async () => {
  const c = (await load('admin')).companies.find(x => x.id === comp.id);
  const p = { id: randomUUID(), name: 'مشروع الدفعة', type: 'other', updatedAt: now() }; const c1 = Object.assign({}, c, { notes: 'من الدفعة', updatedAt: now() });
  const r = await rpc('batch', { items: [{ coll: 'projects', rec: p, base: null }, { coll: 'companies', rec: c1, base: c.updatedAt }] }, S.admin); eq(r.status, 200); eq(r.body.patches.length, 2);
  const p2 = { id: randomUUID(), name: 'لن يُحفظ', type: 'other', updatedAt: now() };
  const r2 = await rpc('batch', { items: [{ coll: 'projects', rec: p2, base: null }, { coll: 'companies', rec: Object.assign({}, c1, { notes: 'قديم', updatedAt: now() }), base: c.updatedAt }] }, S.admin);
  eq(r2.status, 409); ok(!(await load('admin')).projects.some(x => x.id === p2.id), 'the first item was saved although the batch failed');
  const l = { id: randomUUID(), contractId: k1.id, type: 'notice', subject: 'خطاب دفعة', to: 'x', bodyHtml: '<p>x</p>', issuedAt: now(), issuedBy: U.admin, updatedAt: now() };
  const r3 = await rpc('batch', { items: [{ coll: 'letters', rec: l, base: null }] }, S.admin); eq(r3.status, 200); ok(r3.body.patches[0] && r3.body.patches[0].refNo, 'letter number in a batch');
  eq((await rpc('batch', { items: [] }, S.admin)).status, 400); eq((await rpc('batch', { items: [{ coll: 'projects', rec: p, base: p.updatedAt }, { coll: 'projects', rec: p, base: p.updatedAt }] }, S.admin)).status, 400, 'duplicate record in one batch');
  eq((await rpc('batch', { items: [{ coll: 'projects', rec: { id: randomUUID(), name: 'x', type: 'other' }, base: null }] }, S.sec)).status, 403, 'follow-up account');
});
await t('letter numbers continue after the highest imported number', async () => {
  const y = new Date().getFullYear(); const prefix = (await load('admin')).settings.letterRefPrefix || '';
  const imported = [900, 901, 902].map(n => ({ id: randomUUID(), contractId: k1.id, type: 'notice', subject: 'خطاب أوفلاين ' + n, to: 'x', bodyHtml: '<p>x</p>', refNo: `${prefix}${y}/${n}`, issuedAt: now() }));
  eq((await rpc('import', { payload: { letters: imported } }, S.admin)).status, 200);
  const r = await put('admin', 'letters', { id: randomUUID(), contractId: k1.id, type: 'notice', subject: 'بعد الاستيراد', to: 'x', bodyHtml: '<p>x</p>', issuedAt: now(), issuedBy: U.admin }); eq(r.status, 200);
  ok(/\/903$/.test(r.body.patch.refNo), 'next number ' + r.body.patch.refNo);
});
await t('malformed records are refused before they can break other users\' screens', async () => {
  const cy = { id: randomUUID(), contractId: k1.id, type: 'final', label: 'x', status: 'open', method: 'mean', excluded: [], evalWeights: {} };
  eq((await put('eng1', 'cycles', Object.assign({}, cy, { dueDate: { toString: 1 } }))).status, 400, 'object as a date');
  eq((await put('head', 'companies', { id: randomUUID(), name_ar: { toString: 1 }, roles: ['contractor'] })).status, 400, 'object as a name');
  eq((await put('head', 'companies', { id: randomUUID(), roles: ['contractor'] })).status, 400, 'company without a name');
  eq((await put('head', 'companies', { id: randomUUID(), name_ar: 'شركة', roles: ['contractor'], extra: { nested: { constructor: 1 } } })).status, 400, 'prototype key in a nested object');
  eq((await rpc('put', { coll: 'projects', rec: JSON.parse('{"id":"' + randomUUID() + '","name":"x","__proto__":{"admin":true}}') }, S.head)).status, 400, '__proto__ key');
  eq((await put('eng1', 'evaluations', { id: randomUUID(), cycleId: cy1.id, contractId: k1.id, evaluatorId: U.eng1, status: 'draft', scores: { c1_1: { s: '7' } } })).status, 400, 'score as text');
  const evBad = x => Object.assign({ id: randomUUID(), cycleId: cy1.id, contractId: k1.id, evaluatorId: U.eng1, status: 'draft', scores: {} }, x);
  let r = await put('eng1', 'evaluations', evBad({ computed: { total: 5, axes: [null] } })); eq(r.status, 400, 'empty axis in the result'); ok(/نتيجة غير صالحة/.test(r.body.error), r.body.error);
  eq((await put('eng1', 'evaluations', evBad({ computed: { total: 5, axes: [{ key: 'a1', score: 5, items: 'x' }] } }))).status, 400, 'result items not a list');
  eq((await put('eng1', 'evaluations', evBad({ id: 'constructor' }))).status, 400, 'record id constructor');
  eq((await rpc('batch', { items: [{ coll: 'projects', rec: { id: 'hasOwnProperty', name: 'x', type: 'other' }, base: null }] }, S.head)).status, 400, 'record id hasOwnProperty in a batch');
  r = await put('eng1', 'evaluations', evBad({ scores: { constructor: { s: 5 } } })); eq(r.status, 400, 'constructor as a question key'); ok(/constructor/.test(r.body.error), r.body.error);
  r = await put('eng1', 'evaluations', evBad({ scores: { c1_1: { s: 5, n: 'x'.repeat(10001) } } })); eq(r.status, 400, 'note over 10000 characters'); ok(/10000/.test(r.body.error) && /c1_1/.test(r.body.error), r.body.error);
  eq((await put('head', 'cycles', Object.assign({}, cy, { id: randomUUID(), consolidated: { total: 5, axes: [], inputs: { 'not an id!': 'x' } } }))).status, 400, 'consolidation fingerprint with a bad key');
  const t0 = (await load('waqf')).templates[0];
  eq((await put('waqf', 'templates', Object.assign({}, t0, { id: randomUUID(), version: 99, axes: [Object.assign({}, t0.axes[0], { items: [Object.assign({}, t0.axes[0].items[0], { key: '__proto__' })] })] }))).status, 400, 'question key __proto__');
  eq((await put('waqf', 'templates', Object.assign({}, t0, { id: randomUUID(), version: 99, axes: [Object.assign({}, t0.axes[0], { key: 'Bad Key' })] }))).status, 400, 'axis key with spaces');
  eq((await put('waqf', 'templates', Object.assign({}, t0, { id: randomUUID(), version: 99, axes: [Object.assign({}, t0.axes[0], { key: 'constructor' })] }))).status, 400, 'axis key constructor');
  eq((await rpc('settings', { settings: JSON.parse('{"appName":"x","__proto__":{"polluted":1}}') }, S.admin)).status, 400, 'settings with __proto__');
});
await t('the logout audit entry ignores text sent by the browser', async () => {
  eq((await rpc('audit', { entry: { action: 'logout', entity: '=1+1', entityId: '=HYPERLINK("http://x.invalid")', detail: { name: '=2+3' } } }, S.sec)).status, 200);
  const e = JSON.parse((await rpc('export', {}, S.admin)).body.json); const last = e.audit.filter(a => a.action === 'logout' && a.actor === U.sec).pop();
  ok(last, 'logout entry missing'); eq(last.entity, 'users'); eq(last.entityId, U.sec); eq(last.detail, null);
});
await t('a restarted server reads the persisted state', async () => {
  stop(); await new Promise(r => setTimeout(r, 500));
  const s2 = spawn(process.execPath, ['dev/server.mjs', '--port', String(PORT), '--data', dataDir], { cwd: root, stdio: 'ignore' }); process.on('exit', () => { try { s2.kill(); } catch (e) { } });
  for (let i = 0; i < 50; i++) { try { const r = await fetch(BASE + 'health'); if (r.ok) break; } catch (e) { } await new Promise(r => setTimeout(r, 200)); }
  eq((await rpc('login', { username: 'admin', password: 'Admin#2027' })).status, 200, 'session secret differs per process, but the password persists');
  s2.kill();
});
stop();
console.log(`\n${pass} passed, ${fail} failed`); if (fail) { console.log(failures.join('\n')); if (srvErr) console.log('server stderr:\n' + srvErr.slice(-2000)); process.exit(1); }
