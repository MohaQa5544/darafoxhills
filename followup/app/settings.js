/* الإعدادات — برنامج المتابعة: الإدارات، المستخدمون، الإعدادات العامة، النسخ الاحتياطي، سجل الحركات */
(function () {
  const FU = window.FU, { $, esc, field, opts, badge, ROLE, ROLE_HINT, STATUS } = FU;
  const A = FU.actions, FM = FU.forms, me = () => FU.state.user;
  let tab = 'depts';
  const views = {};
  FU.route(/^#\/settings$/, () => {
    if (!FU.isOfficer()) return FU.navigate('#/home');
    const tabs = [['depts', 'الإدارات']]; if (FU.isAdmin()) tabs.push(['users', 'المستخدمون'], ['general', 'إعدادات عامة'], ['data', 'البيانات والنسخ الاحتياطي']); tabs.push(['audit', 'سجل الحركات']);
    if (!tabs.some(x => x[0] === tab)) tab = 'depts';
    FU.page(`<h2>الإعدادات</h2><div class="subtabs">${tabs.map(x => `<button data-act="stab" data-t="${x[0]}" ${x[0] === tab ? 'aria-current="true"' : ''}>${x[1]}</button>`).join('')}</div>${views[tab]()}`, { title: 'الإعدادات', wide: true });
  });
  A.stab = el => { tab = el.dataset.t; FU.render(); };

  /* ---------- الإدارات ---------- */
  views.depts = () => {
    const rows = FU.depts(true).map(d => {
      const nt = FU.list('tasks', t => t.deptId === d.id).length, us = FU.list('users', u => u.deptId === d.id && u.active && (u.role === 'rep' || u.role === 'dviewer'));
      return `<tr class="${d.active ? '' : 'inactive'}"><td class="c num">${esc(d.order)}</td><td><b>${esc(d.name)}</b></td><td class="c num">${nt}</td><td>${us.length ? us.map(u => esc(u.name) + ' <span class="muted small">(' + esc(ROLE[u.role]) + ')</span>').join('، ') : '<span class="muted">لا يوجد — يسجّل مسؤول المتابعة إفاداتها</span>'}</td><td class="c">${d.active ? badge('فعّالة', 'ok') : badge('موقوفة', 'gray')}</td>
        <td class="c nowrap"><button class="linkbtn" data-act="editDept" data-id="${esc(d.id)}">تعديل</button> · <button class="linkbtn" data-act="toggleDept" data-id="${esc(d.id)}">${d.active ? 'إيقاف' : 'تفعيل'}</button>${nt || us.length ? '' : ` · <button class="linkbtn danger" data-act="delDept" data-id="${esc(d.id)}">حذف</button>`}</td></tr>`;
    }).join('');
    return `<div class="card"><div class="row between"><h3>جهات الاختصاص</h3><button class="btn primary small" data-act="editDept">＋ إدارة جديدة</button></div>
      <p class="hint">الإدارة الموقوفة لا تظهر عند إحالة كتب جديدة، وتبقى كتبها السابقة كما هي.</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th>الترتيب</th><th>الإدارة</th><th>عدد التكليفات</th><th>مستخدموها</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  };
  A.editDept = async el => {
    if (!FU.isOfficer()) return;
    const d = el.dataset.id ? FU.byId('depts', el.dataset.id) : null, next = FU.depts(true).reduce((m, x) => Math.max(m, Number(x.order) || 0), 0) + 1;
    const ok = await FU.modal({ title: d ? 'تعديل الإدارة' : 'إدارة جديدة', body: field('اسم الإدارة', `<input name="name" required maxlength="100" value="${esc(d ? d.name : '')}">`) + field('الترتيب في القوائم', `<input type="number" name="order" min="1" max="999" required value="${esc(d ? d.order : next)}">`),
      onOk: async (form, v) => {
        if (FU.list('depts', x => x.id !== (d && d.id) && FU.norm(x.name) === FU.norm(v.name)).length) throw new Error('توجد إدارة بهذا الاسم');
        if (d) await FU.update('depts', d.id, c => { c.name = v.name; c.order = Number(v.order) || c.order; }, 'dept_edit', { name: v.name });
        else await FU.save('depts', { id: FU.uid(), name: v.name, order: Number(v.order) || next, active: true }, 'dept_add', { name: v.name });
      } });
    if (ok) FU.refresh();
  };
  A.toggleDept = async el => { const d = FU.byId('depts', el.dataset.id); if (!d || !FU.isOfficer()) return; await FU.update('depts', d.id, c => { c.active = !c.active; }, 'dept_edit', { name: d.name, active: !d.active }); FU.refresh(); };
  A.delDept = async el => { const d = FU.byId('depts', el.dataset.id); if (!d || !FU.isOfficer() || FU.list('tasks', t => t.deptId === d.id).length) return; if (!(await FU.confirm(`حذف الإدارة «${d.name}»؟`, 'نعم، حذف'))) return; await FU.remove('depts', d.id, { name: d.name }); FU.refresh(); };

  /* ---------- المستخدمون (لمدير البرنامج) ---------- */
  const scoped = r => r === 'rep' || r === 'dviewer';
  views.users = () => {
    const order = ['admin', 'officer', 'viewer', 'rep', 'dviewer'];
    const rows = FU.list('users').sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || FU.byName(a, b)).map(u => `<tr class="${u.active ? '' : 'inactive'}"><td><b>${esc(u.name)}</b>${u.title ? `<div class="muted small">${esc(u.title)}</div>` : ''}</td><td dir="ltr" class="c">${esc(u.username)}</td><td>${esc(ROLE[u.role] || u.role)}<div class="muted small">${esc(ROLE_HINT[u.role] || '')}</div></td><td>${scoped(u.role) ? esc(FU.deptName(u.deptId)) : '<span class="muted">كل الإدارات</span>'}</td><td class="c">${u.active ? (u.mustChange ? badge('لم يغيّر كلمة المرور', 'warn') : badge('فعّال', 'ok')) : badge('معطَّل', 'gray')}</td>
      <td class="c nowrap"><button class="linkbtn" data-act="editUser" data-id="${esc(u.id)}">تعديل</button> · <button class="linkbtn" data-act="resetUser" data-id="${esc(u.id)}">إعادة كلمة المرور</button>${u.id === me().id ? '' : ` · <button class="linkbtn" data-act="toggleUser" data-id="${esc(u.id)}">${u.active ? 'تعطيل' : 'تفعيل'}</button>`}</td></tr>`).join('');
    return `<div class="card"><div class="row between"><h3>المستخدمون</h3><button class="btn primary small" data-act="editUser">＋ مستخدم جديد</button></div>
      <p class="hint">المستخدم الجديد يدخل بكلمة المرور الأولية 123456 ويُلزَم بتغييرها عند أول دخول (6 خانات على الأقل).</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th>الاسم</th><th>اسم المستخدم</th><th>الصلاحية</th><th>النطاق</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  };
  A.editUser = async el => {
    if (!FU.isAdmin()) return; const u = el.dataset.id ? FU.byId('users', el.dataset.id) : null, self = u && u.id === me().id;
    const body = `<div class="grid2">
      ${field('الاسم', `<input name="name" required maxlength="100" value="${esc(u ? u.name : '')}">`)}
      ${field('اسم المستخدم', `<input name="username" required maxlength="40" dir="ltr" pattern="[A-Za-z0-9._\\-]+" value="${esc(u ? u.username : '')}">`, 'ما قبل @ في البريد — حروف لاتينية وأرقام')}
      ${field('الصفة الوظيفية (اختياري)', `<input name="title" maxlength="150" value="${esc(u ? u.title : '')}">`)}
      ${field('البريد الإلكتروني (اختياري)', `<input name="email" type="email" dir="ltr" maxlength="120" value="${esc(u ? u.email : '')}">`)}
      ${field('الصلاحية', `<select name="role" ${self ? 'disabled' : ''}>${opts(Object.keys(ROLE).map(k => [k, ROLE[k] + ' — ' + ROLE_HINT[k]]), u ? u.role : 'dviewer')}</select>`, '', 'span2')}
      ${field('الإدارة', `<select name="deptId">${opts([['', '— اختر الإدارة —']].concat(FU.depts(true).map(d => [d.id, d.name])), u ? u.deptId : '')}</select>`, 'يرى كتب هذه الإدارة فقط', 'span2 dept-field')}</div>`;
    const ok = await FU.modal({ title: u ? 'تعديل المستخدم' : 'مستخدم جديد', body, wide: true,
      onOpen: form => { const r = form.elements.role, sync = () => form.querySelector('.dept-field').classList.toggle('hidden', !scoped(r.value)); r.addEventListener('change', sync); sync(); },
      onOk: async (form, v) => {
        const username = v.username.toLowerCase().replace(/@.*$/, ''), role = self ? u.role : v.role;
        if (!/^[a-z0-9._-]+$/.test(username)) throw new Error('اسم المستخدم بحروف لاتينية وأرقام فقط');
        if (!ROLE[role]) throw new Error('اختر الصلاحية');
        if (FU.list('users', x => x.id !== (u && u.id) && String(x.username).toLowerCase() === username).length) throw new Error('اسم المستخدم مستعمل لحساب آخر');
        if (scoped(role) && !FU.byId('depts', v.deptId)) throw new Error('اختر إدارة المستخدم');
        const f = { name: v.name, username, title: v.title || '', email: v.email || '', role, deptId: scoped(role) ? v.deptId : null };
        if (u) { await FU.update('users', u.id, c => Object.assign(c, f), 'user_edit', { name: f.name, role: ROLE[role] }); if (self) FU.state.user = FU.byId('users', u.id); return; }
        const rec = Object.assign({ id: FU.uid(), active: true, mustChange: true, salt: FU.uid() }, f); rec.hash = await FU.hashPassword('123456', rec.salt);
        await FU.save('users', rec, 'user_add', { name: f.name, role: ROLE[role] });
      } });
    if (ok) { FU.toast(u ? 'تم الحفظ' : 'أُضيف المستخدم — كلمة المرور الأولية 123456', 'ok'); FU.refresh(); }
  };
  A.resetUser = async el => {
    const u = FU.byId('users', el.dataset.id); if (!u || !FU.isAdmin()) return;
    if (!(await FU.confirm(`إعادة كلمة مرور «${u.name}» إلى 123456؟ سيُطلب منه تغييرها عند الدخول.`, 'نعم، إعادة'))) return;
    await FU.setPassword(u.id, '123456', true); FU.toast('أُعيدت كلمة المرور إلى 123456', 'ok'); FU.refresh();
  };
  A.toggleUser = async el => { const u = FU.byId('users', el.dataset.id); if (!u || !FU.isAdmin() || u.id === me().id) return; await FU.update('users', u.id, c => { c.active = !c.active; }, 'user_edit', { name: u.name, active: !u.active }); FU.refresh(); };

  /* ---------- إعدادات عامة ---------- */
  views.general = () => {
    const s = FU.state.settings, num = (k, max) => `<input type="number" name="${k}" min="0" max="${max}" required value="${esc(s[k])}">`, txt = k => `<input name="${k}" required maxlength="120" value="${esc(s[k])}">`;
    return `<form class="card" data-form="general"><h3>إعدادات عامة</h3><div class="grid2">
      ${field('المدة المتوقعة الافتراضية (أيام)', num('defaultDays', 365), 'تظهر عند تسجيل كتاب جديد ويمكن تغييرها لكل إحالة')}
      ${field('التنبيه قبل الاستحقاق (أيام)', num('soonDays', 60), 'تُعدّ الإحالة «تستحق قريباً» إذا بقي لها هذا العدد أو أقل')}
      ${field('حد الإفادات قبل التنبيه', num('escalateAfter', 50), 'إحالة بلغت هذا العدد من الإفادات دون إنجاز تظهر ضمن «تحتاج انتباهاً». الصفر يلغي التنبيه')}
      <label class="field check"><input type="checkbox" name="workdays" ${s.workdays ? 'checked' : ''}><span>احتساب المدد بأيام العمل فقط (دون الجمعة والسبت)</span></label>
      ${field('اسم البرنامج', txt('appName'))}${field('الوصف', txt('subtitle'))}${field('الجهة المشرفة', txt('unitName'))}${field('الإدارة العامة', txt('orgName'))}${field('الوزارة', txt('ministryName'), '', 'span2')}
      </div><div class="row top-gap"><button class="btn primary">حفظ الإعدادات</button></div></form>`;
  };
  FM.general = async (f, v) => {
    if (!FU.isAdmin()) return; const s = Object.assign({}, FU.state.settings);
    for (const k of ['defaultDays', 'soonDays', 'escalateAfter']) { const n = Number(v[k]); if (!(n >= 0) || Math.round(n) !== n) throw new Error('أدخل أعداداً صحيحة غير سالبة'); s[k] = n; }
    for (const k of ['appName', 'subtitle', 'unitName', 'orgName', 'ministryName']) { if (!v[k]) throw new Error('لا تترك الأسماء فارغة'); s[k] = v[k]; }
    s.workdays = !!v.workdays; await FU.state.store.putSettings(s); FU.applySettings(); FU.state.rev++; FU.audit('settings', 'settings'); FU.toast('تم حفظ الإعدادات', 'ok'); FU.refresh();
  };

  /* ---------- البيانات والنسخ الاحتياطي ---------- */
  views.data = () => {
    const d = FU.db(), store = FU.state.store;
    return `<div class="card"><h3>مكان البيانات</h3><p>${store.mode === 'folder' ? '📁' : '💾'} ${esc(store.describe())}</p>
      <p class="muted">${d.letters.length} كتاب · ${d.tasks.length} إحالة · ${d.updates.length} إفادة · ${d.users.length} مستخدم</p>
      ${store.conflicts ? `<div class="note warn">في مجلد البيانات ${store.conflicts} ملف «نسخة متعارضة» أنشأها دروب بوكس وتجاهلها البرنامج. راجعها في مجلد data ثم احذفها.</div>` : ''}
      <div class="row wrap"><button class="btn" data-act="changeStore">تغيير مكان البيانات</button></div></div>
      <div class="card"><h3>النسخ الاحتياطي</h3><p class="hint">خذ نسخة شهرياً. النسخة ملف واحد يضم كل السجلات${store.mode === 'folder' ? '، أما المرفقات فتبقى في مجلد data/files' : ' والمرفقات'}. الاستعادة دمج: السجل الموجود في النسخة يستبدل نظيره، وما سواه يبقى.</p>
      <div class="row wrap"><button class="btn primary" data-act="backup">⬇ تنزيل نسخة احتياطية</button><label class="btn">⬆ استعادة من نسخة<input type="file" accept=".json,application/json" hidden data-change="restore"></label></div></div>`;
  };
  A.backup = async () => { FU.download('نسخة-المتابعة-' + FU.today() + '.json', await FU.state.store.exportAll(), 'application/json'); FU.audit('backup', 'settings'); };
  A['change:restore'] = async el => {
    const file = el.files[0]; el.value = ''; if (!file || !FU.isAdmin()) return; let d;
    try { d = JSON.parse(await file.text()); } catch (e) { throw new Error('الملف ليس نسخة صالحة'); }
    if (!d || d.app !== 'followup' || !Array.isArray(d.letters)) throw new Error('الملف ليس نسخة احتياطية من هذا البرنامج');
    if (!(await FU.confirm(`استعادة نسخة ${FU.fmtDateTime(d.exportedAt)}: ${d.letters.length} كتاب و${(d.tasks || []).length} إحالة و${(d.updates || []).length} إفادة. تُدمج مع البيانات الحالية وتستبدل السجلات المتطابقة. متابعة؟`, 'نعم، استعادة'))) return;
    await FU.state.store.importAll(d); await FU.audit('import', 'settings', null, { letters: d.letters.length }); await FU.reload(true); FU.toast('تمت الاستعادة', 'ok');
  };
  A.changeStore = async () => { if (await FU.confirm('سيُغلق البرنامج ويعود إلى شاشة اختيار مكان البيانات. البيانات الحالية تبقى في مكانها. متابعة؟')) await FU.resetStore(); };

  /* ---------- سجل الحركات ---------- */
  const ACT = { login: 'دخول', logout: 'خروج', letter_add: 'تسجيل كتاب', letter_edit: 'تعديل كتاب', task_add: 'إحالة إلى إدارة', task_edit: 'تعديل إحالة', status: 'تغيير حالة', update_add: 'إضافة إفادة', update_edit: 'تعديل إفادة', file_add: 'إرفاق ملف', file_del: 'حذف مرفق', delete: 'حذف', password_change: 'تغيير كلمة المرور', password_reset: 'إعادة كلمة مرور', user_add: 'إضافة مستخدم', user_edit: 'تعديل مستخدم', dept_add: 'إضافة إدارة', dept_edit: 'تعديل إدارة', settings: 'تعديل الإعدادات', backup: 'نسخة احتياطية', import: 'استعادة نسخة' };
  const ENT = { letters: 'كتاب', tasks: 'إحالة', updates: 'إفادة', users: 'مستخدم', depts: 'إدارة' };
  const LBL = { number: 'رقم الكتاب', subject: 'الموضوع', dept: 'الإدارة', name: 'الاسم', role: 'الصلاحية', files: 'الملف', kind: 'النوع', letters: 'عدد الكتب' };
  function detail(a) {
    const d = a.detail || {}, p = [];
    if (a.action === 'delete' && ENT[a.entity]) p.push(ENT[a.entity]);
    if (d.from || d.to) p.push(((STATUS[d.from] || {}).t || '—') + ' ← ' + ((STATUS[d.to] || {}).t || '—'));
    for (const k of Object.keys(LBL)) if (d[k] != null && d[k] !== '') p.push(LBL[k] + ': ' + d[k]);
    if (typeof d.active === 'boolean') p.push(d.active ? 'تفعيل' : 'إيقاف');
    return p.join(' · ');
  }
  views.audit = () => {
    const names = new Map(FU.list('users').map(u => [u.id, u.name])), all = FU.db().audit, rows = all.slice(-400).reverse();
    return `<div class="card"><h3>سجل الحركات</h3><p class="hint">آخر ${rows.length} حركة من أصل ${all.length}.</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th>الوقت</th><th>المستخدم</th><th>الحركة</th><th>التفاصيل</th></tr></thead><tbody>${rows.map(a => `<tr><td class="nowrap num">${esc(FU.fmtDateTime(a.at))}</td><td>${esc(names.get(a.actor) || a.actorName || '—')}</td><td>${esc(ACT[a.action] || a.action)}</td><td>${esc(detail(a))}</td></tr>`).join('') || '<tr><td colspan="4" class="muted c">لا توجد حركات بعد</td></tr>'}</tbody></table></div></div>`;
  };
})();
