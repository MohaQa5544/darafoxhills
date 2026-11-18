/* التقارير — برنامج المتابعة: تقرير السجل، ملخص المتابعة، بطاقة متابعة كتاب، وتصدير Excel */
(function () {
  const FU = window.FU, { esc, nl2br, badge, statusBadge, dueBadge, fmtDate, STATUS, KIND } = FU;
  const cfg = () => FU.state.settings;
  const head = (title, sub) => `<div class="rpt-head"><div class="rh-side">${FU.logo('moe', 'rh-logo')}</div><div class="rh-mid"><div class="rh-org">${esc(cfg().ministryName)}<br>${esc(cfg().orgName)} — ${esc(cfg().unitName)}</div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div><div class="rh-side">${FU.logo('awqaf', 'rh-logo')}</div></div>`;
  const foot = () => `<div class="rpt-foot"><span>${esc(cfg().appName)} — ${esc(cfg().subtitle)}</span><span>طُبع في ${esc(FU.fmtDateTime(new Date()))} · ${esc(FU.state.user.name)}</span></div>`;
  const chips = s => `<div class="chips"><span><b>${s.total}</b> تكليف</span><span><b>${s.open}</b> مفتوح</span><span class="bad-text"><b>${s.overdue}</b> متأخر</span><span><b>${s.problem}</b> فيه مشكلة</span><span><b>${s.not_received}</b> لم يُستلم</span><span><b>${s.done}</b> تم تنفيذه</span><span><b>${s.no_action}</b> لا إجراء</span></div>`;

  FU.route(/^#\/print\/register$/, () => {
    const g = FU.registerQuery(), tasks = [].concat(...g.map(x => x.ts));
    FU.printPage(`<div class="sheet">${head('تقرير متابعة الكتب والتكليفات', FU.filterSummary())}${chips(FU.stats(tasks))}
      ${g.length ? FU.regTable(g, true) : '<p class="muted c">لا توجد نتائج مطابقة.</p>'}${foot()}</div>`, { title: 'تقرير المتابعة', orientation: 'landscape' });
  });

  FU.route(/^#\/print\/summary$/, () => {
    const tasks = FU.myTasks(), att = FU.attention(tasks), dept = FU.inDept();
    FU.printPage(`<div class="sheet">${head('ملخص المتابعة', dept ? FU.deptName(FU.state.user.deptId) : 'كل الإدارات')}${chips(FU.stats(tasks))}
      ${dept ? '' : '<h2>ملخص الإدارات</h2>' + FU.deptTable(tasks, true)}
      <h2>تحتاج انتباهاً (${att.length})</h2>
      ${att.length ? `<table class="grid"><thead><tr><th>الموضوع</th><th>رقم الكتاب</th><th>جهة الاختصاص</th><th>الحالة</th><th>الاستحقاق</th><th>آخر إفادة</th></tr></thead><tbody>${att.map(x => { const l = FU.letterOf(x.t); return `<tr><td>${esc(l.subject)}</td><td class="c">${esc(l.number)}</td><td>${esc(FU.deptName(x.t.deptId))}</td><td class="c">${statusBadge(x.t.status)}${FU.escalBadge(x.i)}</td><td class="c num">${x.i.due ? fmtDate(x.i.due) + '<br>' : ''}${dueBadge(x.t, x.i)}</td><td>${x.i.last ? esc(x.i.last.text) + ` <span class="muted small">(${fmtDate(x.i.last.date)})</span>` : '—'}</td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">لا يوجد متأخر ولا مشكلات.</p>'}${foot()}</div>`, { title: 'ملخص المتابعة', orientation: 'portrait' });
  });

  FU.route(/^#\/print\/letter\/([^/]+)$/, id => {
    const l = FU.byId('letters', id), ts = l ? FU.letterTasks(id).filter(FU.canSeeTask) : [];
    if (!l || l.deletedAt || (FU.inDept() && !ts.length)) return FU.navigate('#/register');
    FU.printPage(`<div class="sheet">${head('بطاقة متابعة كتاب', 'رقم ' + l.number)}
      ${FU.meta([['م', esc(l.seq)], ['الموضوع', esc(l.subject)], ['رقم الكتاب', esc(l.number)], ['تاريخ الكتاب الوارد', fmtDate(l.date)], l.from ? ['الجهة الوارد منها', esc(l.from)] : null, ['الأولوية', l.priority === 'urgent' ? 'عاجل' : 'عادي']])}
      ${l.notes ? `<p><b>ملاحظات:</b> ${nl2br(l.notes)}</p>` : ''}
      ${ts.map(t => { const i = FU.taskInfo(t), ups = FU.taskUpdates(t.id); return `<div class="keep"><h2>${esc(FU.deptName(t.deptId))} ${statusBadge(t.status)} ${dueBadge(t, i)}</h2>
        ${FU.meta([['تاريخ الإحالة', fmtDate(t.startDate)], ['المدة المتوقعة', t.days === '' || t.days == null ? '—' : FU.daysWord(+t.days)], ['تاريخ الاستحقاق', i.due ? fmtDate(i.due) : '—'], ['موظف المتابعة', t.followerId ? esc(FU.userName(t.followerId)) : '—'], t.status === 'done' ? ['تاريخ التنفيذ', fmtDate(t.doneDate)] : null, ['التذكيرات', String(FU.reminders(t))]])}</div>
        ${ups.length ? `<table class="grid"><thead><tr><th>التاريخ</th><th>النوع</th><th>البيان</th><th>رقم كتاب الرد</th><th>بواسطة</th></tr></thead><tbody>${ups.map(u => `<tr><td class="c num">${fmtDate(u.date)}</td><td class="c">${esc(u.kind === 'remind' && u.no ? 'تذكير رقم ' + u.no : KIND[u.kind] || u.kind)}</td><td>${nl2br(u.text || u.note || '')}${u.status ? ` ${badge('← ' + (STATUS[u.status] || {}).t, 'gray')}` : ''}</td><td class="c">${esc(u.replyNo || '')}</td><td>${esc(u.byName || '')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">لا توجد إفادات بعد.</p>'}`; }).join('') || '<p class="muted">لم يُحَل هذا الكتاب إلى أي إدارة بعد.</p>'}${foot()}</div>`, { title: 'بطاقة متابعة — ' + l.number, orientation: 'portrait' });
  });

  /* تصدير السجل بالتصفية الحالية: صف لكل تكليف بأعمدة ملف المتابعة السابق (ثلاث إفادات أولى) مع الاستحقاق وآخر إفادة */
  FU.actions.exportCsv = () => {
    const rows = [['م', 'الموضوع', 'رقم الكتاب', 'تاريخ الكتاب الوارد', 'الجهة الوارد منها', 'جهة الاختصاص', 'حالة الإجراء', 'المدة المتوقعة للإنجاز بالأيام', 'تاريخ الاستحقاق', 'الأيام الباقية (السالب تأخر)', 'عدد الإفادات', 'عدد التذكيرات', 'الموظف المعني بالمتابعة', 'الإفادة الأولى', 'تاريخ الإفادة الأولى', 'الإفادة الثانية', 'تاريخ الإفادة الثانية', 'الإفادة الثالثة', 'تاريخ الإفادة الثالثة', 'آخر إفادة', 'تاريخ آخر إفادة', 'تاريخ التنفيذ', 'الملاحظات']];
    for (const g of FU.registerQuery()) {
      const l = g.l, base = [Number(l.seq) || '', l.subject, String(l.number), l.date, l.from || ''];
      if (!g.ts.length) { rows.push(base.concat(['', 'لم يُحَل بعد', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', l.notes || ''])); continue; }
      for (const t of g.ts) {
        const i = FU.taskInfo(t), ups = FU.taskUpdates(t.id).filter(u => u.text && (u.kind === 'action' || u.kind === 'follow')), three = [];
        for (let k = 0; k < 3; k++) three.push(ups[k] ? ups[k].text : '', ups[k] ? ups[k].date : '');
        rows.push(base.concat([FU.deptName(t.deptId), (STATUS[t.status] || {}).t || t.status, t.days === '' || t.days == null ? '' : Number(t.days), i.due || '', i.left == null ? '' : i.left, i.n, FU.reminders(t), t.followerId ? FU.userName(t.followerId) : ''], three, [i.last ? i.last.text : '', i.last ? i.last.date : '', t.doneDate || '', [l.notes, t.notes].filter(Boolean).join(' — ')]));
      }
    }
    FU.download('سجل-المتابعة-' + FU.today() + '.csv', FU.csvText(rows), 'text/csv;charset=utf-8'); FU.toast('تم تنزيل الملف — يُفتح ببرنامج Excel', 'ok');
  };
})();
