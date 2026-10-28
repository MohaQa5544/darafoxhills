/* يجهّز نسخة GitHub Pages من البرنامج في مجلد docs/ أعلى المستودع (ملفات ثابتة فقط، بلا خادم):
   - تعمل كالنسخة الأوفلاين تماماً: البيانات في مجلد دروب بوكس المشترك (Chrome أو Edge على الحاسوب) أو في المتصفح نفسه،
     ولا يُرسل شيء منها إلى GitHub.
   - لا تُنشر قائمة الموظفين (users.local.js) ولا ملفات الخادم.
   - تُضاف سياسة أمان المحتوى في الصفحة نفسها لأن GitHub Pages لا يرسل رؤوس vercel.json.
   الاستخدام: node dev/build-pages.mjs   ثم ارفع مجلد docs/ وفعّل Pages من إعدادات المستودع (الفرع، المجلد /docs). */
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '../app'); const out = path.resolve(here, '../../docs');
const FILES = ['logos.js', 'bank.js', 'texts.js', 'store.js', 'core.js', 'screens.js', 'eval.js', 'review.js', 'reports.js', 'settings.js', 'boot.js', 'app.css', 'brand/letterhead_portrait_a4.jpg', 'brand/background_landscape_a4.jpg'];
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";

rmSync(out, { recursive: true, force: true }); mkdirSync(path.join(out, 'brand'), { recursive: true });
for (const f of FILES) { if (!existsSync(path.join(app, f))) throw new Error('missing ' + f); copyFileSync(path.join(app, f), path.join(out, f)); }
let html = readFileSync(path.join(app, 'index.html'), 'utf8');
if (!html.includes('<script src="users.local.js"></script>')) throw new Error('index.html changed: users.local.js tag not found');
html = html.replace('<script src="users.local.js"></script>\n', '').replace('<meta charset="utf-8">', `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer" content="no-referrer">`);
if (/users\.local/.test(html)) throw new Error('users.local.js still referenced');
writeFileSync(path.join(out, 'index.html'), html);
writeFileSync(path.join(out, '.nojekyll'), '');                                   // تُقدَّم الملفات كما هي دون معالجة Jekyll
console.log('GitHub Pages build ->', out, '(' + (FILES.length + 1) + ' files)');
