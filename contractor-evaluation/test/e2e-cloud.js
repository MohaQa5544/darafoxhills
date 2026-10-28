// اختبار شامل للنسخة السحابية في متصفح Chromium: خادم محلي بنسختين ومحرك تخزين يحاكي Vercel Blob
const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
const { spawn } = require('child_process');
const PORT = 8791; const URL = `http://localhost:${PORT}/`;
const shots = path.join(__dirname, 'shots', 'cloud'); fs.mkdirSync(shots, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-e2e-'));
const srv = spawn(process.execPath, ['dev/server.mjs', '--port', String(PORT), '--data', dataDir, '--reset', '--instances', '2'], { cwd: path.resolve(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe'] });
let srvLog = ''; srv.stdout.on('data', d => srvLog += d); srv.stderr.on('data', d => srvLog += d);
process.on('exit', () => { try { srv.kill(); } catch (e) { } });
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ev-fix-'));
const pdfFile = { name: 'محضر الإقرار.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n') };
const pngFile = { name: 'صورة الموقع.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };
const htmlFile = { name: 'evil.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') };
const bigFile = { name: 'ملف كبير.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4 * 1024 * 1024 + 100) };

(async () => {
  for (let i = 0; i < 60; i++) { try { const r = await fetch(URL + 'api/health'); if (r.ok) break; } catch (e) { } await new Promise(r => setTimeout(r, 200)); }
  const browser = await chromium.launch();
  const newCtx = () => browser.newContext({ viewport: { width: 1360, height: 900 }, locale: 'ar-QA', acceptDownloads: true });
  const ctx = await newCtx(); const page = await ctx.newPage();
  const errors = []; let quiet = false;                                       // quiet: خلال الأعطال المقصودة في الاختبار
  const watch = (pg, tag) => { pg.on('pageerror', e => errors.push(tag + ' PAGEERROR: ' + e.message)); pg.on('console', m => { if (quiet) return; const t = m.text(); if (/Content Security Policy|Refused to/.test(t)) errors.push(tag + ' CSP: ' + t); else if (m.type() === 'error' && !/users\.local|fonts\.g|net::ERR|status of 40[0-9]|مستخدم آخر هذا السجل/.test(t)) errors.push(tag + ' CONSOLE: ' + t); }); pg.route('**/users.local.js', r => r.abort()); };
  watch(page, 'A');
  const snap = async (n, pg) => (pg || page).screenshot({ path: path.join(shots, n + '.png'), fullPage: true });
  const step = async (name, fn) => { try { await fn(); console.log('✔', name); } catch (e) { console.log('✘', name, '-', e.message.split('\n')[0]); await snap('FAIL_' + name.replace(/\W+/g, '_')).catch(() => { }); throw e; } };
  const modalOk = async (pg) => { pg = pg || page; await pg.click('#modal [data-m="ok"]'); await pg.waitForTimeout(500); };
  const login = async (u, p, pg) => { pg = pg || page; await pg.waitForSelector('#login-user'); await pg.fill('#login-user', u); await pg.fill('#login-pass', p); await pg.click('form[data-form="login"] button[type=submit]'); await pg.waitForTimeout(700); };
  const changePw = async (pw, pg) => { pg = pg || page; await pg.waitForSelector('form[data-form="password"]'); await pg.fill('input[name=p1]', pw); await pg.fill('input[name=p2]', pw); await pg.click('form[data-form="password"] button[type=submit]'); await pg.waitForTimeout(800); };
  const logout = async (pg) => { pg = pg || page; await pg.click('[data-act="logout"]'); await pg.waitForTimeout(400); };
  const scoreAll = async (val, pg) => { pg = pg || page; await pg.evaluate(v => { document.querySelectorAll('.item').forEach(it => { const b = it.querySelector(`.chip[data-val="${v}"]`); if (b) b.click(); }); }, val); await pg.waitForTimeout(1800); };
  const toastText = pg => (pg || page).evaluate(() => [...document.querySelectorAll('#toast .toast')].map(t => t.textContent).join(' | '));

  await page.goto(URL); await page.waitForTimeout(1200);
  await step('الرابط يفتح شاشة الدخول مباشرة (وضع سحابي)', async () => { await page.waitForSelector('#login-user'); const hint = await page.textContent('.setup-card'); if (!/مدير النظام/.test(hint) || /123456/.test(hint)) throw new Error('نص الدخول السحابي غير صحيح'); if (await page.$('[data-act="changeStore"]')) throw new Error('رابط تغيير مكان البيانات ظاهر'); await snap('00-login'); });
  await step('دخول خاطئ يعطي رسالة موحدة', async () => { await login('admin', 'wrong-pass'); const t = await page.textContent('#login-err'); if (!/غير صحيحة/.test(t)) throw new Error(t); });
  await step('أول دخول بكلمة مؤقتة يفرض التغيير', async () => { await login('admin', 'temp-admin1'); await page.waitForSelector('form[data-form="password"]'); if (await page.$('input[name=p0]')) throw new Error('حقل كلمة المرور الحالية ظاهر في التغيير الإلزامي'); await page.fill('input[name=p1]', 'abc'); await page.fill('input[name=p2]', 'abc'); await page.click('form[data-form="password"] button[type=submit]'); await page.waitForTimeout(300); await changePw('Admin#2026'); await page.waitForSelector('.kpis'); if (!/سحابي/.test(await page.textContent('.store-info'))) throw new Error('شارة السحابي غائبة'); await snap('01-home'); });
  await step('إضافة شركة ومشروع وعقد', async () => {
    await page.click('[data-act="companyForm"]'); await page.waitForSelector('#modal #mf'); await page.fill('#mf input[name=name_ar]', 'شركة البناء الحديث للمقاولات'); await page.fill('#mf input[name=cr_number]', '12345'); await page.check('#mf input[value=contractor]'); await page.fill('#mf input[name=contact_name]', 'م. خالد'); await modalOk(); await page.waitForSelector('.score-card');
    await page.click('a[href="#/projects"]'); await page.waitForTimeout(300); await page.click('[data-act="projectForm"]'); await page.waitForSelector('#modal #mf'); await page.fill('#mf input[name=name]', 'مسجد الوقف – منطقة الوعب'); await page.selectOption('#mf select[name=type]', 'mosque'); await modalOk(); await page.waitForTimeout(300);
    await page.click('[data-act="contractForm"]'); await page.waitForSelector('#modal #mf'); await page.selectOption('#mf select[name=companyId]', { index: 1 }); await page.fill('#mf input[name=contract_no]', 'C-2026-15'); await page.fill('#mf input[name=value]', '4500000'); await page.fill('#mf input[name=durationMonths]', '14'); await page.fill('#mf input[name=start_date]', '2026-11-01'); const ev = await page.$$('#mf input[name="evaluators[]"]'); await ev[3].check(); await ev[4].check(); await modalOk(); await page.waitForSelector('.notice-card');
  });
  await step('إصدار الإخطار وتسجيل الإقرار مع رفع النسخة الموقعة', async () => {
    await page.click('[data-act="issueNotice"]'); await page.waitForSelector('.sheet.letter'); await page.waitForTimeout(500);
    const bg = await page.evaluate(() => { const i = document.querySelector('.only-portrait .bg-img'); return i && i.complete && i.naturalWidth > 0; }); if (!bg) throw new Error('خلفية الورق الرسمي لم تُحمّل');
    await page.goBack(); await page.waitForSelector('.notice-card.issued'); await page.click('[data-act="ackNotice"]'); await page.waitForSelector('#modal #mf'); await page.setInputFiles('#mf input[name=file]', pdfFile); await modalOk(); await page.waitForSelector('.notice-card.acknowledged');
    const [popup] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }), page.click('.notice-card [data-act="openFile"]')]); if (!/^(blob:|about:blank|)$/.test(popup.url().replace(/^(blob:).*/, '$1'))) throw new Error('فُتح عنوان غير متوقع: ' + popup.url()); if (await popup.evaluate(() => { try { return !!window.opener; } catch (e) { return false; } }).catch(() => false)) throw new Error('النافذة الجديدة تصل إلى البرنامج (opener)'); await popup.close();
  });
  await step('فتح دورة وتقييم مدير النظام مع مرفقات', async () => {
    await page.click('[data-act="cycleForm"]'); await page.waitForSelector('#modal #mf'); await page.selectOption('#mf select[name=type]', 'final'); await modalOk(); await page.waitForSelector('[data-act="startEval"]');
    await page.click('[data-act="startEval"]'); await page.waitForSelector('.eval-layout'); await scoreAll(7); await page.click(':nth-match(.item, 1) .chip[data-val="9"]'); await page.fill(':nth-match(.item, 1) textarea.note-in', 'تجاوز المواصفات في خرسانة الأساسات');
    await page.setInputFiles(':nth-match(.item, 1) input[type=file]', [pngFile, htmlFile]); await page.waitForSelector(':nth-match(.item, 1) .att >> nth=1', { timeout: 8000 });
    await page.setInputFiles(':nth-match(.item, 2) input[type=file]', bigFile); await page.waitForTimeout(800); if (!/4 ميجابايت/.test(await toastText())) throw new Error('لم تظهر رسالة حد الحجم');
    const [img] = await Promise.all([ctx.waitForEvent('page', { timeout: 8000 }), page.click(':nth-match(.item, 1) .att >> nth=0 >> [data-act="openFile"]')]); await img.close();
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), page.click(':nth-match(.item, 1) .att >> nth=1 >> [data-act="openFile"]')]); if (!/evil\.html$/.test(dl.suggestedFilename())) throw new Error('ملف HTML لم يُنزَّل كملف: ' + dl.suggestedFilename());
    await page.click(':nth-match(.item, 2) .chip[data-val="4"]'); await page.fill(':nth-match(.item, 2) textarea.note-in', 'تقرير عدم مطابقة NCR-07'); await page.fill('textarea[data-f=strengths]', 'التزام بالسلامة'); await page.fill('textarea[data-f=weaknesses]', 'تأخر الإغلاق'); await page.selectOption('select[data-f=recommendation]', 'accepted');
    await page.waitForTimeout(1500); if (!/جارٍ الحفظ/.test(await page.textContent('#save-state'))) throw new Error('الحفظ التلقائي لم يجمع التعديلات المتتالية');
    await page.waitForFunction(() => /تم الحفظ/.test((document.getElementById('save-state') || {}).textContent || ''), null, { timeout: 15000 }).catch(async () => { throw new Error('حالة الحفظ: ' + await page.textContent('#save-state')); });
    await snap('02-eval'); await page.click('.eval-head [data-act="submitEval"]'); await page.waitForSelector('#modal'); await modalOk(); await page.waitForSelector('table.compare');
  });
  await step('المهندس لا يرى تقييمات زملائه قبل أن يقدّم تقييمه', async () => {
    await logout(); await login('eng1', 'temp-eng1'); await changePw('Eng1#2026'); await page.waitForSelector('.kpis');
    const n = await page.evaluate(() => window.EV.state.data.evaluations.length); if (n !== 0) throw new Error('يرى ' + n + ' تقييماً');
    const r = await page.evaluate(async () => { try { await window.EV.save('companies', Object.assign({}, window.EV.state.data.companies[0], { name_ar: 'تلاعب' }), 'x'); return 'saved'; } catch (e) { return e.status + ' ' + e.message; } }); if (!/^403/.test(r)) throw new Error('المهندس عدّل شركة: ' + r);
  });
  await step('تقييم رئيس القسم ثم التوحيد (مغادرة الشاشة تحفظ فوراً)', async () => { await logout(); await login('head', 'temp-head1'); await changePw('Head#2026'); await page.waitForSelector('.kpis'); await page.click('[data-act="startEval"]'); await page.waitForSelector('.eval-layout'); await scoreAll(6); await page.click(':nth-match(.item, 1) .chip[data-val="8"]'); await page.selectOption('select[data-f=recommendation]', 'reserved');
    await page.fill(':nth-match(.item, 1) textarea.note-in', 'ملاحظة تُحفظ عند المغادرة'); await page.click('.eval-head a[href^="#/contract/"]'); await page.waitForTimeout(1500);
    const saved = await page.evaluate(async () => { const r = await window.EV.state.store.call('load'); const e = r.data.evaluations.find(x => x.evaluatorId === r.me); return !!e && Object.values(e.scores || {}).some(s => s && s.n === 'ملاحظة تُحفظ عند المغادرة'); }); if (!saved) throw new Error('مغادرة شاشة التقييم لم تحفظ التعديل المعلّق');
    await page.goBack(); await page.waitForSelector('.eval-layout'); await page.click('.eval-head [data-act="submitEval"]'); await page.waitForSelector('#modal'); await modalOk(); await page.waitForSelector('table.compare'); await page.click('[data-act="consolidate"]'); await page.waitForSelector('#modal #mf'); await modalOk(); await page.waitForSelector('text=بانتظار الاعتماد'); await snap('03-compare'); });
  await step('تقييم أُعيد بعد التوحيد: لا يُوحَّد دونه، ويظهر لصاحبه في مستحقاته، والتوحيد القديم لا يُعتمد ثم يُعاد', async () => {
    const ids = await page.evaluate(() => { const EV = window.EV; const a = EV.state.data.users.find(u => u.username === 'admin'); const e = EV.state.data.evaluations.find(x => x.evaluatorId === a.id); return { ev: e.id, cy: e.cycleId }; });
    await page.click(`[data-act="returnEval"][data-id="${ids.ev}"]`); await page.waitForSelector('#modal #mf'); await page.fill('#mf textarea[name=note]', 'راجع البند الأول'); await modalOk(); await page.waitForSelector('text=النتيجة الموحدة أدناه قديمة');
    if (!/لم يُقدَّم بعد/.test(await page.textContent('#main'))) throw new Error('التنبيه لا يذكر التقييم المُعاد');
    await page.click('[data-act="consolidate"]'); await page.waitForTimeout(1200);
    if (await page.$('#modal:not([hidden]) #mf')) throw new Error('فُتح التوحيد والتقييم ما زال عند صاحبه'); if (!/لم يُقدَّم بعد/.test(await toastText())) throw new Error('لا رسالة رفض: ' + await toastText());
    const cyUrl = page.url(); await page.goto(URL + '#/home'); await page.waitForSelector('.follow'); if (!/أُعيد للمراجعة/.test(await page.textContent('.follow'))) throw new Error('لوحة المتابعة لا تذكر التقييم المُعاد'); await page.goto(cyUrl); await page.waitForSelector('table.compare');
    const ctxB = await newCtx(); const pB = await ctxB.newPage(); watch(pB, 'B'); await pB.goto(URL); await login('admin', 'Admin#2026', pB); await pB.waitForSelector('.kpis');
    await pB.waitForSelector(`[data-act="startEval"][data-cycle="${ids.cy}"]`); await pB.click(`[data-act="startEval"][data-cycle="${ids.cy}"]`); await pB.waitForSelector('.eval-layout'); await pB.click('.eval-head [data-act="submitEval"]'); await pB.waitForSelector('#modal'); await modalOk(pB); await pB.waitForSelector('table.compare');
    if (!(await pB.$('text=النتيجة الموحدة أدناه قديمة')) || await pB.$('[data-act="approveCycle"]')) throw new Error('التوحيد القديم معروض للاعتماد بعد إعادة التقديم');
    const r = await pB.evaluate(async id => { const EV = window.EV; try { await EV.update('cycles', EV.byId('cycles', id), c => { Object.assign(c, { status: 'approved', approvedBy: EV.state.user.id, approvedAt: EV.nowISO(), consequence: 'improvement' }); }, 'cycle_approve'); return 'approved'; } catch (e) { return e.status + ' ' + e.message; } }, ids.cy);
    if (!/^409/.test(r)) throw new Error('الخادم قبل اعتماد توحيد قديم: ' + r);
    await pB.goto(URL + '#/report/cycle/' + ids.cy); await pB.waitForSelector('.sheet.report'); if (!/نسخة غير صالحة للاعتماد/.test(await pB.textContent('.sheet.report'))) throw new Error('تقرير التوحيد القديم بلا تنبيه'); await ctxB.close();
    await page.click('[data-act="reload"]'); await page.waitForTimeout(800); await page.click('[data-act="consolidate"]'); await page.waitForSelector('#modal #mf'); await modalOk(); await page.waitForSelector('text=بانتظار الاعتماد');
    if (await page.$('text=النتيجة الموحدة أدناه قديمة')) throw new Error('بقي تنبيه التوحيد القديم بعد إعادة التوحيد');
  });
  await step('اعتماد رئيس قسم تنمية الوقف', async () => { await logout(); await login('waqf', 'temp-waqf1'); await changePw('Waqf#2026'); await page.waitForSelector('.kpis'); await page.click('a[href="#/projects"]'); await page.waitForTimeout(300); await page.click('a[href^="#/contract/"]'); await page.waitForTimeout(300); await page.click('a[href^="#/cycle/"]'); await page.waitForSelector('[data-act="approveCycle"]'); await page.click('[data-act="approveCycle"]'); await page.waitForSelector('#modal #mf'); await modalOk(); await page.waitForSelector('text=النتيجة الموحدة المعتمدة'); });
  await step('حساب المتابعة يرى ولا يعدّل (الواجهة والخادم)', async () => { await logout(); await login('sec', 'temp-sec1'); await changePw('Sec#2026'); await page.waitForSelector('.follow'); if (await page.$('[data-act="startEval"]')) throw new Error('زر التقييم ظاهر'); const r = await page.evaluate(async () => { try { await window.EV.save('companies', Object.assign({}, window.EV.state.data.companies[0]), 'x'); return 'saved'; } catch (e) { return String(e.status); } }); if (r !== '403') throw new Error('السكرتير عدّل: ' + r); await page.waitForTimeout(900); });
  await step('خطاب النتيجة وتقرير الأداء بخلفيات الهوية', async () => { await logout(); await login('waqf', 'Waqf#2026'); await page.waitForSelector('.kpis'); await page.click('a[href="#/projects"]'); await page.waitForTimeout(300); await page.click('a[href^="#/contract/"]'); await page.waitForTimeout(300); await page.click('a[href^="#/cycle/"]'); await page.waitForSelector('[data-act="resultLetter"]'); await page.click('[data-act="resultLetter"][data-kind="result"]'); await page.waitForSelector('.sheet.letter'); await page.goBack(); await page.waitForTimeout(500); await page.click('a[href^="#/report/cycle/"]'); await page.waitForSelector('.sheet.report'); await page.selectOption('select[data-change=orientation]', 'landscape'); await page.waitForTimeout(400); const ok = await page.evaluate(() => { const i = document.querySelector('.only-landscape .bg-img'); return i && i.naturalWidth > 0; }); if (!ok) throw new Error('الخلفية العرضية لم تُحمّل'); await page.emulateMedia({ media: 'print' }); await page.pdf({ path: path.join(shots, 'report-landscape.pdf'), preferCSSPageSize: true, printBackground: false }); await page.emulateMedia({ media: 'screen' }); });
  await step('مدير النظام: إضافة مستخدم وإعادة كلمة مرور بكلمات مؤقتة', async () => {
    await page.goto(URL + '#/'); await logout(); await login('admin', 'Admin#2026'); await page.waitForSelector('.kpis'); await page.goto(URL + '#/settings/users'); await page.waitForSelector('[data-act="userForm"]');
    await page.click('button[data-act="userForm"]:not([data-id])'); await page.waitForSelector('#modal #mf'); await page.fill('#mf input[name=name]', 'مهندسة جديدة'); await page.fill('#mf input[name=username]', 'neweng'); await page.fill('#mf input[name=email]', 'neweng@awqaf.gov.qa'); await page.click('#modal [data-m="ok"]'); await page.waitForSelector('.temp-pw'); const temp = (await page.textContent('.temp-pw')).trim(); await snap('04-temp-password'); await page.click('#modal [data-m="ok"]'); await page.waitForTimeout(300);
    if (!/^[a-z2-9]{4}-[a-z2-9]{4}$/.test(temp)) throw new Error('صيغة الكلمة المؤقتة ' + temp);
    const row = page.locator('tr', { hasText: 'neweng' }); await row.locator('[data-act="resetPw"]').click(); await page.waitForSelector('#modal [data-m="ok"]'); await page.click('#modal [data-m="ok"]'); await page.waitForSelector('.temp-pw'); const temp2 = (await page.textContent('.temp-pw')).trim(); await page.click('#modal [data-m="ok"]'); if (temp2 === temp) throw new Error('لم تتغير الكلمة المؤقتة');
    const ctx2 = await newCtx(); const p2 = await ctx2.newPage(); watch(p2, 'N'); await p2.goto(URL); await login('neweng', temp, p2); if (!/غير صحيحة/.test(await p2.textContent('#login-err'))) throw new Error('الكلمة القديمة ما زالت تعمل'); await login('neweng', temp2, p2); await p2.waitForSelector('form[data-form="password"]'); await ctx2.close();
  });
  await step('محرر الأوزان: إصدار جديد', async () => { await page.goto(URL + '#/settings/templates/contractor'); await page.waitForSelector('#tpl-editor'); const w = await page.$$('#tpl-editor input[data-input=tplWeight]'); await w[0].fill('25'); await w[1].fill('15'); await page.fill('#tpl-note', 'رفع وزن الجودة'); await page.click('[data-act="tplSave"]'); await page.waitForTimeout(800); await page.waitForSelector('text=إصدار 2'); });
  await step('تعارض التعديل: نافذتان على الشركة نفسها', async () => {
    const ctxB = await newCtx(); const pB = await ctxB.newPage(); watch(pB, 'B'); await pB.goto(URL); await login('head', 'Head#2026', pB); await pB.waitForSelector('.kpis');
    await page.goto(URL + '#/companies'); await page.waitForTimeout(400); await page.click('a[href^="#/company/"]'); await page.waitForSelector('[data-act="companyForm"]'); await page.click('[data-act="companyForm"]'); await page.waitForSelector('#modal #mf'); await page.fill('#mf input[name=contact_name]', 'م. سالم'); await modalOk();
    await pB.goto(URL + '#/companies'); await pB.waitForTimeout(400); await pB.click('a[href^="#/company/"]'); await pB.waitForSelector('[data-act="companyForm"]'); await pB.click('[data-act="companyForm"]'); await pB.waitForSelector('#modal #mf'); await pB.fill('#mf input[name=contact_name]', 'نسخة قديمة'); await modalOk(pB); await pB.waitForTimeout(1500);
    const tb = await toastText(pB); if (!/مستخدم آخر/.test(tb)) throw new Error('لم يظهر تنبيه التعارض: ' + tb);
    const shown = await pB.evaluate(() => window.EV.state.data.companies[0].contact_name); if (shown !== 'م. سالم') throw new Error('لم تُحدَّث البيانات بعد التعارض: ' + shown);
    await page.goto(URL + '#/home'); await page.waitForSelector('.kpis'); await pB.click('a[href="#/projects"]'); await pB.waitForTimeout(300); await pB.click('[data-act="projectForm"]'); await pB.waitForSelector('#modal #mf'); await pB.fill('#mf input[name=name]', 'مشروع من نافذة أخرى'); await modalOk(pB);
    await page.click('a[href="#/projects"]'); await page.waitForTimeout(300); await page.click('[data-act="projectForm"]'); await page.waitForSelector('#modal #mf'); await page.fill('#mf input[name=name]', 'مشروع من المدير'); await modalOk(); await page.waitForTimeout(500);
    if (!(await page.$('[data-act="reload"].has-updates'))) throw new Error('لم تظهر علامة وجود تحديثات من الزملاء'); await page.click('[data-act="reload"]'); await page.waitForTimeout(800); if (await page.$('[data-act="reload"].has-updates')) throw new Error('العلامة لم تُزل بعد التحديث'); await page.goto(URL + '#/projects'); await page.waitForTimeout(500); if (!(await page.textContent('#main')).includes('مشروع من نافذة أخرى')) throw new Error('التحديث لم يجلب مشروع الزميل');
    await ctxB.close();
  });
  await step('تصدير واستيراد نسخة احتياطية', async () => {
    await page.goto(URL + '#/settings/backup'); await page.waitForSelector('[data-act="exportBackup"]'); const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="exportBackup"]')]); const f = path.join(fixDir, 'backup.json'); await dl.saveAs(f); const j = JSON.parse(fs.readFileSync(f, 'utf8')); if (j.scope !== 'full' || !j.credentials) throw new Error('نسخة المدير ناقصة');
    await page.setInputFiles('input[data-change="importBackup"]', f); await page.waitForSelector('#modal [data-m="ok"]'); await page.click('#modal [data-m="ok"]'); await page.waitForSelector('text=تم الاستيراد'); await snap('05-import'); await page.click('#modal [data-m="ok"]'); await page.waitForTimeout(400);
  });
  await step('بيانات خبيثة في السجلات والخطابات تُعرض نصاً ولا تُحقن في الصفحة', async () => {
    const ids = await page.evaluate(async () => {
      const EV = window.EV, me = EV.state.user.id, k = EV.state.data.contracts[0];
      const comp = { id: EV.uid(), name_ar: 'شركة <img src=x id=pwn1> للاختبار', roles: ['contractor'], status: 'normal' }; await EV.save('companies', comp);
      const evil = { evalWeights: { 'x"><img src=x id=pwn3>': 2, [me]: '2"><img src=x id=pwn3>' }, consolidated: { count: '<meta http-equiv="refresh" content="0;url=about:blank#pwned"><img src=x id=pwn2>', total: 7, rating: 'good', axes: [], method: 'mean' } };
      /* الخادم يرفض الحقول الرقمية المشوهة في الدورة… */
      const refused = []; for (const part of [{ evalWeights: evil.evalWeights }, { consolidated: evil.consolidated }]) { try { await EV.save('cycles', Object.assign({ id: EV.uid(), contractId: k.id, type: 'interim', label: 'دورة مرفوضة', status: 'open', method: 'weighted', excluded: [], evalWeights: {} }, part)); refused.push('saved'); } catch (e) { refused.push(e.status); } }
      /* …ولو وصلت قيم كهذه إلى المتصفح بأي طريق تبقى نصاً: تُحقن هنا في البيانات المحلية مباشرة لاختبار الواجهة وحدها */
      const cy = Object.assign({ id: EV.uid(), contractId: k.id, type: 'interim', label: 'دورة اختبار الحقن', status: 'open', method: 'weighted', excluded: [] }, evil); EV.state.data.cycles.push(cy);
      const t = EV.templateFor(k, cy), sc = {}; t.axes.forEach(a => a.items.forEach(i => { sc[i.key] = { s: 7 }; }));
      EV.state.data.evaluations.push({ id: EV.uid(), cycleId: cy.id, contractId: k.id, evaluatorId: me, templateId: t.id, status: 'submitted', scores: sc, recommendation: 'accepted', computed: EV.compute(t, EV.weightsFor(k, t, cy), sc), submittedAt: EV.nowISO() });
      const l = { id: EV.uid(), contractId: k.id, cycleId: null, type: 'notice', refNo: 'TEST/001', subject: 'خطاب اختبار', to: 'السادة / شركة الاختبار<br><img src=x id=pwn5>', bodyHtml: '<form action=x><input name=a></form><img src=x id=pwn4 onerror=alert(1)><p>نص سليم</p>', issuedAt: EV.nowISO(), issuedBy: me }; await EV.save('letters', l);
      return { comp: comp.id, contract: k.id, cycle: cy.id, letter: l.id, refused };
    });
    if (ids.refused.join(',') !== '400,400') throw new Error('الخادم قبل حقولاً مشوهة في الدورة: ' + ids.refused.join(','));
    const visit = async (hash, sel, where) => { await page.goto(URL + hash); await page.waitForTimeout(700); const r = await page.evaluate(() => ({ el: !!document.querySelector('#pwn1,#pwn2,#pwn3,meta[http-equiv]'), hash: location.hash })); if (r.el || r.hash === '#pwned') throw new Error('حقن HTML في ' + where + ': ' + JSON.stringify(r)); await page.waitForSelector(sel, { timeout: 5000 }); };
    await visit('#/companies', '#rows', 'قائمة الشركات');
    await visit('#/company/' + ids.comp, '.score-card', 'صفحة الشركة'); if (!(await page.textContent('#main h2')).includes('<img src=x id=pwn1>')) throw new Error('اسم الشركة لم يُعرض نصاً');
    await visit('#/contract/' + ids.contract, '.notice-card', 'صفحة العقد');
    await visit('#/cycle/' + ids.cycle, '.weights input.w-in', 'صفحة الدورة'); if (!(await page.textContent('#main')).includes('<meta http-equiv="refresh"')) throw new Error('عدد التقييمات الموحدة لم يُعرض نصاً');
    await visit('#/report/cycle/' + ids.cycle, '.sheet.report', 'تقرير الدورة');
    await visit('#/letter/' + ids.letter, '.sheet.letter', 'الخطاب');
    const l = await page.evaluate(() => ({ bad: !!document.querySelector('.sheet-body form, .sheet-body input, .sheet-body img, #pwn4, #pwn5'), text: document.querySelector('.sheet-body').textContent, br: !!document.querySelector('.sheet-body .to br') }));
    if (l.bad) throw new Error('بقي نموذج أو صورة في نص الخطاب'); if (!l.text.includes('نص سليم')) throw new Error('حُذف النص السليم من الخطاب'); if (!l.br) throw new Error('حُذف وسم سليم من سطر المرسل إليه');
  });
  const serverData = () => page.evaluate(async () => (await window.EV.state.store.call('load')).data);
  const failPuts = (status, ops) => page.route('**/api/rpc', route => { let op = ''; try { op = JSON.parse(route.request().postData() || '{}').op; } catch (e) { } if ((ops || ['put', 'batch']).includes(op)) return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'عطل مقصود في الاختبار', code: 'test' }) }); return route.continue(); });
  await step('إجراء رفضه الخادم لا يترك تغييراً في الشاشة', async () => {
    await page.goto(URL + '#/settings/users'); await page.waitForSelector('[data-act="toggleUser"]');
    const id = await page.evaluate(() => window.EV.state.data.users.find(u => u.username === 'neweng').id);
    quiet = true; await failPuts(503); await page.click(`[data-act="toggleUser"][data-id="${id}"]`); await page.waitForTimeout(900); await page.unroute('**/api/rpc'); quiet = false;
    if (await page.evaluate(id => window.EV.byId('users', id).active, id) !== true) throw new Error('تغيّر الحساب في الشاشة رغم فشل الحفظ');
  });
  let K2;
  await step('النقر المزدوج على «إصدار الإخطار» يصدر خطاباً واحداً، والموضوع نص عادي', async () => {
    K2 = await page.evaluate(async () => { const EV = window.EV; const k0 = EV.state.data.contracts[0]; const p = { id: EV.uid(), name: 'صيانة مسجد "النور" & ملحقاته', type: 'mosque' }; await EV.save('projects', p, 'project_create'); const k = { id: EV.uid(), companyId: k0.companyId, projectId: p.id, role: 'contractor', model: 'full', status: 'active', evaluators: [], leadEngineer: EV.state.user.id, weights: k0.weights, templateId: k0.templateId, contract_no: 'C-1&2' }; await EV.save('contracts', k, 'contract_create'); return k.id; });
    const before = (await serverData()).letters.length;
    await page.goto(URL + '#/contract/' + K2); await page.waitForSelector('[data-act="issueNotice"]'); await page.dblclick('[data-act="issueNotice"]'); await page.waitForSelector('.sheet.letter'); await page.waitForTimeout(900);
    const after = (await serverData()).letters.length; if (after !== before + 1) throw new Error('صدر ' + (after - before) + ' خطاب');
    const subj = await page.textContent('.subj'); if (/&quot;|&amp;/.test(subj) || !subj.includes('"النور" &')) throw new Error('موضوع الخطاب مرمّز مرتين: ' + subj);
  });
  await step('الحفظ التلقائي لا يقول «تم الحفظ» وهو لم يحفظ، ولا يضيع بانتهاء الجلسة', async () => {
    await page.evaluate(async K2 => { const EV = window.EV; await EV.save('cycles', { id: EV.uid(), contractId: K2, type: 'interim', label: 'دورة الحفظ', status: 'open', method: 'mean', excluded: [], evalWeights: {} }, 'cycle_open'); }, K2);
    await page.goto(URL + '#/contract/' + K2); await page.waitForSelector('[data-act="startEval"]'); await page.click('[data-act="startEval"]'); await page.waitForSelector('.eval-layout');
    quiet = true; await failPuts(400, ['put']); await page.click(':nth-match(.item, 1) .chip[data-val="6"]'); const flushed = await page.evaluate(() => window.EV.flushPending()); await page.unroute('**/api/rpc'); quiet = false;
    if (flushed !== false) throw new Error('flushPending أبلغ بالحفظ رغم الرفض'); if (!/لم يُحفظ/.test(await page.textContent('#save-state'))) throw new Error('حالة الحفظ: ' + await page.textContent('#save-state'));
    if (await page.evaluate(() => window.EV.flushPending()) !== true) throw new Error('لم يُحفظ بعد عودة الخادم');
    quiet = true; await page.evaluate(() => { window.EV.state.store.token = 'expired.token'; }); await page.fill(':nth-match(.item, 1) textarea.note-in', 'ملاحظة كُتبت بعد انتهاء الجلسة'); await page.evaluate(() => window.EV.flushPending()); await page.waitForSelector('#login-user', { timeout: 8000 }); quiet = false;
    await login('admin', 'Admin#2026'); await page.waitForTimeout(2500);
    const kept = (await serverData()).evaluations.some(e => Object.values(e.scores || {}).some(x => x && x.n === 'ملاحظة كُتبت بعد انتهاء الجلسة')); if (!kept) throw new Error('ضاع ما كُتب قبل إعادة الدخول');
  });
  await step('تعديل كُتب قبل أن يكشف رفعُ مرفق انتهاء الجلسة يُحفظ بعد الدخول مجدداً', async () => {
    const evId = await page.evaluate(() => { const EV = window.EV; const cy = EV.state.data.cycles.find(c => c.label === 'دورة الحفظ'); return EV.state.data.evaluations.find(e => e.cycleId === cy.id && e.evaluatorId === EV.state.user.id).id; });
    await page.goto(URL + '#/eval/' + evId); await page.waitForSelector('.eval-layout');
    quiet = true; await page.evaluate(() => { window.EV.state.store.token = 'expired.token'; });
    await page.fill(':nth-match(.item, 2) textarea.note-in', 'ملاحظة قبل رفع المرفق'); await page.setInputFiles(':nth-match(.item, 2) input[type=file]', pngFile);
    await page.waitForSelector('#login-user', { timeout: 8000 }); await page.waitForTimeout(6500); quiet = false;
    await login('admin', 'Admin#2026'); await page.waitForTimeout(2500);
    const kept = (await serverData()).evaluations.some(e => Object.values(e.scores || {}).some(x => x && x.n === 'ملاحظة قبل رفع المرفق')); if (!kept) throw new Error('ضاع التعديل الذي كُتب قبل انتهاء الجلسة');
  });
  await step('الخروج مع التخلي عن تعديل لم يُحفظ لا يرسله لاحقاً باسم من يدخل بعده', async () => {
    const evId = await page.evaluate(() => { const EV = window.EV; const cy = EV.state.data.cycles.find(c => c.label === 'دورة الحفظ'); return EV.state.data.evaluations.find(e => e.cycleId === cy.id && e.evaluatorId === EV.state.user.id).id; });
    await page.goto(URL + '#/eval/' + evId); await page.waitForSelector('.eval-layout');
    quiet = true; await failPuts(503, ['put']); await page.fill(':nth-match(.item, 1) textarea.note-in', 'تعديل متروك عند الخروج');
    await page.click('[data-act="logout"]'); await page.waitForSelector('#modal [data-m="ok"]', { timeout: 30000 });
    const sent = []; page.on('request', r => { if (r.url().includes('/api/rpc') && (r.postData() || '').includes('تعديل متروك عند الخروج')) sent.push(1); });
    await page.click('#modal [data-m="ok"]'); await page.waitForSelector('#login-user'); await page.unroute('**/api/rpc'); quiet = false;
    await login('head', 'Head#2026'); await page.waitForSelector('.kpis'); await page.waitForTimeout(7000);
    if (sent.length) throw new Error('أُرسل التعديل المتروك ' + sent.length + ' مرة بعد الخروج');
    if ((await serverData()).evaluations.some(e => Object.values(e.scores || {}).some(x => x && x.n === 'تعديل متروك عند الخروج'))) throw new Error('حُفظ التعديل المتروك');
  });
  await step('رابط الإنترنت لا يسقط إلى إعداد الأوفلاين إذا تعثر الاتصال', async () => {
    const c3 = await newCtx(); const p3 = await c3.newPage(); watch(p3, 'H'); let n = 0; quiet = true;
    await p3.route('**/api/health', r => (n++ === 0 ? r.abort() : r.continue())); await p3.goto(URL); await p3.waitForSelector('#login-user', { timeout: 15000 });
    await p3.unroute('**/api/health'); await p3.route('**/api/health', r => r.abort()); await p3.reload(); await p3.waitForSelector('[data-act="retryBoot"]', { timeout: 15000 }); quiet = false;
    if (await p3.$('[data-act="pickFolder"], [data-act="useLocal"]')) throw new Error('ظهر إعداد الأوفلاين'); await c3.close();
  });
  await step('أدوات العرض لا تتعطل بقيم غير متوقعة، وتصدير CSV لا يحمل صيغاً', async () => {
    const r = await page.evaluate(() => { const EV = window.EV; return { d: EV.fmtDate({ a: 1 }), n: EV.fmtNum({ a: 1 }), e: EV.esc({ a: 1 }), csv: EV.csvText([['=1+1', '+2', 'نص', 5]]) }; });
    if (r.d !== '—' || r.n !== '—' || r.e !== '') throw new Error('قيم غير متوقعة: ' + JSON.stringify(r)); if (!r.csv.includes(`"'=1+1"`) || !r.csv.includes(`"'+2"`) || !r.csv.includes(',5')) throw new Error('CSV: ' + r.csv);
  });
  await step('نافذة فوق نافذة لا تُغلق الأولى، وطلبا الخطاب نفسه معاً يصدران خطاباً واحداً', async () => {
    await page.goto(URL + '#/home'); await page.waitForSelector('.kpis');
    await page.evaluate(() => { window.__outer = window.EV.modal({ title: 'النافذة الأولى', body: '<p>الأولى</p>' }); window.__inner = window.EV.confirm('النافذة الثانية؟'); });
    await page.waitForSelector('#modal2:not([hidden]) .modal-head [data-m="cancel"]'); await page.click('#modal2 .modal-head [data-m="cancel"]');
    if (await page.evaluate(() => window.__inner) !== false) throw new Error('لم تُلغَ النافذة الثانية');
    if (await page.evaluate(() => document.getElementById('modal').hidden)) throw new Error('أُغلقت الأولى مع الثانية');
    await page.click('#modal [data-m="ok"]'); if (await page.evaluate(() => window.__outer) !== true) throw new Error('الأولى لم تعمل بعد إغلاق الثانية');
    const before = page.url();
    await page.evaluate(() => { window.__enter = window.EV.modal({ title: 'سبب', body: '<form id="mf"><input name="why" required></form>', onOk: m => m.querySelector('#mf').why.value }); });
    await page.waitForSelector('#modal #mf input[name=why]'); await page.fill('#modal #mf input[name=why]', 'سبب مكتوب'); await page.press('#modal #mf input[name=why]', 'Enter');
    if (await page.evaluate(() => window.__enter) !== 'سبب مكتوب') throw new Error('Enter لم يؤكد النافذة'); if (page.url() !== before) throw new Error('أعاد Enter تحميل الصفحة: ' + page.url());
    const g = await page.evaluate(async () => { const EV = window.EV; let runs = 0, release = null; EV.actions.__probe = () => { runs++; return new Promise(r => { release = r; }); }; const b = document.createElement('button'); b.dataset.act = '__probe'; document.body.appendChild(b);
      b.click(); b.click(); const during = runs; release(); await new Promise(r => setTimeout(r, 50)); b.click(); const justAfter = runs; await new Promise(r => setTimeout(r, 500)); b.click(); const later = runs; release(); b.remove(); delete EV.actions.__probe; return { during, justAfter, later }; });
    if (g.during !== 1 || g.justAfter !== 1 || g.later !== 2) throw new Error('حارس النقرات: ' + JSON.stringify(g));
    const n0 = (await serverData()).letters.length;
    const same = await page.evaluate(async id => { const EV = window.EV; const k = EV.byId('contracts', id); const [a, b] = await Promise.all([EV.makeLetter('notice', k), EV.makeLetter('notice', k)]); return a.id === b.id; }, K2);
    const n1 = (await serverData()).letters.length; if (!same || n1 !== n0 + 1) throw new Error('صدر ' + (n1 - n0) + ' خطاب');
  });
  await step('انتهاء الجلسة يعيد إلى شاشة الدخول', async () => { await page.evaluate(() => sessionStorage.setItem('ev_token', 'tampered.token')); await page.reload(); await page.waitForSelector('#login-user', { timeout: 8000 }); });
  await browser.close(); srv.kill();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'No console/page/CSP errors');
  if (errors.length) process.exit(1);
})().catch(e => { console.error('TEST FAILED', e.message); try { srv.kill(); } catch (x) { } if (srvLog) console.error(srvLog.slice(-3000)); process.exit(1); });
