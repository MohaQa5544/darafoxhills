/* لقطات للشاشات ببيانات تجريبية: node test/shots.js  (تُحفظ في test/shots) */
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const SCALE = Number(process.env.SCALE || 1);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: 'ar', viewport: { width: 1440, height: 900 }, deviceScaleFactor: SCALE }); const p = await ctx.newPage();
  p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'index.html')); await p.click('[data-act=useLocal]'); await p.waitForSelector('form[data-form=login]');
  await p.screenshot({ path: path.join(OUT, '1-login.png') });
  await p.evaluate(async () => {
    const day = n => FU.addDays('2000-01-01', Math.round((Date.now() - Date.UTC(2000, 0, 1)) / 864e5) - n);
    for (const u of FU.list('users')) await FU.update('users', u.id, c => { c.mustChange = false; }, null);
    FU.state.user = FU.byId('users', 'u-aabakr');
    const mk = async (seq, subject, number, ago, from, pr, tasks) => {
      const l = await FU.save('letters', { id: FU.uid(), seq, subject, number, date: day(ago), from, priority: pr || 'normal', notes: '', files: [] }, null);
      for (const t of tasks) {
        const rec = await FU.save('tasks', { id: FU.uid(), letterId: l.id, deptId: t[0], status: t[1], startDate: day(ago), days: t[2], followerId: t[3], doneDate: t[1] === 'done' ? day(ago - t[2] + (t[5] || 0)) : null, notes: '' }, null);
        let k = 0; for (const x of (t[4] || [])) await FU.save('updates', { id: FU.uid(), taskId: rec.id, letterId: l.id, deptId: t[0], kind: x[1] || 'action', date: day(Math.max(0, ago - 2 - 3 * k++)), text: x[0], replyNo: x[2] || '', status: null, files: [], byId: 'u-aalqadhi', byName: x[3] || 'عبدالرحيم القاضي' }, null);
      }
    };
    await mk(1, 'متابعة الخطة الاستراتيجية 2025-2030 للربع الأول من سنة 2026', '1234', 24, 'مكتب الوزير', 'urgent', [
      ['dept-5', 'in_progress', 28, 'u-shallaby', [['تم إعداد الكتاب بانتظار التوقيع من قبل المدير العام'], ['تم الرد — رقم الكتاب (66375/2026)', 'follow', '66375/2026', 'سلطان هلابي']]],
      ['dept-2', 'done', 20, 'u-abelal', [['تم تجهيز بيانات المحفظة الاستثمارية'], ['أُرسل التقرير إلى مكتب المدير العام', 'action', '4410/2026']], 0],
      ['dept-1', 'no_action', 1, 'u-aabakr', [['للاطلاع فقط، لا يوجد إجراء مطلوب من المكتب', 'follow', '', 'عبدالله أبكر داود']]]]);
    await mk(2, 'متطلبات الإدارة العامة للأوقاف بشأن حصر العقارات الوقفية المؤجرة', '9', 16, 'الإدارة العامة للأوقاف', 'normal', [
      ['dept-4', 'in_progress', 10, 'u-aabakr', [['جارٍ حصر العقود مع قسم التأجير'], ['اكتمل حصر 60% من العقود', 'action'], ['بانتظار بيانات منطقة الوكرة', 'action'], ['يُستعجل استكمال الحصر قبل نهاية الأسبوع', 'directive', '', 'حسن عبدالله المرزوقي']]],
      ['dept-3', 'problem', 14, 'u-shallaby', [['تعذر استخراج كشوف المصارف لتعطل النظام المالي', 'action', '', 'مازن عمر دقاق']]]]);
    await mk(3, 'طلب ديوان المحاسبة: بيان بالمشاريع الاستثمارية المتعثرة', '14055', 5, 'ديوان المحاسبة', 'urgent', [['dept-2', 'not_received', 7, 'u-abelal', []], ['dept-4', 'in_progress', 7, 'u-abelal', [['تم تكليف القسم المختص بإعداد البيان']]]]);
    await mk(4, 'تحديث دليل إجراءات الصرف من المصارف الوقفية', '14050', 3, '', 'normal', [['dept-3', 'in_progress', 4, 'u-shallaby', []]]);
    await mk(5, 'دعوة لحضور ورشة الحوكمة المؤسسية', '15210', 1, 'إدارة التخطيط والجودة', 'normal', []);
    await mk(6, 'موازنة مشاريع الصيانة للعام 2027', '13890', 40, '', 'normal', [['dept-2', 'done', 14, 'u-aabakr', [['رُفعت الموازنة التقديرية'], ['اعتُمدت وأُرسلت للمالية', 'action', '3901/2026']], 6], ['dept-5', 'done', 14, 'u-aabakr', [['تمت المراجعة الإدارية']], 0]]);
    sessionStorage.setItem('fu_user', 'u-aabakr');
  });
  await p.goto('file://' + path.join(__dirname, '..', 'app', 'index.html') + '#/home'); await p.reload(); await p.waitForSelector('.tiles');
  await p.screenshot({ path: path.join(OUT, '2-home.png'), fullPage: true });
  await p.goto(p.url().replace(/#.*/, '#/register')); await p.waitForSelector('table.reg'); await p.screenshot({ path: path.join(OUT, '3-register.png'), fullPage: true });
  await p.evaluate(async () => { const t = FU.db().tasks.find(x => x.deptId === 'dept-4' && x.status === 'in_progress' && FU.letterOf(x).number === '9'); for (const k of [1, 2]) await FU.save('updates', { id: FU.uid(), taskId: t.id, letterId: t.letterId, deptId: t.deptId, kind: 'remind', no: k, via: 'email', date: FU.today(), text: '', note: 'بريد إلكتروني — إلى فهد أظهر خان (fkhan@islam.gov.qa) — متأخر 5 أيام', replyNo: '', status: null, files: [], byId: 'u-aabakr', byName: 'عبدالله أبكر داود' }, null); const l6 = FU.db().letters.find(x => x.seq === 6); await FU.update('letters', l6.id, c => { c.closedAt = FU.nowISO(); }, null); const l5 = FU.db().letters.find(x => x.seq === 5); await FU.update('letters', l5.id, c => { c.deletedAt = FU.nowISO(); c.deletedBy = 'u-aabakr'; }, null); });
  await p.reload(); await p.waitForSelector('table.reg'); await p.screenshot({ path: path.join(OUT, '3-register.png'), fullPage: true });
  await p.click('[data-b=trash]'); await p.waitForSelector('[data-act=restoreLetter]'); await p.screenshot({ path: path.join(OUT, '11-trash.png') }); await p.click('[data-b=open]'); await p.waitForSelector('table.reg');
  await p.click('table.reg a >> nth=1'); await p.waitForSelector('section.task'); await p.screenshot({ path: path.join(OUT, '4-letter.png'), fullPage: true });
  await p.click('[data-act=remindTask] >> nth=1'); await p.waitForSelector('.modal-box'); await p.screenshot({ path: path.join(OUT, '12-remind.png') }); await p.click('[data-m=cancel] >> nth=0');
  await p.click('[data-act=addUpdate] >> nth=0'); await p.waitForSelector('.modal-box'); await p.selectOption('select[name=status]', 'done'); await p.screenshot({ path: path.join(OUT, '5-update.png') }); await p.click('[data-m=cancel] >> nth=0');
  await p.goto(p.url().replace(/#.*/, '#/register')); await p.click('[data-act=newLetter]'); await p.waitForSelector('.modal-box'); await p.screenshot({ path: path.join(OUT, '6-new.png') }); await p.click('[data-m=cancel] >> nth=0');
  await p.goto(p.url().replace(/#.*/, '#/print/register')); await p.waitForSelector('.sheet'); await p.screenshot({ path: path.join(OUT, '7-report.png'), fullPage: true });
  await p.goto(p.url().replace(/#.*/, '#/print/summary')); await p.waitForSelector('.sheet'); await p.screenshot({ path: path.join(OUT, '8-summary.png'), fullPage: true });
  await p.evaluate(() => { FU.state.user = FU.byId('users', 'u-fhussni'); sessionStorage.setItem('fu_user', 'u-fhussni'); }); await p.goto(p.url().replace(/#.*/, '#/settings')); await p.reload(); await p.waitForSelector('.subtabs'); await p.click('[data-t=users]'); await p.screenshot({ path: path.join(OUT, '9-users.png'), fullPage: true });
  await ctx.setViewportSize ? null : null; await p.setViewportSize({ width: 420, height: 800 }); await p.goto(p.url().replace(/#.*/, '#/home')); await p.waitForSelector('.tiles'); await p.screenshot({ path: path.join(OUT, '10-mobile.png') });
  await b.close(); console.log('done');
})().catch(e => { console.error(e); process.exit(1); });
