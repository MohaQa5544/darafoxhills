/* الشاشات — برنامج المتابعة: الدخول، الرئيسية، سجل المتابعة بسجلاته (المفتوحة، المغلقة، المحذوفة) */
(function () {
  const FU = window.FU, { $, esc, nl2br, field, opts, badge, statusBadge, dueBadge, fmtDate, STATUS, KIND } = FU;
  const A = FU.actions, FM = FU.forms, me = () => FU.state.user, cfg = () => FU.state.settings;
  const KIND_CLASS = { action: 'soft', follow: 'blue', directive: 'violet', status: 'gray', mail: 'blue', remind: 'warn' };
  /* عدد التذكيرات المرسلة إلى الإدارة عن هذه الإحالة */
  const reminders = t => FU.taskUpdates(t.id).filter(u => u.kind === 'remind').length;
  const TRASH_DAYS = 30;   // مدة بقاء المعاملة المحذوفة قابلة للاسترجاع
  /* المعاملة المحذوفة تخرج من كل الأعداد والقوائم، والمغلقة تبقى في الإحصاءات وتُعرض في سجلها */
  const liveLetters = f => FU.list('letters', l => !l.deletedAt && (!f || f(l)));
  const myTasks = () => { const gone = new Set(FU.list('letters', l => l.deletedAt).map(l => l.id)); return FU.list('tasks', t => FU.canSeeTask(t) && !gone.has(t.letterId)); };
  const lockedTask = t => { const l = FU.byId('letters', t.letterId); return !l || !!l.deletedAt || !!l.closedAt; };
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
      ${rows.map(x => line(print ? esc(x.d.name) : `<button class="linkbtn" data-act="preset" data-dept="${esc(x.d.id)}" data-box="all">${esc(x.d.name)}</button>`, x.s)).join('')}
      ${rows.length > 1 ? line('<b>الإجمالي</b>', FU.stats(tasks), true) : ''}</tbody></table></div>`;
  }
  /* ما يحتاج انتباهاً: المتأخر، وما فيه مشكلة، وما تجاوز حد الإفادات دون إنجاز — الأشد تأخراً أولاً */
  const attention = tasks => tasks.map(t => ({ t, i: FU.taskInfo(t) })).filter(x => x.i.attention).sort((a, b) => (a.i.left == null ? 0 : a.i.left) - (b.i.left == null ? 0 : b.i.left));
  const escalBadge = i => (i.escal ? badge(i.n + ' إفادات دون إنجاز', 'violet') : '');
  FU.route(/^#\/home$/, () => {
    const tasks = myTasks(), s = FU.stats(tasks), u = me(), set = cfg(), dept = FU.inDept();
    const tile = (n, label, f, cls, box) => `<button class="tile ${n ? cls || '' : ''}" data-act="preset" data-status="${f}" data-box="${box || 'open'}"><b class="num">${n}</b><span>${label}</span></button>`;
    const att = attention(tasks), vis = new Set(tasks.map(t => t.id));
    const recent = FU.list('updates', x => x.text && vis.has(x.taskId)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 8);
    const waiting = u.role === 'rep' ? tasks.filter(t => t.status === 'not_received') : [];
    const unassigned = dept ? 0 : liveLetters(l => !l.closedAt && !FU.letterTasks(l.id).length).length;
    const ready = FU.isOfficer() ? liveLetters(l => !l.closedAt && FU.letterState(l) === 'closed').length : 0;
    if (FU.isOfficer()) FU.purgeTrash().catch(e => console.warn(e));
    FU.page(`<div class="row between"><div><h2>مرحباً، ${esc(u.name)}</h2><p class="muted">${esc(FU.fmtLong(FU.today()))}${dept ? ' · ' + esc(FU.deptName(u.deptId)) : ''}</p></div>
      <div class="row wrap">${FU.isOfficer() ? '<button class="btn primary" data-act="newLetter">＋ كتاب جديد</button>' : ''}<a class="btn" href="#/print/summary">🖨 طباعة الملخص</a></div></div>
      <div class="tiles">${tile(s.open, 'تكليفات مفتوحة', 'open', 't-green')}${tile(s.overdue, 'متأخرة عن موعدها', 'overdue', 't-bad')}${tile(s.soon, set.soonDays > 0 ? 'تستحق خلال ' + (set.soonDays === 2 ? 'يومين' : FU.daysWord(set.soonDays)) : 'تستحق اليوم', 'soon', 't-warn')}${tile(s.problem, 'يوجد مشكلة', 'problem', 't-bad')}${tile(s.not_received, 'لم تُستلم مذكرتها', 'not_received', 't-gray')}${tile(s.done, 'تم تنفيذها', 'done', 't-ok', 'all')}</div>
      ${unassigned ? `<div class="note warn">${unassigned === 1 ? 'كتاب واحد لم يُحَل' : unassigned + ' كتب لم تُحَل'} إلى أي إدارة بعد. <button class="linkbtn" data-act="preset" data-status="unassigned">عرضها</button></div>` : ''}
      ${ready ? `<div class="note ok">${ready === 1 ? 'معاملة واحدة اكتملت إحالاتها' : ready + ' معاملات اكتملت إحالاتها'} وتنتظر النقل إلى السجل المغلق. <button class="linkbtn" data-act="preset" data-status="ready">عرضها</button></div>` : ''}
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
  const F = { box: 'open', q: '', dept: '', status: '', follower: '', year: '', sort: 'new', limit: 100 };
  const BOX = { open: 'المعاملات المفتوحة', closed: 'المعاملات المغلقة', all: 'كل المعاملات', trash: 'المحذوفة' };
  const SPECIAL = { open: 'المفتوحة', overdue: 'المتأخرة', soon: 'تستحق قريباً', attention: 'تحتاج انتباهاً', escal: 'تجاوزت حد الإفادات', closed: 'المنتهية إحالاتها' };
  A.preset = el => { Object.assign(F, { box: BOX[el.dataset.box] ? el.dataset.box : 'open', q: '', dept: el.dataset.dept || '', status: el.dataset.status || '', follower: '', year: '', limit: 100 }); FU.navigate('#/register'); };
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
      if (l.deletedAt || (F.box === 'open' && l.closedAt) || (F.box === 'closed' && !l.closedAt)) continue;
      if (F.year && String(l.date || '').slice(0, 4) !== F.year) continue;
      const all = FU.letterTasks(l.id), seen = all.filter(FU.canSeeTask); let ts = [];
      if (FU.inDept() && !seen.length) continue;
      if (F.status === 'unassigned') { if (all.length) continue; }
      else if (F.status === 'ready') { if (l.closedAt || FU.letterState(l) !== 'closed') continue; ts = seen; }
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
      const head = `<td class="c num"${rs}>${esc(l.seq)}</td><td class="subj" style="min-width:200px"${rs}>${print ? esc(l.subject) : `<a href="#/letter/${esc(l.id)}">${esc(l.subject)}</a>`}${l.priority === 'urgent' ? ' ' + badge('عاجل', 'bad') : ''}${l.closedAt ? ' ' + badge('مغلقة', 'ok') : ''}${l.from ? `<div class="muted small">من: ${esc(l.from)}</div>` : ''}</td><td class="c"${rs}>${esc(l.number)}</td><td class="c num"${rs}>${fmtDate(l.date)}</td>`;
      if (!g.ts.length) return `<tr class="first">${head}<td colspan="8" class="muted c">لم يُحَل إلى أي إدارة بعد</td></tr>`;
      return g.ts.map((t, k) => {
        const i = FU.taskInfo(t), c = i.st.c;
        return `<tr class="${k ? '' : 'first'}">${k ? '' : head}<td class="tc s-${c}">${esc(FU.deptName(t.deptId))}</td><td class="tc s-${c} c">${statusBadge(t.status)}${escalBadge(i)}</td><td class="tc s-${c} c num">${t.days === '' || t.days == null ? '—' : esc(t.days)}</td><td class="tc s-${c} c num">${i.due ? fmtDate(i.due) + '<br>' : ''}${dueBadge(t, i)}</td><td class="tc s-${c} c num">${i.n}</td><td class="tc s-${c} c num">${reminders(t) || '<span class="muted">0</span>'}</td><td class="tc s-${c}">${t.followerId ? esc(FU.userName(t.followerId)) : '<span class="muted">—</span>'}</td><td class="tc s-${c} last" style="min-width:170px">${i.last ? `<div class="${print ? '' : 'clip'}">${esc(i.last.text)}</div><div class="muted small">${fmtDate(i.last.date)} · ${esc(i.last.byName || '')}</div>` : '<span class="muted">—</span>'}</td></tr>`;
      }).join('');
    }).join('');
    return `<table class="grid reg"><thead><tr><th>م</th><th>الموضوع</th><th>رقم الكتاب</th><th>تاريخ الكتاب الوارد</th><th>جهة الاختصاص</th><th>حالة الإجراء</th><th>المدة (أيام)</th><th>الاستحقاق</th><th>عدد الإفادات</th><th>التذكيرات</th><th>موظف المتابعة</th><th>آخر إفادة</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
  const statusOptions = () => [['', 'كل الحالات']].concat(Object.keys(SPECIAL).map(k => [k, SPECIAL[k]]), Object.keys(STATUS).map(k => [k, STATUS[k].t]), FU.inDept() ? [] : [['ready', 'مكتملة تنتظر الإغلاق'], ['unassigned', 'كتب لم تُحَل بعد']]);
  /* وصف التصفية الحالية بالكلمات (يظهر في رأس التقرير المطبوع) */
  function filterSummary() {
    const p = [BOX[F.box]]; if (FU.inDept()) p.push(FU.deptName(me().deptId)); else if (F.dept) p.push(FU.deptName(F.dept));
    if (F.status) p.push((statusOptions().find(x => x[0] === F.status) || [])[1]);
    if (F.follower) p.push('موظف المتابعة: ' + FU.userName(F.follower)); if (F.year) p.push('سنة ' + F.year); if (F.q.trim()) p.push('بحث: ' + F.q.trim());
    return p.filter(Boolean).join(' · ');
  }
  function drawReg() {
    const el = $('#reg-out'); if (!el) return; if (F.box === 'trash') { el.innerHTML = trashTable(); return; } const g = query(), shown = g.slice(0, F.limit), nt = g.reduce((a, x) => a + x.ts.length, 0);
    el.innerHTML = `<p class="muted small">${g.length} كتاب · ${nt} تكليف</p>` + (g.length ? `<div class="table-wrap">${regTable(shown)}</div>${g.length > shown.length ? `<p class="c"><button class="btn" data-act="more">عرض المزيد (${g.length - shown.length})</button></p>` : ''}`
      : `<div class="card empty">${liveLetters().length ? 'لا توجد نتائج مطابقة في هذا السجل.' : 'لا توجد كتب مسجّلة بعد.' + (FU.isOfficer() ? ' ابدأ بزر «＋ كتاب جديد».' : '')}</div>`);
  }
  /* المحذوفات: تبقى المعاملة TRASH_DAYS يوماً قابلة للاسترجاع ثم تُحذف نهائياً */
  const trashLeft = l => Math.max(0, TRASH_DAYS - Math.floor((Date.now() - Date.parse(l.deletedAt)) / 864e5));
  function trashTable() {
    const rows = FU.list('letters', l => l.deletedAt).sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
    if (!rows.length) return '<div class="card empty">لا توجد معاملات محذوفة.</div>';
    return `<p class="hint">تبقى المعاملة المحذوفة هنا ${TRASH_DAYS} يوماً يمكن استرجاعها خلالها، ثم تُحذف نهائياً مع إحالاتها وإفاداتها ومرفقاتها.</p>
      <div class="table-wrap"><table class="grid"><thead><tr><th>م</th><th>الموضوع</th><th>رقم الكتاب</th><th>تاريخ الكتاب الوارد</th><th>الإحالات</th><th>حذفها</th><th>تاريخ الحذف</th><th>الباقي للاسترجاع</th><th></th></tr></thead><tbody>${rows.map(l => `<tr><td class="c num">${esc(l.seq)}</td><td><a href="#/letter/${esc(l.id)}">${esc(l.subject)}</a></td><td class="c">${esc(l.number)}</td><td class="c num">${fmtDate(l.date)}</td><td class="c num">${FU.letterTasks(l.id).length}</td><td>${esc(FU.userName(l.deletedBy))}</td><td class="c nowrap num">${esc(FU.fmtDateTime(l.deletedAt))}</td><td class="c">${badge(FU.daysWord(trashLeft(l)), trashLeft(l) <= 5 ? 'bad' : 'warn')}</td>
        <td class="c nowrap"><button class="linkbtn" data-act="restoreLetter" data-id="${esc(l.id)}">↩ استرجاع</button> · <button class="linkbtn danger" data-act="purgeLetter" data-id="${esc(l.id)}">حذف نهائي</button></td></tr>`).join('')}</tbody></table></div>`;
  }
  FU.route(/^#\/register$/, () => {
    const off = FU.isOfficer(), cnt = { open: 0, closed: 0, trash: 0 }; if (F.box === 'trash' && !off) F.box = 'open';
    for (const l of FU.list('letters')) { if (FU.inDept() && !FU.letterTasks(l.id).some(FU.canSeeTask)) continue; cnt[l.deletedAt ? 'trash' : l.closedAt ? 'closed' : 'open']++; }
    const boxes = [['open', cnt.open], ['closed', cnt.closed], ['all', cnt.open + cnt.closed]]; if (off) boxes.push(['trash', cnt.trash]);
    const trash = F.box === 'trash', years = [...new Set(liveLetters().map(l => String(l.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
    const sel = (k, pairs, label) => `<select data-change="freg" data-k="${k}" aria-label="${label}">${opts(pairs, F[k])}</select>`;
    FU.page(`<div class="row between"><h2>سجل المتابعة</h2><div class="row wrap">${off ? '<button class="btn primary" data-act="newLetter">＋ كتاب جديد</button>' : ''}${trash ? '' : '<a class="btn" href="#/print/register">🖨 طباعة التقرير</a><button class="btn" data-act="exportCsv">⬇ تصدير Excel</button>'}</div></div>
      <div class="subtabs">${boxes.map(b => `<button data-act="box" data-b="${b[0]}" ${F.box === b[0] ? 'aria-current="true"' : ''}>${BOX[b[0]]} (${b[1]})</button>`).join('')}</div>
      ${trash ? '' : `<div class="card filters"><input type="search" data-input="fq" value="${esc(F.q)}" placeholder="بحث في الموضوع أو رقم الكتاب أو نص الإفادات…" aria-label="بحث">
        ${FU.inDept() ? '' : sel('dept', [['', 'كل الإدارات']].concat(FU.depts(true).map(d => [d.id, d.name])), 'جهة الاختصاص')}
        ${sel('status', statusOptions(), 'الحالة')}
        ${sel('follower', [['', 'كل موظفي المتابعة']].concat(FU.list('users', u => u.role === 'officer').sort(FU.byName).map(u => [u.id, u.name])), 'موظف المتابعة')}
        ${sel('year', [['', 'كل السنوات']].concat(years.map(y => [y, y])), 'السنة')}
        ${sel('sort', [['new', 'الأحدث أولاً'], ['old', 'الأقدم أولاً'], ['due', 'الأقرب استحقاقاً']], 'الترتيب')}
        <button class="btn small" data-act="clearFilters">مسح التصفية</button></div>`}
      <div id="reg-out"></div>`, { title: 'سجل المتابعة', wide: true });
    drawReg();
  });
  A.box = el => { F.box = BOX[el.dataset.b] ? el.dataset.b : 'open'; F.limit = 100; FU.render(); };
  let tq = null;
  A['input:fq'] = el => { F.q = el.value; F.limit = 100; clearTimeout(tq); tq = setTimeout(drawReg, 180); };
  A['change:freg'] = el => { F[el.dataset.k] = el.value; F.limit = 100; drawReg(); };
  A.more = () => { F.limit += 100; drawReg(); };
  A.clearFilters = () => { Object.assign(F, { q: '', dept: '', status: '', follower: '', year: '', sort: 'new', limit: 100 }); FU.render(); };

  Object.assign(FU, { registerQuery: query, registerFilters: F, regTable, filterSummary, deptTable, attention, escalBadge, myTasks, letterOf, KIND_CLASS, reminders, liveLetters, lockedTask, refresh, TRASH_DAYS, trashLeft });
})();
