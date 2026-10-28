// اختبارات واجهة الخادم السحابي: الدخول، الصلاحيات، حجب تقييمات الزملاء، التعارض، التزامن بين نسختين، المرفقات، الاستيراد
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)); const root = path.resolve(here, '..');
const PORT = 8790; const BASE = `http://localhost:${PORT}/api/`;
const dataDir = mkdtempSync(path.join(os.tmpdir(), 'ev-api-'));
const srv = spawn(process.execPath, ['dev/server.mjs', '--port', String(PORT), '--data', dataDir, '--reset', '--instances', '2', '--audit-keep', '40'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const cons = Object.assign({}, c, { status: 'consolidated', consolidated: { total: 7.5, rating: 'good', axes: [] }, reviewedBy: U.head, updatedAt: now() }); eq((await put('head', 'cycles', cons, c.updatedAt)).status, 200);
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
  const eng1now = await rpc('login', { username: 'eng1', password: 'Eng1#2026' }); eq(eng1now.status, 200, 'eng1 keeps online password');
});
await t('audit log rotates into archives and export still returns it all', async () => {
  const files = readdirSync(path.join(dataDir, 'ev', 'audit')).filter(f => f.endsWith('.gz')); ok(files.length >= 1, 'no audit archive');
  const e = JSON.parse((await rpc('export', {}, S.admin)).body.json); ok(e.audit.length > 40, 'export audit ' + e.audit.length);
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
