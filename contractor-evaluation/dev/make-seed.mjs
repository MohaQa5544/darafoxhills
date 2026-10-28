/* يحضّر قائمة المستخدمين الأولية للنسخة السحابية من ملف المستخدمين (app/users.local.js أو ملف JSON):
   - يولّد لكل مستخدم كلمة مرور مؤقتة فريدة، ويكتب تجزئاتها فقط (PBKDF2) في seed-users.local.json
     — هذا هو محتوى متغير البيئة SEED_USERS على Vercel.
   - ويكتب كلمات المرور المؤقتة نفسها في credentials.local.json لتسليمها لأصحابها بشكل خاص.
   الملفان ينتهيان بـ .local. فلا يدخلان المستودع (.gitignore). لا ترسل credentials.local.json لأحد غير أصحابه.
   الاستخدام: node dev/make-seed.mjs [app/users.local.js] [--out مجلد] */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { hashPassword, tempPassword, seedProblem } from '../app/lib/core.mjs';

const args = process.argv.slice(2); const oi = args.indexOf('--out');
const outDir = path.resolve(oi >= 0 ? args[oi + 1] : '.'); const src = args.find((a, i) => !a.startsWith('--') && i !== oi + 1) || 'app/users.local.js';
const text = readFileSync(src, 'utf8');
let users;
if (/\.json$/i.test(src)) users = JSON.parse(text);
else { const sb = { window: {} }; vm.runInNewContext(text, sb, { timeout: 2000 }); users = sb.window.EV_SEED_USERS; }
if (!Array.isArray(users) || !users.length) { console.error('لم أجد قائمة مستخدمين في ' + src); process.exit(1); }

const seed = [], sheet = [];
for (const u of users) {
  const pw = tempPassword(); const h = await hashPassword(pw);
  seed.push({ username: String(u.username).trim(), name: u.name || u.username, email: u.email || '', role: u.role, algo: h.algo, salt: h.salt, iter: h.iter, hash: h.hash });
  sheet.push({ name: u.name || u.username, username: String(u.username).trim(), email: u.email || '', role: u.role, password: pw });
}
const problem = seedProblem(seed); if (problem) { console.error('القائمة غير صالحة: ' + problem); process.exit(1); }
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'seed-users.local.json'), JSON.stringify(seed));
writeFileSync(path.join(outDir, 'credentials.local.json'), JSON.stringify(sheet, null, 1));
console.log(`${seed.length} مستخدم. SEED_USERS: ${path.join(outDir, 'seed-users.local.json')} (${Buffer.byteLength(JSON.stringify(seed))} بايت)`);
console.log(`كلمات المرور المؤقتة (سرية): ${path.join(outDir, 'credentials.local.json')}`);
