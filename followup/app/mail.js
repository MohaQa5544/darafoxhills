/* البريد والتذكيرات — برنامج المتابعة: رسالة إحالة الكتاب إلى ممثل الإدارة ورسائل التذكير بطرق تناسب كل برامج البريد،
   وتسجيل كل إرسال وتذكير في مسار الإحالة. الإرسال نفسه يبقى بيد الموظف من بريده. */
(function () {
  const FU = window.FU, { esc, field, opts } = FU, A = FU.actions, me = () => FU.state.user;
  const GREET = 'السلام عليكم ورحمة الله وبركاته،\n\nالسادة/ {الإدارة} المحترمين\nعناية: {الممثل}\n\n';
  const SIGN = '\n\nمع التحية،\n{المرسل}\n{الجهة المشرفة}';
  const DEF = {
    mailSubject: 'إحالة كتاب رقم {رقم الكتاب} — {الموضوع}',
    mailBody: GREET + 'نحيل إليكم الكتاب المرفق لاتخاذ اللازم:\nالموضوع: {الموضوع}\nرقم الكتاب: {رقم الكتاب} — تاريخه: {تاريخ الكتاب}\nالمدة المتوقعة للإنجاز: {المدة} — تاريخ الاستحقاق: {الاستحقاق}\n\nنأمل تأكيد الاستلام وتسجيل الإفادة في برنامج المتابعة.' + SIGN,
    remindSubject: '{نوع التذكير} ({رقم التذكير}): كتاب رقم {رقم الكتاب} — {الموضوع}',
    remindBody: GREET + 'نذكّركم بالكتاب رقم {رقم الكتاب} بتاريخ {تاريخ الكتاب}\nالموضوع: {الموضوع}\nتاريخ الاستحقاق: {الاستحقاق} ({الوضع})\n\nنأمل سرعة الإنجاز وتسجيل الإفادة في برنامج المتابعة.' + SIGN,
    webMail: 'https://outlook.office.com/mail/deeplink/compose'
  };
  const FIELDS = ['الموضوع', 'رقم الكتاب', 'تاريخ الكتاب', 'الإدارة', 'الممثل', 'المدة', 'الاستحقاق', 'الوضع', 'نوع التذكير', 'رقم التذكير', 'المرسل', 'الجهة المشرفة'];
  const VIA = { email: 'بريد إلكتروني', phone: 'اتصال هاتفي', direct: 'مباشرة' };
  const cfg = k => { const v = FU.state.settings[k]; return v == null ? DEF[k] : v; };
  FU.KIND.mail = 'إرسال الكتاب'; FU.KIND.remind = 'تذكير';

  /* الرسالة الجاهزة لإحالة: المستلمون (ممثلو الإدارة) والموضوع والنص بعد تعبئة الصيغة الثابتة */
  function compose(t, mode) {
    const l = FU.letterOf(t), i = FU.taskInfo(t), dept = FU.deptName(t.deptId), remind = mode === 'remind';
    const reps = FU.list('users', u => u.active && u.role === 'rep' && u.deptId === t.deptId).sort(FU.byName);
    const state = !i.due || i.left == null ? 'بلا موعد' : i.overdue ? 'متأخر ' + FU.daysWord(-i.left, true) : i.left === 0 ? 'يستحق اليوم' : 'باقٍ ' + FU.daysWord(i.left);
    const no = FU.reminders(t) + 1;
    const map = { 'الموضوع': l.subject, 'رقم الكتاب': l.number, 'تاريخ الكتاب': FU.fmtDate(l.date), 'الإدارة': dept, 'الممثل': reps.map(u => u.name).join(' و') || 'سكرتارية الإدارة', 'المدة': t.days === '' || t.days == null ? '—' : FU.daysWord(+t.days), 'الاستحقاق': i.due ? FU.fmtDate(i.due) : '—', 'الوضع': state, 'نوع التذكير': i.overdue ? 'استعجال' : 'تذكير', 'رقم التذكير': no, 'المرسل': me().name, 'الجهة المشرفة': FU.state.settings.unitName };
    const fill = s => String(s).replace(/\{([^{}]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(map, k.trim()) ? map[k.trim()] : m));
    return { l, dept, reps, state, no, to: reps.map(u => u.email).filter(Boolean), subject: (l.priority === 'urgent' ? 'عاجل — ' : '') + fill(cfg(remind ? 'remindSubject' : 'mailSubject')), body: fill(cfg(remind ? 'remindBody' : 'mailBody')) };
  }

  /* ---------- طرق فتح الرسالة ---------- */
  const enc = encodeURIComponent, crlf = s => String(s).replace(/\r?\n/g, '\r\n');
  /* رابط mailto لبرنامج البريد الافتراضي. الروابط الطويلة يقتطعها آوت لوك، فإن طال النص يُفتح بلا نص وينسخه البرنامج للصقه */
  function mailtoUrl(to, subject, body) {
    const head = 'mailto:' + to.map(enc).join(';') + '?subject=' + enc(subject), full = head + '&body=' + enc(crlf(body));
    return full.length <= 1900 ? { url: full, short: false } : { url: head, short: true };
  }
  const webUrl = (base, to, subject, body) => base + (base.includes('?') ? '&' : '?') + 'to=' + enc(to.join(';')) + '&subject=' + enc(subject) + '&body=' + enc(crlf(body));
  function openUrl(url, blank) { const a = document.createElement('a'); a.href = url; if (blank) { a.target = '_blank'; a.rel = 'noopener'; } document.body.appendChild(a); a.click(); a.remove(); }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return; } catch (e) { }
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
  }
  /* ملف مسودة (.eml) يفتحه آوت لوك المكتبي رسالةً قابلة للإرسال (X-Unsent) ومعها المرفقات؛ كل المحتوى مرمّز base64 */
  const utf8 = s => new TextEncoder().encode(s);
  const b64 = s => { const b = utf8(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(bin); };
  const wrap = s => s.replace(/(.{76})(?=.)/g, '$1\r\n');
  function encWord(s) {   // RFC 2047: أجزاء قصيرة تُقطع على حدود الحروف
    const parts = []; let cur = '';
    for (const ch of String(s)) { if (utf8(cur + ch).length > 42) { parts.push(cur); cur = ''; } cur += ch; }
    if (cur || !parts.length) parts.push(cur);
    return parts.map(p => '=?UTF-8?B?' + b64(p) + '?=').join('\r\n ');
  }
  const blob64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  const html = body => '<html><body dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:11pt;line-height:1.8">' + body.split(/\n{2,}/).map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('') + '</body></html>';
  async function buildEml(to, subject, body, files) {
    const bd = '----=_followup_' + FU.uid().replace(/-/g, '');
    const L = ['To: ' + to.join(', '), 'Subject: ' + encWord(subject), 'X-Unsent: 1', 'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary="' + bd + '"', '', '--' + bd, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap(b64(html(body)))];
    for (const f of (files || [])) {
      const blob = await FU.state.store.fileBlob(f.path); if (!blob) throw new Error('تعذر قراءة المرفق «' + f.name + '». ربما لم تكتمل مزامنته بعد.');
      const name = '"=?UTF-8?B?' + b64(f.name) + '?="';
      L.push('--' + bd, 'Content-Type: ' + (blob.type || 'application/octet-stream') + '; name=' + name, 'Content-Transfer-Encoding: base64', 'Content-Disposition: attachment; filename=' + name, '', wrap(await blob64(blob)));
    }
    L.push('--' + bd + '--', ''); return L.join('\r\n');
  }

  /* ---------- نافذة الرسالة ---------- */
  async function mailDialog(t, mode) {
    const remind = mode === 'remind', m = compose(t, mode), files = m.l.files || [], web = String(cfg('webMail') || '').trim();
    const way = (k, label, desc, primary) => `<div class="att"><button type="button" class="btn ${primary ? 'primary' : ''}" data-mail="${k}">${label}</button><span class="small muted">${desc}</span></div>`;
    const body = `${m.to.length ? '' : `<div class="note warn">لا يوجد بريد مسجّل لممثل «${esc(m.dept)}». اكتب العنوان هنا، أو يضيفه مدير البرنامج إلى حسابه من «الإعدادات ← المستخدمون».</div>`}
      ${remind ? `<div class="note">التذكير رقم <b>${m.no}</b> لهذه الإحالة — ${esc(m.state)}.</div>` : ''}
      <div class="grid2">${field('إلى', `<input name="to" dir="ltr" value="${esc(m.to.join('; '))}">`, m.reps.length ? 'ممثل الإدارة: ' + m.reps.map(u => u.name).join('، ') : '')}
      ${remind ? field('وسيلة التذكير', `<select name="via">${opts(Object.keys(VIA).map(k => [k, VIA[k]]), 'email')}</select>`, 'تُسجَّل مع التذكير') : '<span></span>'}
      ${field('الموضوع', `<input name="subject" required maxlength="250" value="${esc(m.subject)}">`, '', 'span2')}
      ${field('نص الرسالة', `<textarea name="body" rows="10" required>${esc(m.body)}</textarea>`, '', 'span2')}</div>
      <div><span class="lbl">مرفقات الكتاب</span><div class="files">${files.length ? FU.filesHtml(files) : '<span class="muted small">لا توجد مرفقات لهذا الكتاب. أرفق صورته من صفحة الكتاب إن أردت إرسالها.</span>'}</div></div>
      <div><span class="lbl">افتح الرسالة بالطريقة التي تناسب بريدك</span>
        ${way('mailto', '✉ برنامج البريد', 'يفتح رسالة جديدة في برنامج البريد على جهازك أياً كان. المرفق تضيفه يدوياً.', true)}
        ${way('eml', '⬇ مسودة بالمرفقات', 'ملف يُفتح بآوت لوك المكتبي (الكلاسيكي) رسالةً جاهزة ومعها مرفقات الكتاب.')}
        ${web ? way('web', '🌐 بريد المتصفح', 'يفتح رسالة جديدة في آوت لوك على المتصفح. المرفق تضيفه يدوياً.') : ''}
        ${way('copy', '📋 نسخ النص', 'ينسخ الموضوع والنص لتلصقهما في أي برنامج.')}</div>
      <p class="hint">بعد أن ترسل الرسالة من بريدك اضغط الزر أدناه ليُسجَّل ${remind ? 'التذكير' : 'الإرسال'} في مسار الإحالة.${FU.isAdmin() ? ' <a href="#/mail-template" data-m="cancel">تعديل الصيغة الثابتة</a>' : ''}</p>`;
    const read = (form, noTo) => {
      const to = form.elements.to.value.split(/[;,\s]+/).filter(Boolean);
      if (!noTo && (!to.length || to.some(a => !/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(a)))) throw new Error('اكتب عنوان بريد صحيحاً في خانة «إلى»');
      const subject = form.elements.subject.value.trim(), text = form.elements.body.value.trim(); if (!subject || !text) throw new Error('أكمل الموضوع ونص الرسالة');
      return { to, subject, body: text };
    };
    const run = async (form, k) => {
      const v = read(form, k === 'copy');
      if (k === 'mailto') { const u = mailtoUrl(v.to, v.subject, v.body); if (u.short) await copyText(v.body); openUrl(u.url); FU.toast(u.short ? 'النص طويل على رابط البريد، فنُسخ لك. الصقه في الرسالة (Ctrl+V).' : 'فُتحت الرسالة في برنامج البريد', u.short ? 'warn' : 'ok'); }
      else if (k === 'web') openUrl(webUrl(web, v.to, v.subject, v.body), true);
      else if (k === 'copy') { await copyText(v.subject + '\n\n' + v.body); FU.toast('نُسخ الموضوع والنص', 'ok'); }
      else if (k === 'eml') { FU.download(((remind ? 'تذكير' : 'إحالة') + '-كتاب-' + m.l.number).replace(/[\\/:*?"<>|\s]+/g, '-') + '.eml', await buildEml(v.to, v.subject, v.body, files), 'message/rfc822'); FU.toast('نُزّل ملف المسودة. افتحه ليظهر في آوت لوك ثم أرسله.', 'ok'); }
    };
    return FU.modal({ title: (remind ? 'تذكير — ' : 'إرسال الكتاب — ') + m.dept + ' · كتاب رقم ' + m.l.number, body, wide: true, okText: remind ? 'تم التذكير — سجّله' : 'تم الإرسال — سجّله', cancelText: 'إغلاق',
      onOpen: form => form.addEventListener('click', e => { const b = e.target.closest('[data-mail]'); if (b) run(form, b.dataset.mail).catch(err => FU.toast(err.message || String(err), 'bad')); }),
      onOk: async form => {
        const via = remind ? form.elements.via.value : 'email', v = read(form, via !== 'email'), names = m.reps.map(u => u.name).join('، ') || m.dept, addr = via === 'email' ? ' (' + v.to.join('، ') + ')' : '';
        const rec = { id: FU.uid(), taskId: t.id, letterId: t.letterId, deptId: t.deptId, kind: remind ? 'remind' : 'mail', date: FU.today(), text: '', replyNo: '', status: null, files: [], byId: me().id, byName: me().name };
        if (remind) { rec.no = FU.reminders(t) + 1; rec.via = VIA[via] ? via : 'email'; rec.note = VIA[rec.via] + ' — إلى ' + names + addr + ' — ' + m.state; }
        else rec.note = 'أُرسل الكتاب بالبريد إلى ' + names + addr;
        await FU.save('updates', rec, 'update_add', { number: m.l.number, dept: m.dept, kind: FU.KIND[rec.kind] });
      } });
  }
  A.mailTask = async el => { const t = FU.byId('tasks', el.dataset.id); if (!t || !FU.isOfficer() || FU.lockedTask(t)) return; if (await mailDialog(t, 'refer')) { FU.toast('سُجّل إرسال الكتاب', 'ok'); FU.refresh(); } };
  A.remindTask = async el => { const t = FU.byId('tasks', el.dataset.id); if (!t || !FU.isOfficer() || FU.lockedTask(t)) return; if (await mailDialog(t, 'remind')) { FU.toast('سُجّل التذكير', 'ok'); FU.refresh(); } };
  /* زرّا البريد والتذكير في بطاقة الإحالة (لمسؤول المتابعة) */
  (FU.taskButtons = FU.taskButtons || []).push(t => (!FU.isOfficer() ? '' : `<button class="btn" data-act="mailTask" data-id="${esc(t.id)}">✉ إرسال الكتاب للإدارة</button>${FU.taskInfo(t).open ? `<button class="btn" data-act="remindTask" data-id="${esc(t.id)}">🔔 تذكير</button>` : ''}`));

  /* ---------- الصيغة الثابتة للرسائل (لمدير البرنامج) ---------- */
  FU.route(/^#\/mail-template$/, () => {
    if (!FU.isAdmin()) return FU.navigate('#/home');
    const ta = (k, rows) => `<textarea name="${k}" rows="${rows}" required>${esc(cfg(k))}</textarea>`, inp = (k, req) => `<input name="${k}" ${req ? 'required' : 'dir="ltr"'} maxlength="300" value="${esc(cfg(k))}">`;
    FU.page(`<a href="#/settings" class="btn small">→ الإعدادات</a><form class="card top-gap" data-form="mailTemplate"><h2>صيغة رسائل البريد</h2>
      <p class="hint">الخانات بين القوسين تُستبدل تلقائياً عند تجهيز الرسالة: ${FIELDS.map(f => '<code>{' + f + '}</code>').join(' ')}</p>
      <div class="stack"><h3>رسالة إحالة الكتاب</h3>${field('الموضوع', inp('mailSubject', true))}${field('النص', ta('mailBody', 11))}
      <h3>رسالة التذكير</h3>${field('الموضوع', inp('remindSubject', true))}${field('النص', ta('remindBody', 10))}
      <h3>بريد المتصفح</h3>${field('رابط إنشاء رسالة في آوت لوك على المتصفح', inp('webMail'), 'اتركه فارغاً لإخفاء زر «بريد المتصفح». إن كان بريدكم على خادم داخلي فاسأل تقنية المعلومات عن الرابط.')}</div>
      <div class="row top-gap"><button class="btn primary">حفظ</button><button type="button" class="btn" data-act="mailDefaults">استعادة الصيغة الافتراضية</button></div></form>`, { title: 'صيغة رسائل البريد' });
  });
  async function saveTemplate(vals) { if (!FU.isAdmin()) return; await FU.state.store.putSettings(Object.assign({}, FU.state.settings, vals)); FU.applySettings(); FU.state.rev++; FU.audit('settings', 'settings'); FU.toast('تم حفظ الصيغة', 'ok'); FU.render(); }
  FU.forms.mailTemplate = (f, v) => { const o = {}; for (const k of Object.keys(DEF)) o[k] = v[k] == null ? '' : String(v[k]); return saveTemplate(o); };
  A.mailDefaults = async () => { if (await FU.confirm('استعادة الصيغة الافتراضية لرسالتي الإحالة والتذكير ورابط بريد المتصفح؟', 'نعم، استعادة')) await saveTemplate(Object.assign({}, DEF)); };

  FU.mail = { DEF, compose, mailtoUrl, webUrl, buildEml };
})();
