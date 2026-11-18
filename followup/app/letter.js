/* صفحة الكتاب — برنامج المتابعة: بطاقات الإحالات ومسار إفاداتها، ونوافذ الكتاب والإحالة والإفادة،
   وإغلاق المعاملة وحذفها واسترجاعها */
(function () {
  const FU = window.FU, { esc, nl2br, field, opts, badge, statusBadge, dueBadge, fmtDate, STATUS, KIND, KIND_CLASS, reminders, lockedTask, letterOf, escalBadge, refresh, TRASH_DAYS, trashLeft } = FU;
  const A = FU.actions, me = () => FU.state.user, cfg = () => FU.state.settings;

  /* ---------- صفحة الكتاب ---------- */
  const meta = pairs => `<dl class="meta">${pairs.filter(Boolean).map(p => `<div><dt>${p[0]}</dt><dd>${p[1]}</dd></div>`).join('')}</dl>`;
  function upItem(u, locked) {
    const own = u.byId === me().id, off = FU.isOfficer(), auto = u.kind === 'status' || u.kind === 'mail' || u.kind === 'remind', canEdit = !locked && (off || own) && !auto, canDel = !locked && (off || (own && !u.status));
    const label = u.kind === 'remind' && u.no ? 'تذكير رقم ' + u.no : KIND[u.kind] || u.kind;
    return `<li class="up k-${esc(u.kind)}"><div class="up-head"><b class="num">${fmtDate(u.date)}</b>${badge(label, KIND_CLASS[u.kind])}${u.status ? `<span class="arrow">←</span>${statusBadge(u.status)}` : ''}<span class="muted small">${esc(u.byName || FU.userName(u.byId))}${u.editedAt ? ' · عُدّلت' : ''}</span><span class="grow"></span>${canEdit ? `<button class="linkbtn small no-print" data-act="editUpdate" data-id="${esc(u.id)}">تعديل</button>` : ''}${canDel ? `<button class="linkbtn small danger no-print" data-act="delUpdate" data-id="${esc(u.id)}">حذف</button>` : ''}</div>
      ${u.text ? `<div class="up-text">${nl2br(u.text)}</div>` : ''}${u.note ? `<div class="up-text small muted">${esc(u.note)}</div>` : ''}${u.replyNo ? `<div class="small">رقم كتاب الرد: <b>${esc(u.replyNo)}</b></div>` : ''}${u.files && u.files.length ? `<div class="files">${FU.filesHtml(u.files)}</div>` : ''}</li>`;
  }
  function taskCard(t, locked) {
    const i = FU.taskInfo(t), ups = FU.taskUpdates(t.id), off = FU.isOfficer(), act = FU.canActTask(t), r = me().role;
    return `<section class="card task s-edge-${i.st.c}"><div class="row between"><h3>${esc(FU.deptName(t.deptId))}</h3><div class="row wrap">${statusBadge(t.status)}${dueBadge(t, i)}${escalBadge(i)}</div></div>
      ${meta([['تاريخ الإحالة', fmtDate(t.startDate)], ['المدة المتوقعة', t.days === '' || t.days == null ? '—' : FU.daysWord(+t.days) + (cfg().workdays ? ' عمل' : '')], ['تاريخ الاستحقاق', i.due ? fmtDate(i.due) : '—'], ['موظف المتابعة', t.followerId ? esc(FU.userName(t.followerId)) : '—'], t.status === 'done' ? ['تاريخ التنفيذ', fmtDate(t.doneDate)] : null, ['عدد الإفادات', String(i.n)], ['التذكيرات', String(reminders(t))]])}
      ${t.notes ? `<p class="small"><b>ملاحظات:</b> ${nl2br(t.notes)}</p>` : ''}
      ${ups.length ? `<ol class="timeline">${ups.map(u => upItem(u, locked)).join('')}</ol>` : '<p class="muted">لا توجد إفادات بعد.</p>'}
      ${locked ? '' : `<div class="row wrap actions no-print">${r === 'rep' && act && t.status === 'not_received' ? `<button class="btn primary" data-act="confirmReceipt" data-id="${esc(t.id)}">✔ تأكيد استلام المذكرة</button>` : ''}
        ${act ? `<button class="btn ${r === 'rep' && t.status === 'not_received' ? '' : 'primary'}" data-act="addUpdate" data-id="${esc(t.id)}">＋ إفادة / تحديث الحالة</button>` : ''}${(FU.taskButtons || []).map(f => f(t)).join('')}
        ${r === 'viewer' ? `<button class="btn" data-act="addUpdate" data-id="${esc(t.id)}">＋ توجيه</button>` : ''}
        ${off ? `<span class="grow"></span><button class="btn small" data-act="editTask" data-id="${esc(t.id)}">تعديل الإحالة</button><button class="btn small danger" data-act="delTask" data-id="${esc(t.id)}">حذف الإحالة</button>` : ''}</div>`}</section>`;
  }
  FU.route(/^#\/letter\/([^/]+)$/, id => {
    const l = FU.byId('letters', id), back = '<a href="#/register" class="btn small">→ سجل المتابعة</a>', off = FU.isOfficer();
    if (!l || (l.deletedAt && !off)) return FU.page(`${back}<div class="card empty">الكتاب غير موجود. ربما حُذف.</div>`);
    const ts = FU.letterTasks(id).filter(FU.canSeeTask), stt = FU.letterState(l), gone = !!l.deletedAt, shut = !!l.closedAt, locked = gone || shut, i = esc(id);
    if (FU.inDept() && !ts.length) return FU.page(`${back}<div class="card empty">هذا الكتاب غير موجَّه إلى إدارتك.</div>`);
    const tools = !off ? '' : gone ? `<button class="btn small primary" data-act="restoreLetter" data-id="${i}">↩ استرجاع المعاملة</button><button class="btn small danger" data-act="purgeLetter" data-id="${i}">حذف نهائي</button>`
      : shut ? `<button class="btn small" data-act="reopenLetter" data-id="${i}">↩ إعادة فتح المعاملة</button><button class="btn small danger" data-act="delLetter" data-id="${i}">حذف المعاملة</button>`
      : `<button class="btn small" data-act="editLetter" data-id="${i}">تعديل بيانات الكتاب</button><button class="btn small" data-act="addTask" data-id="${i}">＋ إحالة إلى إدارة</button>${stt === 'open' ? '' : `<button class="btn small" data-act="closeLetter" data-id="${i}">✔ إغلاق المعاملة</button>`}<button class="btn small danger" data-act="delLetter" data-id="${i}">حذف المعاملة</button>`;
    const banner = gone ? `<div class="note warn">هذه المعاملة محذوفة منذ ${esc(FU.fmtDateTime(l.deletedAt))} بواسطة ${esc(FU.userName(l.deletedBy))}. يمكن استرجاعها خلال ${esc(FU.daysWord(trashLeft(l)))}، ثم تُحذف نهائياً.</div>`
      : shut ? `<div class="note ok">معاملة مغلقة منذ ${esc(FU.fmtDateTime(l.closedAt))}، أغلقها ${esc(FU.userName(l.closedBy))} — للعرض فقط.${off ? ' أعد فتحها إن احتجت إلى تعديلها.' : ''}</div>`
      : off && stt === 'closed' ? `<div class="note ok">اكتملت كل إحالات هذا الكتاب. <button class="btn small primary" data-act="closeLetter" data-id="${i}">✔ إغلاق المعاملة</button> فتنتقل إلى سجل المعاملات المغلقة.</div>` : '';
    const state = gone ? badge('محذوفة', 'bad') : shut ? badge('مغلقة', 'ok') : FU.inDept() ? '' : stt === 'closed' ? badge('مكتملة الإحالات', 'ok') : stt === 'open' ? badge('مفتوحة', 'warn') : badge('لم تُحَل بعد', 'gray');
    FU.page(`<div class="row between">${back}<div class="row wrap">${tools}<a class="btn small" href="#/print/letter/${i}">🖨 بطاقة المتابعة</a></div></div>${banner}
      <div class="card letter-head"><div class="row between"><h2>${esc(l.subject)}</h2><div class="row wrap">${l.priority === 'urgent' ? badge('عاجل', 'bad') : ''}${state}</div></div>
        ${meta([['م', esc(l.seq)], ['رقم الكتاب', esc(l.number)], ['تاريخ الكتاب الوارد', fmtDate(l.date)], l.from ? ['الجهة الوارد منها', esc(l.from)] : null, ts.length ? ['التذكيرات', String(ts.reduce((a, t) => a + reminders(t), 0))] : null, ['سُجّل بواسطة', esc(FU.userName(l.createdBy)) + ' · ' + esc(FU.fmtDateTime(l.createdAt))]])}
        ${l.notes ? `<p><b>ملاحظات:</b> ${nl2br(l.notes)}</p>` : ''}
        <div class="files">${FU.filesHtml(l.files, off && !locked ? 'delLetterFile' : null, l.id)}${off && !locked ? `<label class="btn small no-print">📎 إرفاق ملف<input type="file" multiple hidden data-change="attachLetter" data-id="${i}"></label>` : ''}</div></div>
      ${ts.length ? ts.map(t => taskCard(t, locked)).join('') : `<div class="card empty">لم يُحَل هذا الكتاب إلى أي إدارة بعد.${off && !locked ? ' استخدم زر «＋ إحالة إلى إدارة».' : ''}</div>`}`, { title: l.subject });
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
      const dup = FU.list('letters', x => !x.deletedAt && x.id !== (l && l.id) && FU.norm(x.number) === FU.norm(d.number) && String(x.date).slice(0, 4) === d.date.slice(0, 4))[0];
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
  A.editLetter = async el => { const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer() || l.deletedAt || l.closedAt) return; if (await letterDialog(l)) { FU.toast('تم الحفظ', 'ok'); refresh(); } };
  /* الحذف نقل إلى «المحذوفة»: تختفي المعاملة من السجلات والأعداد ويمكن استرجاعها خلال TRASH_DAYS يوماً */
  A.delLetter = async el => {
    const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer() || l.deletedAt) return;
    if (!(await FU.confirm(`حذف المعاملة رقم «${l.number}»؟ تنتقل مع إحالاتها إلى «المحذوفة» ويمكن استرجاعها خلال ${TRASH_DAYS} يوماً.`, 'نعم، حذف'))) return;
    await FU.update('letters', l.id, c => { c.deletedAt = FU.nowISO(); c.deletedBy = me().id; }, 'delete', { number: l.number, subject: l.subject, kind: 'نقل إلى المحذوفة' });
    FU.toast('نُقلت المعاملة إلى المحذوفة'); FU.navigate('#/register');
  };
  A.restoreLetter = async el => {
    const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer() || !l.deletedAt) return;
    await FU.update('letters', l.id, c => { c.deletedAt = null; c.deletedBy = null; }, 'letter_edit', { number: l.number, kind: 'استرجاع من المحذوفة' }); FU.toast('استُرجعت المعاملة', 'ok'); refresh();
  };
  async function destroyLetter(l) { for (const t of FU.letterTasks(l.id).slice()) await dropTask(t); await FU.removeFiles(l.files); await FU.remove('letters', l.id, { number: l.number, subject: l.subject, kind: 'حذف نهائي' }); }
  A.purgeLetter = async el => {
    const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer() || !l.deletedAt) return;
    if (!(await FU.confirm(`حذف المعاملة رقم «${l.number}» نهائياً مع ${FU.letterTasks(l.id).length} إحالة وكل إفاداتها ومرفقاتها؟ لا يمكن التراجع.`, 'نعم، حذف نهائي'))) return;
    await destroyLetter(l); FU.toast('حُذفت المعاملة نهائياً'); if (location.hash === '#/register') refresh(); else FU.navigate('#/register');
  };
  /* ما مضى على حذفه أكثر من TRASH_DAYS يوماً يُحذف نهائياً (مرة في كل جلسة لمسؤول المتابعة) */
  let purged = false;
  async function purgeTrash() {
    if (purged) return; purged = true;
    const old = FU.list('letters', l => l.deletedAt && Date.now() - Date.parse(l.deletedAt) > TRASH_DAYS * 864e5); if (!old.length) return;
    for (const l of old) await destroyLetter(l); refresh();
  }
  /* إغلاق المعاملة المنتهية (تنتقل إلى سجل المغلقة)، وإعادة فتحها */
  A.closeLetter = async el => {
    const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer() || l.deletedAt || l.closedAt) return;
    if (FU.letterState(l) === 'open') throw new Error('ما زالت بعض الإحالات مفتوحة. أنهِها أولاً ثم أغلق المعاملة.');
    await FU.update('letters', l.id, c => { c.closedAt = FU.nowISO(); c.closedBy = me().id; }, 'letter_edit', { number: l.number, kind: 'إغلاق المعاملة' }); FU.toast('أُغلقت المعاملة وانتقلت إلى سجل المعاملات المغلقة', 'ok'); refresh();
  };
  A.reopenLetter = async el => {
    const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer() || l.deletedAt || !l.closedAt) return;
    await FU.update('letters', l.id, c => { c.closedAt = null; c.closedBy = null; }, 'letter_edit', { number: l.number, kind: 'إعادة فتح المعاملة' }); FU.toast('أُعيد فتح المعاملة', 'ok'); refresh();
  };
  A['change:attachLetter'] = async el => {
    const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer() || l.deletedAt || l.closedAt || !el.files.length) return;
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
  A.addTask = async el => { const l = FU.byId('letters', el.dataset.id); if (!l || !FU.isOfficer() || l.deletedAt || l.closedAt) return; if (await taskDialog(l, null)) { FU.toast('تمت الإحالة', 'ok'); refresh(); } };
  A.editTask = async el => { const t = FU.byId('tasks', el.dataset.id), l = t && FU.byId('letters', t.letterId); if (!l || !FU.isOfficer() || lockedTask(t)) return; if (await taskDialog(l, t)) { FU.toast('تم الحفظ', 'ok'); refresh(); } };
  async function dropTask(t) { for (const u of FU.taskUpdates(t.id).slice()) { await FU.removeFiles(u.files); await FU.remove('updates', u.id, null); } await FU.remove('tasks', t.id, { dept: FU.deptName(t.deptId), number: letterOf(t).number }); }
  A.delTask = async el => {
    const t = FU.byId('tasks', el.dataset.id); if (!t || !FU.isOfficer() || lockedTask(t)) return;
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
  A.addUpdate = async el => { const t = FU.byId('tasks', el.dataset.id); if (!t || lockedTask(t) || !FU.canSeeTask(t) || !(FU.canActTask(t) || me().role === 'viewer')) return; if (await updateDialog(t, null)) { FU.toast('تم الحفظ', 'ok'); refresh(); } };
  A.editUpdate = async el => { const u = FU.byId('updates', el.dataset.id), t = u && FU.byId('tasks', u.taskId); if (!t || !(FU.isOfficer() || u.byId === me().id)) return; if (await updateDialog(t, u)) { FU.toast('تم الحفظ', 'ok'); refresh(); } };
  A.delUpdate = async el => {
    const u = FU.byId('updates', el.dataset.id); if (!u || !(FU.isOfficer() || (u.byId === me().id && !u.status))) return;
    if (!(await FU.confirm('حذف هذه الإفادة؟' + (u.status ? ' حالة الإحالة لا تتغير بحذفها.' : ''), 'نعم، حذف'))) return;
    await FU.removeFiles(u.files); await FU.remove('updates', u.id, { number: (FU.byId('letters', u.letterId) || {}).number, dept: FU.deptName(u.deptId) }); refresh();
  };
  A.confirmReceipt = async el => {
    const t = FU.byId('tasks', el.dataset.id); if (!t || lockedTask(t) || !FU.canActTask(t) || t.status !== 'not_received') return;
    await FU.update('tasks', t.id, c => { c.status = 'in_progress'; c.receivedAt = FU.today(); }, 'status', { number: letterOf(t).number, dept: FU.deptName(t.deptId), from: 'not_received', to: 'in_progress' });
    await FU.save('updates', { id: FU.uid(), taskId: t.id, letterId: t.letterId, deptId: t.deptId, kind: 'status', date: FU.today(), text: 'تأكيد استلام المذكرة', replyNo: '', status: 'in_progress', files: [], byId: me().id, byName: me().name }, null);
    FU.toast('تم تأكيد الاستلام', 'ok'); refresh();
  };

  Object.assign(FU, { meta, purgeTrash });
})();
