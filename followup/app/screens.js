/* الشاشات — برنامج المتابعة: الدخول، الرئيسية، سجل المتابعة، صفحة الكتاب ونوافذها */
(function () {
  const FU = window.FU, { $, esc, nl2br, field, opts, badge, statusBadge, dueBadge, fmtDate, STATUS, KIND } = FU;
  const A = FU.actions, FM = FU.forms, me = () => FU.state.user, cfg = () => FU.state.settings;
  const KIND_CLASS = { action: 'soft', follow: 'blue', directive: 'violet', status: 'gray' };
  const myTasks = () => FU.list('tasks', FU.canSeeTask);
  const letterOf = t => FU.byId('letters', t.letterId) || { id: '', subject: '—', number: '' };
  /* إعادة رسم الشاشة الحالية مع البقاء في موضع التمرير نفسه */
  async function refresh() { const y = window.scrollY; await FU.render(); window.scrollTo(0, y); }

  /* ---------- الدخول وكلمة المرور ---------- */
  FU.screens.login = function () {
    const s = cfg(), store = FU.state.store; document.body.classList.remove('print-mode'); document.title = s.appName;
    $('#app').innerHTML = `<div class="setup"><form class="setup-card narrow" data-form="login">${FU.logo('awqaf', 'setup-logo')}<h1>${esc(s.appName)}</h1><p class="muted">${esc(s.subtitle)} — ${esc(s.unitName)} · ${esc(s.orgName)}</p>
      ${field('اسم المستخدم', '<input name="username" required autocomplete="username" dir="ltr">', 'ما قبل @ في بريدك الإلكتروني')}
      ${field('كلمة المرور', '<input type="password" name="password" required autocomplete="current-password" dir="ltr">')}
      <button class="btn primary big">دخول</button>
      <p class="hint">${store.mode === 'folder' ? '📁' : '💾'} ${esc(store.describe())}</p></form></div>`;
    $('input[name=username]').focus();
  };
  FM.login = async f => { await FU.login(f.username.value, f.password.value); FU.navigate(location.hash && location.hash !== '#/password' ? location.hash : '#/home'); };
  FU.route(/^#\/password$/, () => {
    const u = me();
    FU.page(`<div class="card narrow"><h2>${u.mustChange ? 'اختر كلمة مرور جديدة' : 'تغيير كلمة المرور'}</h2>
      ${u.mustChange ? '<div class="note warn">كلمة المرور الأولية مؤقتة. اختر كلمة مرور خاصة بك للمتابعة.</div>' : ''}
      <form data-form="password" class="stack">
        ${u.mustChange ? '' : field('كلمة المرور الحالية', '<input type="password" name="current" required dir="ltr">')}
        ${field('كلمة المرور الجديدة', '<input type="password" name="next" required dir="ltr">', '6 خانات على الأقل، دون أي شروط أخرى')}
        ${field('تأكيد كلمة المرور الجديدة', '<input type="password" name="again" required dir="ltr">')}
        <div class="row"><button class="btn primary">حفظ</button></div>
      </form></div>`, { title: 'كلمة المرور' });
  });
  FM.password = async f => {
    const u = me(), next = f.next.value;
    if (!u.mustChange && (await FU.hashPassword(f.current.value, u.salt)) !== u.hash) throw new Error('كلمة المرور الحالية غير صحيحة');
    if (next.length < 6) throw new Error('كلمة المرور الجديدة أقل من 6 خانات');
    if (next === '123456') throw new Error('اختر كلمة مرور غير كلمة المرور الأولية');
    if (next !== f.again.value) throw new Error('التأكيد لا يطابق كلمة المرور الجديدة');
    await FU.setPassword(u.id, next, false); FU.toast('تم حفظ كلمة المرور', 'ok'); FU.navigate('#/home');
  };

  /* ---------- الرئيسية ---------- */
  const ORDER = ['not_received', 'in_progress', 'problem', 'done', 'no_action'];
  /* ملخص الإدارات: عدد التكليفات في كل حالة، والمتأخر، ونسبة ما أُنجز في موعده */
  function deptTable(tasks, print) {
    const rows = FU.depts(true).map(d => ({ d, s: FU.stats(tasks.filter(t => t.deptId === d.id)) })).filter(x => x.d.active || x.s.total);
    const cell = (n, cls) => `<td class="c num ${n && cls ? cls : ''}">${n || '<span class="muted">0</span>'}</td>`;
    const bar = s => (s.total ? `<div class="bar">${ORDER.map(k => (s[k] ? `<i class="s-${STATUS[k].c}" style="flex:${s[k]}" title="${esc(STATUS[k].t)}: ${s[k]}"></i>` : '')).join('')}</div>` : '');
    const line = (name, s, strong) => `<tr class="${strong ? 'total' : ''}"><td>${name}</td>${cell(s.not_received)}${cell(s.in_progress)}${cell(s.problem, 'bad-text')}${cell(s.overdue, 'bad-text')}${cell(s.done)}${cell(s.no_action)}<td class="c num"><b>${s.total}</b></td><td class="c num">${s.done ? Math.round(s.ontime * 100 / s.done) + '%' : '—'}</td>${print ? '' : `<td class="barcell">${bar(s)}</td>`}</tr>`;
    return `<div class="table-wrap"><table class="grid"><thead><tr><th>جهة الاختصاص</th><th>لم تُستلم</th><th>تحت الإجراء</th><th>يوجد مشكلة</th><th>متأخرة</th><th>تم التنفيذ</th><th>لا إجراء</th><th>الإجمالي</th><th>الإنجاز في الموعد</th>${print ? '' : '<th>توزيع الحالات</th>'}</tr></thead><tbody>
      ${rows.map(x => line(print ? esc(x.d.name) : `<button class="linkbtn" data-act="preset" data-dept="${esc(x.d.id)}">${esc(x.d.name)}</button>`, x.s)).join('')}
      ${rows.length > 1 ? line('<b>الإجمالي</b>', FU.stats(tasks), true) : ''}</tbody></table></div>`;
  }
  /* ما يحتاج انتباهاً: المتأخر، وما فيه مشكلة، وما تجاوز حد الإفادات دون إنجاز — الأشد تأخراً أولاً */
  const attention = tasks => tasks.map(t => ({ t, i: FU.taskInfo(t) })).filter(x => x.i.attention).sort((a, b) => (a.i.left == null ? 0 : a.i.left) - (b.i.left == null ? 0 : b.i.left));
  const escalBadge = i => (i.escal ? badge(i.n + ' إفادات دون إنجاز', 'violet') : '');
  FU.route(/^#\/home$/, () => {
    const tasks = myTasks(), s = FU.stats(tasks), u = me(), set = cfg(), dept = FU.inDept();
    const tile = (n, label, f, cls) => `<button class="tile ${n ? cls || '' : ''}" data-act="preset" data-status="${f}"><b class="num">${n}</b><span>${label}</span></button>`;
    const att = attention(tasks), vis = new Set(tasks.map(t => t.id));
    const recent = FU.list('updates', x => x.text && vis.has(x.taskId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8);
    const waiting = u.role === 'rep' ? tasks.filter(t => t.status === 'not_received') : [];
    const unassigned = dept ? 0 : FU.list('letters', l => !FU.letterTasks(l.id).length).length;
    FU.page(`<div class="row between"><div><h2>مرحباً، ${esc(u.name)}</h2><p class="muted">${esc(FU.fmtLong(FU.today()))}${dept ? ' · ' + esc(FU.deptName(u.deptId)) : ''}</p></div>
      <div class="row wrap">${FU.isOfficer() ? '<button class="btn primary" data-act="newLetter">＋ كتاب جديد</button>' : ''}<a class="btn" href="#/print/summary">🖨 طباعة الملخص</a></div></div>
      <div class="tiles">${tile(s.open, 'تكليفات مفتوحة', 'open', 't-green')}${tile(s.overdue, 'متأخرة عن موعدها', 'overdue', 't-bad')}${tile(s.soon, set.soonDays > 0 ? 'تستحق خلال ' + (set.soonDays === 2 ? 'يومين' : FU.daysWord(set.soonDays)) : 'تستحق اليوم', 'soon', 't-warn')}${tile(s.problem, 'يوجد مشكلة', 'problem', 't-bad')}${tile(s.not_received, 'لم تُستلم مذكرتها', 'not_received', 't-gray')}${tile(s.done, 'تم تنفيذها', 'done', 't-ok')}</div>
      ${unassigned ? `<div class="note warn">${unassigned === 1 ? 'كتاب واحد لم يُحَل' : unassigned + ' كتب لم تُحَل'} إلى أي إدارة بعد. <button class="linkbtn" data-act="preset" data-status="unassigned">عرضها</button></div>` : ''}
      ${waiting.length ? `<div class="card"><h3>بانتظار تأكيد استلام المذكرة (${waiting.length})</h3>${waiting.map(t => { const l = letterOf(t); return `<div class="att"><a href="#/letter/${esc(l.id)}"><b>${esc(l.subject)}</b> <span class="muted">· رقم ${esc(l.number)} · ${fmtDate(l.date)}</span></a><span class="grow"></span>${dueBadge(t)}<button class="btn small primary" data-act="confirmReceipt" data-id="${esc(t.id)}">✔ تأكيد الاستلام</button></div>`; }).join('')}</div>` : ''}
      ${dept ? '' : `<div class="card"><h3>ملخص الإدارات</h3>${tasks.length ? deptTable(tasks) : '<p class="muted">لا توجد تكليفات مسجّلة بعد.</p>'}</div>`}
      <div class="grid2 cols">
        <div class="card"><div class="row between"><h3>تحتاج انتباهاً (${att.length})</h3>${att.length > 10 ? '<button class="linkbtn" data-act="preset" data-status="attention">عرض الكل</button>' : ''}</div>
          ${att.length ? att.slice(0, 10).map(x => { const l = letterOf(x.t); return `<a class="att" href="#/letter/${esc(l.id)}"><div class="grow"><b>${esc(l.subject)}</b><div class="muted small">رقم ${esc(l.number)}${dept ? '' : ' · ' + esc(FU.deptName(x.t.deptId))}</div></div><div class="row wrap end">${statusBadge(x.t.status)}${dueBadge(x.t, x.i)}${escalBadge(x.i)}</div></a>`; }).join('') : '<p class="muted">لا يوجد متأخر ولا مشكلات. 👍</p>'}</div>
        <div class="card"><h3>آخر الإفادات</h3>
          ${recent.length ? recent.map(x => { const l = FU.byId('letters', x.letterId) || { subject: '—' }; return `<a class="att col" href="#/letter/${esc(x.letterId)}"><div class="row wrap"><b>${fmtDate(x.date)}</b>${badge(KIND[x.kind] || x.kind, KIND_CLASS[x.kind])}<span class="muted small">${esc(FU.deptName(x.deptId))} · ${esc(x.byName || '')}</span></div><div class="clip">${esc(x.text)}</div><div class="muted small clip1">${esc(l.subject)}</div></a>`; }).join('') : '<p class="muted">لا توجد إفادات بعد.</p>'}</div>
      </div>`, { title: 'الرئيسية', wide: true });
  });

  /* ---------- سجل المتابعة ---------- */
  const F = { q: '', dept: '', status: '', follower: '', year: '', sort: 'new', limit: 100 };
  const SPECIAL = { open: 'المفتوحة', overdue: 'المتأخرة', soon: 'تستحق قريباً', attention: 'تحتاج انتباهاً', escal: 'تجاوزت حد الإفادات', closed: 'المغلقة' };
  A.preset = el => { Object.assign(F, { q: '', dept: el.dataset.dept || '', status: el.dataset.status || '', follower: '', year: '', limit: 100 }); FU.navigate('#/register'); };
  function matchTask(t) {
    if (F.dept && t.deptId !== F.dept) return false;
    if (F.follower && t.followerId !== F.follower) return false;
    if (!F.status) return true; const i = FU.taskInfo(t);
    switch (F.status) { case 'open': return i.open; case 'closed': return !i.open; case 'overdue': return i.overdue; case 'soon': return i.soon; case 'escal': return i.escal; case 'attention': return i.attention; default: return t.status === F.status; }
  }
  /* نتيجة التصفية: قائمة كتب، ومع كل كتاب تكليفاته المطابقة التي يحق للمستخدم رؤيتها */
  function query() {
    const words = FU.norm(F.q).split(/\s+/).filter(Boolean), taskFilter = !!(F.dept || F.follower || F.status), out = [];
    for (const l of FU.list('letters')) {
      if (F.year && String(l.date || '').slice(0, 4) !== F.year) continue;
      const all = FU.letterTasks(l.id), seen = all.filter(FU.canSeeTask); let ts = [];
      if (FU.inDept() && !seen.length) continue;
      if (F.status === 'unassigned') { if (all.length) continue; }
      else { ts = seen.filter(matchTask); if (!ts.length && (taskFilter || all.length)) continue; }
      if (words.length) {
        const hay = FU.norm([l.seq, l.subject, l.number, l.from, l.notes].concat(ts.map(t => FU.deptName(t.deptId) + ' ' + FU.taskUpdates(t.id).map(u => (u.text || '') + ' ' + (u.replyNo || '')).join(' '))).join(' '));
        if (!words.every(w => hay.includes(w))) continue;
      }
      out.push({ l, ts });
    }
    const key = x => (x.l.date || '') + String(x.l.seq || 0).padStart(7, '0');
    const dueKey = x => { let m = '9999'; for (const t of x.ts) { const i = FU.taskInfo(t); if (i.open && i.due && i.due < m) m = i.due; } return m; };
    const desc = (a, b) => (key(a) < key(b) ? 1 : -1);
    out.sort(F.sort === 'old' ? (a, b) => -desc(a, b) : F.sort === 'due' ? (a, b) => { const x = dueKey(a), y = dueKey(b); return x < y ? -1 : x > y ? 1 : desc(a, b); } : desc);
    return out;
  }
  function regTable(groups, print) {
    const rows = groups.map(g => {
      const l = g.l, n = Math.max(1, g.ts.length), rs = n > 1 ? ` rowspan="${n}"` : '';
      const head = `<td class="c num"${rs}>${esc(l.seq)}</td><td class="subj"${rs}>${print ? esc(l.subject) : `<a href="#/letter/${esc(l.id)}">${esc(l.subject)}</a>`}${l.priority === 'urgent' ? ' ' + badge('عاجل', 'bad') : ''}${l.from ? `<div class="muted small">من: ${esc(l.from)}</div>` : ''}</td><td class="c"${rs}>${esc(l.number)}</td><td class="c num"${rs}>${fmtDate(l.date)}</td>`;
      if (!g.ts.length) return `<tr class="first">${head}<td colspan="7" class="muted c">لم يُحَل إلى أي إدارة بعد</td></tr>`;
      return g.ts.map((t, k) => {
        const i = FU.taskInfo(t), c = i.st.c;
        return `<tr class="${k ? '' : 'first'}">${k ? '' : head}<td class="tc s-${c}">${esc(FU.deptName(t.deptId))}</td><td class="tc s-${c} c">${statusBadge(t.status)}${escalBadge(i)}</td><td class="tc s-${c} c num">${t.days === '' || t.days == null ? '—' : esc(t.days)}</td><td class="tc s-${c} c num">${i.due ? fmtDate(i.due) + '<br>' : ''}${dueBadge(t, i)}</td><td class="tc s-${c} c num">${i.n}</td><td class="tc s-${c}">${t.followerId ? esc(FU.userName(t.followerId)) : '<span class="muted">—</span>'}</td><td class="tc s-${c} last">${i.last ? `<div class="${print ? '' : 'clip'}">${esc(i.last.text)}</div><div class="muted small">${fmtDate(i.last.date)} · ${esc(i.last.byName || '')}</div>` : '<span class="muted">—</span>'}</td></tr>`;
      }).join('');
    }).join('');
    return `<table class="grid reg"><thead><tr><th>م</th><th>الموضوع</th><th>رقم الكتاب</th><th>تاريخ الكتاب الوارد</th><th>جهة الاختصاص</th><th>حالة الإجراء</th><th>المدة (أيام)</th><th>الاستحقاق</th><th>عدد الإفادات</th><th>موظف المتابعة</th><th>آخر إفادة</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  const statusOptions = () => [['', 'كل الحالات']].concat(Object.keys(SPECIAL).map(k => [k, SPECIAL[k]]), Object.keys(STATUS).map(k => [k, STATUS[k].t]), FU.inDept() ? [] : [['unassigned', 'كتب لم تُحَل بعد']]);
  /* وصف التصفية الحالية بالكلمات (يظهر في رأس التقرير المطبوع) */
  function filterSummary() {
    const p = []; if (FU.inDept()) p.push(FU.deptName(me().deptId)); else if (F.dept) p.push(FU.deptName(F.dept));
    if (F.status) p.push((statusOptions().find(x => x[0] === F.status) || [])[1]);
    if (F.follower) p.push('موظف المتابعة: ' + FU.userName(F.follower)); if (F.year) p.push('سنة ' + F.year); if (F.q.trim()) p.push('بحث: ' + F.q.trim());
    return p.length ? p.join(' · ') : 'كل الكتاب والتكليفات';
  }
  function drawReg() {
    const el = $('#reg-out'); if (!el) return; const g = query(), shown = g.slice(0, F.limit), nt = g.reduce((a, x) => a + x.ts.length, 0);
    el.innerHTML = `<p class="muted small">${g.length} كتاب · ${nt} تكليف</p>` + (g.length ? `<div class="table-wrap">${regTable(shown)}</div>${g.length > shown.length ? `<p class="c"><button class="btn" data-act="more">عرض المزيد (${g.length - shown.length})</button></p>` : ''}`
      : `<div class="card empty">${FU.list('letters').length ? 'لا توجد نتائج مطابقة للتصفية.' : 'لا توجد كتب مسجّلة بعد.' + (FU.isOfficer() ? ' ابدأ بزر «＋ كتاب جديد».' : '')}</div>`);
  }
  FU.route(/^#\/register$/, () => {
    const years = [...new Set(FU.list('letters').map(l => String(l.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const sel = (k, pairs, label) => `<select data-change="freg" data-k="${k}" aria-label="${label}">${opts(pairs, F[k])}</select>`;
    FU.page(`<div class="row between"><h2>سجل المتابعة</h2><div class="row wrap">${FU.isOfficer() ? '<button class="btn primary" data-act="newLetter">＋ كتاب جديد</button>' : ''}<a class="btn" href="#/print/register">🖨 طباعة التقرير</a><button class="btn" data-act="exportCsv">⬇ تصدير Excel</button></div></div>
      <div class="card filters"><input type="search" data-input="fq" value="${esc(F.q)}" placeholder="بحث في الموضوع أو رقم الكتاب أو نص الإفادات…" aria-label="بحث">
        ${FU.inDept() ? '' : sel('dept', [['', 'كل الإدارات']].concat(FU.depts(true).map(d => [d.id, d.name])), 'جهة الاختصاص')}
        ${sel('status', statusOptions(), 'الحالة')}
        ${sel('follower', [['', 'كل موظفي المتابعة']].concat(FU.list('users', u => u.role === 'officer').sort(FU.byName).map(u => [u.id, u.name])), 'موظف المتابعة')}
        ${sel('year', [['', 'كل السنوات']].concat(years.map(y => [y, y])), 'السنة')}
        ${sel('sort', [['new', 'الأحدث أولاً'], ['old', 'الأقدم أولاً'], ['due', 'الأقرب استحقاقاً']], 'الترتيب')}
        <button class="btn small" data-act="clearFilters">مسح التصفية</button></div>
      <div id="reg-out"></div>`, { title: 'سجل المتابعة', wide: true });
    drawReg();
  });
  let tq = null;
  A['input:fq'] = el => { F.q = el.value; F.limit = 100; clearTimeout(tq); tq = setTimeout(drawReg, 180); };
  A['change:freg'] = el => { F[el.dataset.k] = el.value; F.limit = 100; drawReg(); };
  A.more = () => { F.limit += 100; drawReg(); };
  A.clearFilters = () => { Object.assign(F, { q: '', dept: '', status: '', follower: '', year: '', sort: 'new', limit: 100 }); FU.render(); };

  /* ---------- صفحة الكتاب ---------- */
  const meta = pairs => `<dl class="meta">${pairs.filter(Boolean).map(p => `<div><dt>${p[0]}</dt><dd>${p[1]}</dd></div>`).join('')}</dl>`;
  function upItem(u) {
    const own = u.byId === me().id, off = FU.isOfficer(), canEdit = (off || own) && u.kind !== 'status', canDel = off || (own && !u.status);
    return `<li class="up k-${esc(u.kind)}"><div class="up-head"><b class="num">${fmtDate(u.date)}</b>${badge(KIND[u.kind] || u.kind, KIND_CLASS[u.kind])}${u.status ? `<span class="arrow">←</span>${statusBadge(u.status)}` : ''}<span class="muted small">${esc(u.byName || FU.userName(u.byId))}${u.editedAt ? ' · عُدّلت' : ''}</span><span class="grow"></span>${canEdit ? `<button class="linkbtn small no-print" data-act="editUpdate" data-id="${esc(u.id)}">تعديل</button>` : ''}${canDel ? `<button class="linkbtn small danger no-print" data-act="delUpdate" data-id="${esc(u.id)}">حذف</button>` : ''}</div>
      ${u.text ? `<div class="up-text">${nl2br(u.text)}</div>` : ''}${u.replyNo ? `<div class="small">رقم كتاب الرد: <b>${esc(u.replyNo)}</b></div>` : ''}${u.files && u.files.length ? `<div class="files">${FU.filesHtml(u.files)}</div>` : ''}</li>`;
  }
  function taskCard(t) {
    const i = FU.taskInfo(t), ups = FU.taskUpdates(t.id), off = FU.isOfficer(), act = FU.canActTask(t), r = me().role;
    return `<section class="card task s-edge-${i.st.c}"><div class="row between"><h3>${esc(FU.deptName(t.deptId))}</h3><div class="row wrap">${statusBadge(t.status)}${dueBadge(t, i)}${escalBadge(i)}</div></div>
      ${meta([['تاريخ الإحالة', fmtDate(t.startDate)], ['المدة المتوقعة', t.days === '' || t.days == null ? '—' : FU.daysWord(+t.days) + (cfg().workdays ? ' عمل' : '')], ['تاريخ الاستحقاق', i.due ? fmtDate(i.due) : '—'], ['موظف المتابعة', t.followerId ? esc(FU.userName(t.followerId)) : '—'], t.status === 'done' ? ['تاريخ التنفيذ', fmtDate(t.doneDate)] : null, ['عدد الإفادات', String(i.n)]])}
      ${t.notes ? `<p class="small"><b>ملاحظات:</b> ${nl2br(t.notes)}</p>` : ''}
      ${ups.length ? `<ol class="timeline">${ups.map(upItem).join('')}</ol>` : '<p class="muted">لا توجد إفادات بعد.</p>'}
      <div class="row wrap actions no-print">${r === 'rep' && act && t.status === 'not_received' ? `<button class="btn primary" data-act="confirmReceipt" data-id="${esc(t.id)}">✔ تأكيد استلام المذكرة</button>` : ''}
        ${act ? `<button class="btn ${r === 'rep' && t.status === 'not_received' ? '' : 'primary'}" data-act="addUpdate" data-id="${esc(t.id)}">＋ إفادة / تحديث الحالة</button>` : ''}
        ${r === 'viewer' ? `<button class="btn" data-act="addUpdate" data-id="${esc(t.id)}">＋ توجيه</button>` : ''}
        ${off ? `<span class="grow"></span><button class="btn small" data-act="editTask" data-id="${esc(t.id)}">تعديل الإحالة</button><button class="btn small danger" data-act="delTask" data-id="${esc(t.id)}">حذف الإحالة</button>` : ''}</div></section>`;
  }
  FU.route(/^#\/letter\/([^/]+)$/, id => {
    const l = FU.byId('letters', id), back = '<a href="#/register" class="btn small">→ سجل المتابعة</a>';
    if (!l) return FU.page(`${back}<div class="card empty">الكتاب غير موجود. ربما حُذف.</div>`);
    const ts = FU.letterTasks(id).filter(FU.canSeeTask), off = FU.isOfficer(), stt = FU.letterState(l);
    if (FU.inDept() && !ts.length) return FU.page(`${back}<div class="card empty">هذا الكتاب غير موجَّه إلى إدارتك.</div>`);
    FU.page(`<div class="row between">${back}<div class="row wrap">${off ? `<button class="btn small" data-act="editLetter" data-id="${esc(id)}">تعديل بيانات الكتاب</button><button class="btn small" data-act="addTask" data-id="${esc(id)}">＋ إحالة إلى إدارة</button><button class="btn small danger" data-act="delLetter" data-id="${esc(id)}">حذف الكتاب</button>` : ''}<a class="btn small" href="#/print/letter/${esc(id)}">🖨 بطاقة المتابعة</a></div></div>
      <div class="card letter-head"><div class="row between"><h2>${esc(l.subject)}</h2><div class="row wrap">${l.priority === 'urgent' ? badge('عاجل', 'bad') : ''}${FU.inDept() ? '' : stt === 'closed' ? badge('مغلق', 'ok') : stt === 'open' ? badge('مفتوح', 'warn') : badge('لم يُحَل بعد', 'gray')}</div></div>
        ${meta([['م', esc(l.seq)], ['رقم الكتاب', esc(l.number)], ['تاريخ الكتاب الوارد', fmtDate(l.date)], l.from ? ['الجهة الوارد منها', esc(l.from)] : null, ['سُجّل بواسطة', esc(FU.userName(l.createdBy)) + ' · ' + esc(FU.fmtDateTime(l.createdAt))]])}
        ${l.notes ? `<p><b>ملاحظات:</b> ${nl2br(l.notes)}</p>` : ''}
        <div class="files">${FU.filesHtml(l.files, off ? 'delLetterFile' : null, l.id)}${off ? `<label class="btn small no-print">📎 إرفاق ملف<input type="file" multiple hidden data-change="attachLetter" data-id="${esc(id)}"></label>` : ''}</div></div>
      ${ts.length ? ts.map(taskCard).join('') : `<div class="card empty">لم يُحَل هذا الكتاب إلى أي إدارة بعد.${off ? ' استخدم زر «＋ إحالة إلى إدارة».' : ''}</div>`}`, { title: l.subject });
  });

  /* ---------- نوافذ الكتاب والإحالة والإفادة ---------- */
  const nextSeq = () => FU.list('letters').reduce((m, l) => Math.max(m, Number(l.seq) || 0), 0) + 1;
  const followerOpts = sel => opts([['', '— بدون —']].concat(FU.list('users', u => u.role === 'officer' && (u.active || u.id === sel)).sort(FU.byName).map(u => [u.id, u.name])), sel);
  const checkDays = (v, name) => { if (v === '' || isNaN(v) || +v < 0 || +v > 3650 || Math.round(+v) !== +v) throw new Error('أدخل المدة المتوقعة بالأيام' + (name ? ' لـ«' + name + '»' : '')); return +v; };
  async function letterDialog(l) {
    const isNew = !l, s = cfg(), ds = FU.depts(), fol = me().role === 'officer' ? me().id : '';
    const body = `<div class="grid2">
      ${field('الموضوع', `<textarea name="subject" rows="2" required maxlength="500">${esc(l ? l.subject : '')}</textarea>`, '', 'span2')}
      ${field('رقم الكتاب', `<input name="number" required maxlength="60" value="${esc(l ? l.number : '')}">`)}
      ${field('تاريخ الكتاب الوارد', `<input type="date" name="date" required value="${esc(l ? l.date : FU.today())}">`)}
      ${field('الجهة الوارد منها (اختياري)', `<input name="from" maxlength="150" value="${esc(l ? l.from : '')}">`)}
      ${field('الأولوية', `<select name="priority">${opts([['normal', 'عادي'], ['urgent', 'عاجل']], l ? l.priority : 'normal')}</select>`)}
      ${field('ملاحظات (اختياري)', `<textarea name="notes" rows="2" maxlength="1000">${esc(l ? l.notes : '')}</textarea>`, '', 'span2')}
      ${isNew ? field('مرفقات — صورة الكتاب (اختياري)', '<input type="file" name="files" multiple>', '', 'span2') : ''}</div>
      ${isNew ? `<h4>الإحالة إلى الإدارات</h4><p class="hint">اختر جهات الاختصاص، ولكل جهة مدتها المتوقعة وموظف متابعتها. يمكن إضافة جهات أخرى لاحقاً.</p>
      <table class="grid assign"><thead><tr><th></th><th>جهة الاختصاص</th><th>المدة المتوقعة (أيام)</th><th>موظف المتابعة</th></tr></thead><tbody>${ds.map(d => `<tr><td class="c"><input type="checkbox" name="d_${esc(d.id)}" aria-label="${esc(d.name)}"></td><td>${esc(d.name)}</td><td><input type="number" name="days_${esc(d.id)}" min="0" max="3650" value="${esc(s.defaultDays)}"></td><td><select name="fol_${esc(d.id)}">${followerOpts(fol)}</select></td></tr>`).join('')}</tbody></table>` : ''}`;
    return FU.modal({ title: isNew ? 'تسجيل كتاب جديد' : 'تعديل بيانات الكتاب', body, wide: true, okText: isNew ? 'تسجيل الكتاب' : 'حفظ', onOk: async (form, d) => {
      if (!FU.okDate(d.date)) throw new Error('تاريخ الكتاب غير صالح');
      const dup = FU.list('letters', x => x.id !== (l && l.id) && FU.norm(x.number) === FU.norm(d.number) && String(x.date).slice(0, 4) === d.date.slice(0, 4))[0];
      if (dup && !(await FU.confirm(`رقم الكتاب «${d.number}» مسجّل من قبل في سنة ${d.date.slice(0, 4)} بموضوع «${dup.subject}». هل تريد المتابعة؟`, 'نعم، متابعة'))) return false;
      const fields = { subject: d.subject, number: d.number, date: d.date, from: d.from || '', priority: d.priority === 'urgent' ? 'urgent' : 'normal', notes: d.notes || '' };
      if (!isNew) { await FU.update('letters', l.id, c => Object.assign(c, fields), 'letter_edit', { number: d.number }); return true; }
      const picked = ds.filter(x => d['d_' + x.id]).map(x => ({ x, days: checkDays(d['days_' + x.id], x.name) }));
      const rec = Object.assign({ id: FU.uid(), seq: nextSeq(), files: [] }, fields);
      rec.files = await FU.storeFiles(rec.id, form.elements.files.files);
      await FU.save('letters', rec, 'letter_add', { number: rec.number, subject: rec.subject });
      for (const p of picked) await FU.save('tasks', { id: FU.uid(), letterId: rec.id, deptId: p.x.id, status: 'not_received', startDate: rec.date, days: p.days, followerId: d['fol_' + p.x.id] || null, notes: '' }, 'task_add', { number: rec.number, dept: p.x.name });
      return rec.id;
    } });
  }
  A.newLetter = async () => { if (!FU.isOfficer()) return; const id = await letterDialog(null); if (id) { FU.toast('تم تسجيل الكتاب', 'ok'); FU.navigate('#/letter/' + id); } };
  A.editLetter = async el => { const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer()) return; if (await letterDialog(l)) { FU.toast('تم الحفظ', 'ok'); refresh(); } };
  A.delLetter = async el => {
    const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer()) return; const ts = FU.letterTasks(l.id);
    if (!(await FU.confirm(`حذف الكتاب رقم «${l.number}» نهائياً مع ${ts.length} إحالة وكل إفاداتها ومرفقاتها؟ لا يمكن التراجع.`, 'نعم، حذف'))) return;
    for (const t of ts) await dropTask(t);
    await FU.removeFiles(l.files); await FU.remove('letters', l.id, { number: l.number, subject: l.subject }); FU.toast('تم حذف الكتاب'); FU.navigate('#/register');
  };
  A['change:attachLetter'] = async el => {
    const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer() || !el.files.length) return;
    const added = await FU.storeFiles(l.id, el.files); await FU.update('letters', l.id, c => { c.files = (c.files || []).concat(added); }, 'file_add', { number: l.number, files: added.map(a => a.name).join('، ') }); refresh();
  };
  A.delLetterFile = async el => {
    const l = FU.byId('letters', el.dataset.id), f = l && (l.files || []).find(x => x.id === el.dataset.fid); if (!f || !FU.isOfficer()) return;
    if (!(await FU.confirm(`حذف المرفق «${f.name}»؟`, 'نعم، حذف'))) return;
    await FU.update('letters', l.id, c => { c.files = (c.files || []).filter(x => x.id !== f.id); }, 'file_del', { number: l.number, files: f.name }); await FU.removeFiles([f]); refresh();
  };

  async function taskDialog(l, t) {
    const used = new Set(FU.letterTasks(l.id).map(x => x.deptId)), ds = FU.depts().filter(d => !used.has(d.id));
    if (!t && !ds.length) { FU.toast('أُحيل الكتاب إلى كل الإدارات المتاحة', 'warn'); return false; }
    const body = `<div class="grid2">
      ${field('جهة الاختصاص', t ? `<input value="${esc(FU.deptName(t.deptId))}" disabled>` : `<select name="deptId" required>${opts(ds.map(d => [d.id, d.name]), '')}</select>`)}
      ${field('موظف المتابعة', `<select name="followerId">${followerOpts(t ? t.followerId : me().role === 'officer' ? me().id : '')}</select>`)}
      ${field('تاريخ الإحالة', `<input type="date" name="startDate" required value="${esc(t ? t.startDate : l.date)}">`, 'تُحسب المدة من هذا التاريخ')}
      ${field('المدة المتوقعة للإنجاز (أيام)', `<input type="number" name="days" min="0" max="3650" required value="${esc(t ? t.days : cfg().defaultDays)}">`, cfg().workdays ? 'أيام عمل (دون الجمعة والسبت)' : '')}
      ${field('ملاحظات (اختياري)', `<textarea name="notes" rows="2" maxlength="1000">${esc(t ? t.notes : '')}</textarea>`, '', 'span2')}</div>`;
    return FU.modal({ title: t ? 'تعديل الإحالة' : 'إحالة الكتاب إلى إدارة', body, onOk: async (form, d) => {
      if (!FU.okDate(d.startDate)) throw new Error('تاريخ الإحالة غير صالح'); const days = checkDays(d.days);
      if (!t) { await FU.save('tasks', { id: FU.uid(), letterId: l.id, deptId: d.deptId, status: 'not_received', startDate: d.startDate, days, followerId: d.followerId || null, notes: d.notes || '' }, 'task_add', { number: l.number, dept: FU.deptName(d.deptId) }); return true; }
      const changed = +t.days !== days || t.startDate !== d.startDate;
      await FU.update('tasks', t.id, c => { c.startDate = d.startDate; c.days = days; c.followerId = d.followerId || null; c.notes = d.notes || ''; }, 'task_edit', { number: l.number, dept: FU.deptName(t.deptId) });
      /* تعديل الموعد يُسجَّل في مسار الإحالة حتى يبقى ظاهراً للجميع */
      if (changed) await FU.save('updates', { id: FU.uid(), taskId: t.id, letterId: l.id, deptId: t.deptId, kind: 'status', date: FU.today(), text: `تعديل الموعد: المدة المتوقعة من ${t.days} إلى ${days} (بالأيام)، وتاريخ الإحالة ${fmtDate(d.startDate)}`, replyNo: '', status: null, files: [], byId: me().id, byName: me().name }, null);
      return true;
    } });
  }
  A.addTask = async el => { const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer()) return; if (await taskDialog(l, null)) { FU.toast('تمت الإحالة', 'ok'); refresh(); } };
  A.editTask = async el => { const t = FU.byId('tasks', el.dataset.id), l = t && FU.byId('letters', t.letterId); if (!l || !FU.isOfficer()) return; if (await taskDialog(l, t)) { FU.toast('تم الحفظ', 'ok'); refresh(); } };
  async function dropTask(t) { for (const u of FU.taskUpdates(t.id).slice()) { await FU.removeFiles(u.files); await FU.remove('updates', u.id, null); } await FU.remove('tasks', t.id, { dept: FU.deptName(t.deptId), number: letterOf(t).number }); }
  A.delTask = async el => {
    const t = FU.byId('tasks', el.dataset.id); if (!t || !FU.isOfficer()) return;
    if (!(await FU.confirm(`حذف إحالة «${FU.deptName(t.deptId)}» مع كل إفاداتها؟ لا يمكن التراجع.`, 'نعم، حذف'))) return;
    await dropTask(t); FU.toast('تم حذف الإحالة'); refresh();
  };

  async function updateDialog(t, u) {
    const off = FU.isOfficer(), act = FU.canActTask(t), r = me().role, l = letterOf(t);
    const kind = u ? u.kind : off ? 'follow' : r === 'rep' ? 'action' : 'directive';
    const withStatus = !u && act;
    const body = `<div class="grid2">
      ${field('التاريخ', `<input type="date" name="date" required max="${FU.today()}" value="${esc(u ? u.date : FU.today())}">`)}
      ${!u && off ? field('النوع', `<select name="kind">${opts([['follow', KIND.follow], ['action', KIND.action + ' (نيابةً عنها)'], ['directive', KIND.directive]], kind)}</select>`) : field('النوع', `<input value="${esc(KIND[kind])}" disabled>`)}
      ${field(kind === 'directive' ? 'نص التوجيه' : 'نص الإفادة — ما الذي تم؟', `<textarea name="text" rows="4" maxlength="3000" ${withStatus ? '' : 'required'}>${esc(u ? u.text : '')}</textarea>`, '', 'span2')}
      ${field('رقم كتاب الرد (اختياري)', `<input name="replyNo" maxlength="60" value="${esc(u ? u.replyNo : '')}">`)}
      ${u ? '' : field('مرفق (اختياري)', '<input type="file" name="files" multiple>')}
      ${withStatus ? field('حالة الإجراء', `<select name="status">${opts([['', 'بدون تغيير — ' + (STATUS[t.status] || {}).t]].concat(Object.keys(STATUS).filter(k => k !== t.status).map(k => [k, STATUS[k].t])), '')}</select>`) + field('تاريخ التنفيذ', `<input type="date" name="doneDate" max="${FU.today()}" value="${FU.today()}">`, '', 'done-date hidden') : ''}</div>`;
    return FU.modal({ title: (u ? 'تعديل — ' : '') + FU.deptName(t.deptId) + ' · كتاب رقم ' + l.number, body, okText: 'حفظ',
      onOpen: form => { const s = form.elements.status; if (s) s.addEventListener('change', () => form.querySelector('.done-date').classList.toggle('hidden', s.value !== 'done')); },
      onOk: async (form, d) => {
        if (!FU.okDate(d.date) || d.date > FU.today()) throw new Error('التاريخ غير صالح أو في المستقبل');
        if (u) { if (!d.text) throw new Error('اكتب النص'); await FU.update('updates', u.id, c => { c.date = d.date; c.text = d.text; c.replyNo = d.replyNo || ''; c.editedAt = FU.nowISO(); }, 'update_edit', { number: l.number, dept: FU.deptName(t.deptId) }); return true; }
        const ns = withStatus ? d.status || '' : '', k = off ? (KIND[d.kind] && d.kind !== 'status' ? d.kind : 'follow') : kind;
        if (!d.text && !ns) throw new Error('اكتب نص الإفادة أو اختر حالة جديدة');
        if ((ns === 'problem' || ns === 'no_action') && !d.text) throw new Error('اذكر السبب في نص الإفادة');
        if (ns === 'done' && (!FU.okDate(d.doneDate) || d.doneDate > FU.today())) throw new Error('تاريخ التنفيذ غير صالح أو في المستقبل');
        if (ns) await FU.update('tasks', t.id, c => { c.status = ns; c.doneDate = ns === 'done' ? d.doneDate : null; if (ns !== 'not_received' && !c.receivedAt) c.receivedAt = d.date; }, 'status', { number: l.number, dept: FU.deptName(t.deptId), from: t.status, to: ns });
        const rec = { id: FU.uid(), taskId: t.id, letterId: t.letterId, deptId: t.deptId, kind: d.text ? k : 'status', date: d.date, text: d.text || '', replyNo: d.replyNo || '', status: ns || null, files: [], byId: me().id, byName: me().name };
        rec.files = await FU.storeFiles(rec.id, form.elements.files.files);
        await FU.save('updates', rec, d.text ? 'update_add' : null, { number: l.number, dept: FU.deptName(t.deptId), kind: KIND[rec.kind] });
        return true;
      } });
  }
  A.addUpdate = async el => { const t = FU.byId('tasks', el.dataset.id); if (!t || !FU.canSeeTask(t) || !(FU.canActTask(t) || me().role === 'viewer')) return; if (await updateDialog(t, null)) { FU.toast('تم الحفظ', 'ok'); refresh(); } };
  A.editUpdate = async el => { const u = FU.byId('updates', el.dataset.id), t = u && FU.byId('tasks', u.taskId); if (!t || !(FU.isOfficer() || u.byId === me().id)) return; if (await updateDialog(t, u)) { FU.toast('تم الحفظ', 'ok'); refresh(); } };
  A.delUpdate = async el => {
    const u = FU.byId('updates', el.dataset.id); if (!u || !(FU.isOfficer() || (u.byId === me().id && !u.status))) return;
    if (!(await FU.confirm('حذف هذه الإفادة؟' + (u.status ? ' حالة الإحالة لا تتغير بحذفها.' : ''), 'نعم، حذف'))) return;
    await FU.removeFiles(u.files); await FU.remove('updates', u.id, { number: (FU.byId('letters', u.letterId) || {}).number, dept: FU.deptName(u.deptId) }); refresh();
  };
  A.confirmReceipt = async el => {
    const t = FU.byId('tasks', el.dataset.id); if (!t || !FU.canActTask(t) || t.status !== 'not_received') return;
    await FU.update('tasks', t.id, c => { c.status = 'in_progress'; c.receivedAt = FU.today(); }, 'status', { number: letterOf(t).number, dept: FU.deptName(t.deptId), from: 'not_received', to: 'in_progress' });
    await FU.save('updates', { id: FU.uid(), taskId: t.id, letterId: t.letterId, deptId: t.deptId, kind: 'status', date: FU.today(), text: 'تأكيد استلام المذكرة', replyNo: '', status: 'in_progress', files: [], byId: me().id, byName: me().name }, null);
    FU.toast('تم تأكيد الاستلام', 'ok'); refresh();
  };

  Object.assign(FU, { registerQuery: query, registerFilters: F, regTable, filterSummary, deptTable, attention, escalBadge, myTasks, letterOf, meta, KIND_CLASS, refresh });
})();
