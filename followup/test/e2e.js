/* اختبار شامل لبرنامج المتابعة في المتصفح: node test/e2e.js
   يشغّل خادماً محلياً للملفات، ثم يمرّ بالرحلة كاملة في وضع المتصفح، ثم يعيد أهمها في وضع المجلد (على OPFS). */
const { chromium } = require('playwright');
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', 'app');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let pass = 0; const fails = [];
const ok = (c, name) => { if (c) pass++; else { fails.push(name); console.log('  ✗ ' + name); } };

(async () => {
  const server = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const errors = [];
  const newPage = async (ctx) => { const p = await ctx.newPage(); p.on('pageerror', e => errors.push('pageerror: ' + e.message)); p.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); }); return p; };
  const text = (p, sel) => p.locator(sel).innerText();
  const toast = async (p, re) => { await p.waitForFunction(r => [...document.querySelectorAll('.toast')].some(t => new RegExp(r).test(t.textContent)), re.source, { timeout: 5000 }); };
  async function login(p, user, pw) { await p.fill('input[name=username]', user); await p.fill('input[name=password]', pw); await p.click('form[data-form=login] button'); }
  async function firstLogin(p, user, pw) {
    await login(p, user, '123456'); await p.waitForSelector('form[data-form=password]');
    await p.fill('input[name=next]', pw); await p.fill('input[name=again]', pw); await p.click('form[data-form=password] button'); await p.waitForSelector('.tiles');
  }
  const logout = async p => { await p.click('[data-act=logout]'); await p.waitForSelector('form[data-form=login]'); };
  const daysAgo = n => { const d = new Date(Date.now() - n * 864e5); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

  /* ===== 1) وضع المتصفح ===== */
  console.log('وضع المتصفح');
  let ctx = await browser.newContext({ locale: 'ar', acceptDownloads: true }); let p = await newPage(ctx);
  await p.goto(base); await p.click('[data-act=useLocal]'); await p.waitForSelector('form[data-form=login]');
  await login(p, 'nobody', '123456'); await toast(p, /اسم المستخدم غير موجود/); ok(true, 'unknown user rejected');
  await login(p, 'fhussni', 'wrong'); await toast(p, /كلمة المرور غير صحيحة/); ok(true, 'wrong password rejected');
  await login(p, 'FHussni@awqaf.gov.qa', '123456'); await p.waitForSelector('form[data-form=password]'); ok(true, 'login with email form + forced change');
  await p.goto(base + '#/register'); await p.waitForSelector('form[data-form=password]'); ok(true, 'cannot skip forced password change');
  for (const [pw, re] of [['12345', /أقل من 6/], ['123456', /غير كلمة المرور الأولية/]]) { await p.fill('input[name=next]', pw); await p.fill('input[name=again]', pw); await p.click('form[data-form=password] button'); await toast(p, re); }
  await p.fill('input[name=next]', 'aaaaaa'); await p.fill('input[name=again]', 'aaaaab'); await p.click('form[data-form=password] button'); await toast(p, /لا يطابق/);
  await p.fill('input[name=next]', 'aaaaaa'); await p.fill('input[name=again]', 'aaaaaa'); await p.click('form[data-form=password] button'); await p.waitForSelector('.tiles');
  ok((await text(p, '.who')).includes('مدير البرنامج'), 'admin home');
  ok(await p.locator('nav.tabs a[href="#/settings"]').count() === 1, 'admin sees settings');

  // كتاب جديد محال إلى ثلاث إدارات، بتاريخ قديم ليظهر التأخر
  await p.click('[data-act=newLetter]'); await p.waitForSelector('.modal-box');
  await p.fill('textarea[name=subject]', 'متابعة الخطة الاستراتيجية 2025-2030 للربع الأول'); await p.fill('input[name=number]', '1234'); await p.fill('input[name=date]', daysAgo(20));
  await p.fill('input[name=from]', 'مكتب الوزير'); await p.selectOption('select[name=priority]', 'urgent');
  await p.setInputFiles('input[name=files]', { name: 'كتاب.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  for (const d of ['dept-2', 'dept-3', 'dept-4']) await p.check(`input[name=d_${d}]`);
  await p.fill('input[name=days_dept-2]', '7'); await p.fill('input[name=days_dept-3]', '30'); await p.fill('input[name=days_dept-4]', '21');
  await p.selectOption('select[name=fol_dept-2]', 'u-aabakr');
  await p.click('.modal-box button[type=submit]'); await p.waitForSelector('.letter-head');
  ok(await p.locator('section.task').count() === 3, 'letter has 3 assignments');
  ok((await text(p, 'section.task >> nth=0')).includes('متأخر 13 يوماً'), 'overdue computed (20 days ago, 7 days)');
  ok((await text(p, 'section.task >> nth=2')).includes('باقٍ'), 'near-due badge');
  ok((await text(p, '.letter-head')).includes('كتاب.pdf'), 'attachment listed');
  const letterUrl = p.url();

  // رقم مكرر في السنة نفسها يطلب تأكيداً
  await p.goto(base + '#/register'); await p.click('[data-act=newLetter]'); await p.fill('textarea[name=subject]', 'كتاب ثانٍ'); await p.fill('input[name=number]', '1234');
  await p.click('.modal-box button[type=submit]'); await p.waitForSelector('.modal-layer >> nth=1'); ok((await text(p, '.modal-layer >> nth=1')).includes('مسجّل من قبل'), 'duplicate number warns');
  await p.click('.modal-layer >> nth=1 >> [data-m=cancel]'); await p.fill('input[name=number]', '9'); await p.click('.modal-box button[type=submit]'); await p.waitForSelector('.letter-head');
  ok((await text(p, 'main')).includes('لم يُحَل هذا الكتاب'), 'unassigned letter page');
  // إحالة لاحقة ثم تعديل موعدها
  await p.click('[data-act=addTask]'); await p.selectOption('select[name=deptId]', 'dept-5'); await p.fill('input[name=days]', '3'); await p.click('.modal-box button[type=submit]'); await p.waitForSelector('section.task');
  await p.click('[data-act=editTask]'); await p.fill('input[name=days]', '10'); await p.click('.modal-box button[type=submit]'); await p.waitForSelector('.timeline');
  ok((await text(p, '.timeline')).includes('تعديل الموعد: المدة المتوقعة من 3 إلى 10'), 'deadline change logged in timeline');

  // السجل: الدمج بالصفوف، التصفية، البحث
  await p.goto(base + '#/register'); await p.waitForSelector('table.reg');
  ok(await p.locator('table.reg td[rowspan="3"]').count() === 4, 'letter cells span 3 rows');
  ok(await p.locator('table.reg tbody tr').count() === 4, 'register rows');
  await p.selectOption('select[data-k=status]', 'overdue'); ok(await p.locator('table.reg tbody tr').count() === 1, 'overdue filter');
  await p.selectOption('select[data-k=status]', ''); await p.selectOption('select[data-k=dept]', 'dept-3'); ok(await p.locator('table.reg tbody tr').count() === 1, 'dept filter');
  await p.click('[data-act=clearFilters]'); await p.fill('input[type=search]', 'الاستراتيجيه'); await p.waitForTimeout(400); ok(await p.locator('table.reg tbody tr').count() === 3, 'search ignores ة/ه');
  await p.fill('input[type=search]', ''); await p.waitForTimeout(300);

  // مستخدم جديد بصلاحية اطلاع فقط على إدارة
  await p.goto(base + '#/settings'); await p.click('[data-t=users]'); await p.click('button[data-act=editUser]:not([data-id])');
  await p.fill('input[name=name]', 'مدير إدارة الاستثمار'); await p.fill('input[name=username]', 'InvMgr'); await p.selectOption('select[name=role]', 'dviewer');
  await p.click('.modal-box button[type=submit]'); await toast(p, /اختر إدارة المستخدم/);
  await p.selectOption('select[name=deptId]', 'dept-2'); await p.click('.modal-box button[type=submit]'); await p.waitForSelector('.modal-layer', { state: 'detached' });
  ok((await text(p, 'main')).includes('invmgr'), 'user added (username lowercased)');
  await p.click('[data-t=general]'); await p.waitForSelector('form[data-form=general]'); await p.click('[data-t=data]'); await p.click('[data-t=audit]'); ok((await text(p, 'main')).includes('تسجيل كتاب'), 'audit lists actions');
  await logout(p);

  // ممثل إدارة الاستثمار: يرى كتب إدارته فقط
  await firstLogin(p, 'aalqadhi', 'rep-pass');
  ok((await text(p, '.who')).includes('إدارة الاستثمار'), 'rep header shows dept');
  ok(await p.locator('nav.tabs a[href="#/settings"]').count() === 0, 'rep has no settings');
  ok((await text(p, 'main')).includes('بانتظار تأكيد استلام المذكرة (1)'), 'rep sees pending receipt');
  await p.goto(base + '#/settings'); await p.waitForSelector('.tiles'); ok(true, 'rep redirected from settings');
  await p.goto(base + '#/register'); await p.waitForSelector('table.reg'); ok(await p.locator('table.reg tbody tr').count() === 1, 'rep sees only own dept rows');
  ok(await p.locator('select[data-k=dept]').count() === 0 && await p.locator('[data-act=newLetter]').count() === 0, 'rep has no dept filter / new letter');
  await p.goto(letterUrl); await p.waitForSelector('section.task'); ok(await p.locator('section.task').count() === 1, 'rep sees only own assignment');
  ok(await p.locator('[data-act=editLetter],[data-act=delTask],[data-act=editTask]').count() === 0, 'rep cannot edit letter/assignment');
  await p.click('[data-act=confirmReceipt]'); await toast(p, /تم تأكيد الاستلام/); await p.waitForSelector('.timeline');
  ok((await text(p, 'section.task')).includes('تحت الإجراء'), 'receipt → in progress');
  // إفادة أولى، ثم محاولة «يوجد مشكلة» بلا نص، ثم إنجاز
  await p.click('[data-act=addUpdate]'); await p.fill('textarea[name=text]', 'تم إعداد الكتاب بانتظار توقيع المدير'); await p.click('.modal-box button[type=submit]'); await toast(p, /تم الحفظ/);
  await p.click('[data-act=addUpdate]'); await p.selectOption('select[name=status]', 'problem'); await p.click('.modal-box button[type=submit]'); await toast(p, /اذكر السبب/);
  await p.selectOption('select[name=status]', 'done'); ok(await p.locator('.done-date:not(.hidden)').count() === 1, 'done date appears');
  await p.fill('textarea[name=text]', 'تم الرد'); await p.fill('input[name=replyNo]', '66375/2026'); await p.click('.modal-box button[type=submit]'); await p.waitForSelector('.modal-layer', { state: 'detached' });
  await p.waitForFunction(() => document.querySelector('section.task').innerText.includes('تم التنفيذ'));
  const tsk = await text(p, 'section.task'); ok(tsk.includes('أُنجز متأخراً 13 يوماً') && tsk.includes('66375/2026'), 'done late + reply number');
  // ممثل لا يصل إلى كتاب ليس لإدارته
  const other = await p.evaluate(() => FU.list('letters').find(l => l.number === '9').id);
  await p.goto(base + '#/letter/' + other); await p.waitForSelector('.card.empty'); ok((await text(p, 'main')).includes('غير موجَّه إلى إدارتك'), 'rep blocked from other letter');
  await logout(p);

  // مطّلع الإدارة: اطلاع فقط
  await firstLogin(p, 'invmgr', 'viewer1'); await p.goto(letterUrl); await p.waitForSelector('section.task');
  ok(await p.locator('section.task').count() === 1 && await p.locator('section.task [data-act]:not([data-act=openFile])').count() === 0, 'dept viewer read-only');
  await logout(p);

  // المدير العام: يرى الكل ويضيف توجيهاً ولا يعدّل
  await firstLogin(p, 'halmarzoogi', 'dg-pass1');
  ok((await text(p, 'main')).includes('ملخص الإدارات'), 'viewer sees dept summary');
  await p.goto(letterUrl); await p.waitForSelector('section.task'); ok(await p.locator('section.task').count() === 3, 'viewer sees all assignments');
  ok(await p.locator('[data-act=editLetter],[data-act=editTask],[data-act=confirmReceipt],[data-act=newLetter]').count() === 0, 'viewer cannot edit');
  await p.click('section.task >> nth=1 >> [data-act=addUpdate]'); ok(await p.locator('select[name=status]').count() === 0, 'viewer cannot change status');
  await p.fill('textarea[name=text]', 'يُستعجل الرد'); await p.click('.modal-box button[type=submit]'); await toast(p, /تم الحفظ/); ok((await text(p, 'section.task >> nth=1')).includes('توجيه'), 'directive added');
  // التقارير والتصدير
  await p.goto(base + '#/print/register'); await p.waitForSelector('.sheet table.reg'); ok((await text(p, '.sheet')).includes('تقرير متابعة الكتب والتكليفات'), 'register report');
  await p.goto(base + '#/print/summary'); await p.waitForSelector('.sheet'); ok((await text(p, '.sheet')).includes('ملخص الإدارات'), 'summary report');
  await p.goto(letterUrl.replace('#/letter/', '#/print/letter/')); await p.waitForSelector('.sheet'); ok((await text(p, '.sheet')).includes('بطاقة متابعة كتاب') && (await text(p, '.sheet')).includes('66375/2026'), 'letter card');
  await p.goto(base + '#/register'); await p.waitForSelector('table.reg');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.click('[data-act=exportCsv]')]); const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(csv.split('\r\n').length === 5 && csv.includes('"66375/2026"') === false && csv.includes('تم الرد'), 'csv export rows');
  await logout(p);

  // مسؤول المتابعة: يعيد الفتح، ويحذف
  await firstLogin(p, 'aabakr', 'officer1'); await p.goto(letterUrl); await p.waitForSelector('section.task');
  await p.click('section.task >> nth=0 >> [data-act=addUpdate]'); await p.selectOption('select[name=status]', 'in_progress'); await p.fill('textarea[name=text]', 'أُعيد الفتح لاستكمال المرفقات'); await p.click('.modal-box button[type=submit]'); await toast(p, /تم الحفظ/);
  ok((await text(p, 'section.task >> nth=0')).includes('3 إفادات دون إنجاز'), 'escalation flag after 3 updates');
  await p.goto(base + '#/home'); await p.waitForSelector('.tiles'); ok((await text(p, '.tile >> nth=1')).startsWith('1'), 'overdue tile count');
  await p.goto(letterUrl); await p.waitForSelector('section.task'); await p.click('section.task >> nth=2 >> [data-act=delTask]'); await p.click('.modal-layer button[type=submit]'); await toast(p, /تم حذف الإحالة/);
  ok(await p.locator('section.task').count() === 2, 'assignment deleted');
  await p.click('[data-act=delLetter]'); await p.click('.modal-layer button[type=submit]'); await p.waitForSelector('#reg-out');
  ok(await p.evaluate(() => FU.db().letters.length === 1 && FU.db().tasks.length === 1 && FU.db().updates.length === 1 && Object.keys(FU.state.store.files).length === 0), 'letter delete cascades');
  await ctx.close();

  /* ===== 2) وضع المجلد (OPFS بديلاً عن مجلد دروب بوكس) ===== */
  console.log('وضع المجلد');
  ctx = await browser.newContext({ locale: 'ar' }); await ctx.addInitScript(() => { window.__root = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('P1', { create: true }); window.showDirectoryPicker = () => window.__root(); });
  p = await newPage(ctx); await p.goto(base); await p.click('[data-act=pickFolder]'); await p.waitForSelector('form[data-form=login]');
  await firstLogin(p, 'shallaby', 'folder1'); ok((await text(p, '.store-info')).includes('مجلد مشترك'), 'folder mode');
  await p.click('[data-act=newLetter]'); await p.fill('textarea[name=subject]', 'متطلبات من الإدارة العامة'); await p.fill('input[name=number]', '14055');
  await p.setInputFiles('input[name=files]', { name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 x') });
  await p.check('input[name=d_dept-2]'); await p.click('.modal-box button[type=submit]'); await p.waitForSelector('section.task');
  const files = await p.evaluate(async () => { const out = []; async function walk(d, pre) { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, pre + n + '/'); else out.push(pre + n); } } await walk(await window.__root(), ''); return out; });
  ok(files.includes('data/settings.json') && files.filter(f => f.startsWith('data/letters/')).length === 1 && files.filter(f => f.startsWith('data/tasks/')).length === 1 && files.filter(f => f.startsWith('data/users/')).length === 10 && files.some(f => /^data\/files\/.+__scan\.pdf$/.test(f)) && files.some(f => f.startsWith('data/audit/')), 'folder layout: one file per record');
  // ملاحظة: استرجاع مقبض OPFS من IndexedDB يُسقط متصفح الاختبار (headless shell)، فلا تُختبر هنا إعادة فتح الصفحة على المجلد المحفوظ.
  // زميل عدّل الملف على القرص بعد تحميلنا: الحفظ يُرفض وتُحمَّل أحدث نسخة
  await p.goto(base + '#/register'); await p.click('table.reg a'); await p.waitForSelector('section.task');
  await p.evaluate(async () => { const t = FU.db().tasks[0]; const root = await window.__root(); const d = await (await root.getDirectoryHandle('data')).getDirectoryHandle('tasks'); const w = await (await d.getFileHandle(t.id + '.json')).createWritable(); await w.write(JSON.stringify(Object.assign({}, t, { status: 'problem', updatedAt: '2099-01-01T00:00:00.000Z' }))); await w.close(); });
  await p.click('[data-act=editTask]'); await p.fill('input[name=days]', '15'); await p.click('.modal-box button[type=submit]'); await toast(p, /عدّل زميل هذا السجل/);
  await p.waitForFunction(() => document.querySelector('section.task') && document.querySelector('section.task').innerText.includes('يوجد مشكلة')); ok(true, 'stale write rejected, fresh data loaded');
  // ملف «نسخة متعارضة» من دروب بوكس يُتجاهل ويُعدّ
  await p.evaluate(async () => { const root = await window.__root(); const d = await (await root.getDirectoryHandle('data')).getDirectoryHandle('letters'); const w = await (await d.getFileHandle("x (Sultan's conflicted copy 2026-11-17).json", { create: true })).createWritable(); await w.write('{"id":"zzz","subject":"dup"}'); await w.close(); });
  await p.click('[data-act=reload]'); await toast(p, /تم تحديث البيانات/); ok(await p.evaluate(() => FU.db().letters.length === 1 && FU.state.store.conflicts === 1), 'conflicted copy ignored');
  // اكتشاف ما أضافه زميل دون ضغط «تحديث»
  await p.goto(base + '#/home'); await p.waitForSelector('.tiles');
  await p.evaluate(async () => { const root = await window.__root(); const d = await (await root.getDirectoryHandle('data')).getDirectoryHandle('letters'); const w = await (await d.getFileHandle('ext-1.json', { create: true })).createWritable(); await w.write(JSON.stringify({ id: 'ext-1', seq: 2, subject: 'كتاب من زميل', number: '77', date: FU.today(), files: [], updatedAt: FU.nowISO() })); await w.close(); });
  await p.evaluate(() => window.dispatchEvent(new Event('focus'))); await p.waitForFunction(() => FU.db().letters.length === 2, null, { timeout: 5000 }); ok(true, 'colleague change picked up automatically');
  await ctx.close();

  /* ===== 3) الفتح من ملف مباشرة (file://) ===== */
  ctx = await browser.newContext({ locale: 'ar' }); p = await newPage(ctx); await p.goto('file://' + path.join(ROOT, 'index.html')); await p.waitForSelector('[data-act=useLocal]');
  await p.click('[data-act=useLocal]'); await p.waitForSelector('form[data-form=login]'); await firstLogin(p, 'mazin', 'file-pw'); ok((await text(p, '.who')).includes('إدارة المصارف الوقفية'), 'works from file://');
  await ctx.close();

  await browser.close(); server.close();
  ok(errors.length === 0, 'no console errors: ' + errors.slice(0, 5).join(' | '));
  console.log(`\n${pass} passed, ${fails.length} failed`); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
