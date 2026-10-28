/* شاشة التقييم — الأسئلة محوراً محوراً، درجة من 0 إلى 10، ملاحظات ومرفقات، حفظ تلقائي، تقديم */
(function (EV) {
  const { esc, L, B, byId, list, fmtNum, fmtDate, badge, ratingBadge, field, opts, uid } = EV;
  const st = EV.state; const R = EV.route, A = EV.actions;
  let cur = null, saveTimer = null;
  const attsOf = e => list('attachments', a => a.evaluationId === e.id);
  const attachedKeys = e => new Set(attsOf(e).map(a => a.itemKey).filter(Boolean));
  const canEdit = e => e.evaluatorId === st.user.id && (e.status === 'draft' || e.status === 'returned');
  const canView = (e, cy) => { if (e.evaluatorId === st.user.id || EV.canViewAll()) return true; if (e.status !== 'submitted') return false; const v = st.settings.visibility; if (v === 'managers') return false; if (v === 'always') return true; return list('evaluations', x => x.cycleId === cy.id && x.evaluatorId === st.user.id && x.status === 'submitted').length > 0; };

  function chips(it, sc, editable) {
    const v = sc.na ? 'na' : (sc.s == null || sc.s === '' ? null : Number(sc.s));
    return `<div class="chips" role="group" aria-label="الدرجة">${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => { const s = B.scaleFor(n); return `<button type="button" class="chip ${v === n ? 'on' : ''}" style="--c:${s.color}" data-act="score" data-item="${esc(it.key)}" data-val="${n}" ${editable ? '' : 'disabled'} title="${esc(s.name)}">${n}</button>`; }).join('')}<button type="button" class="chip na ${v === 'na' ? 'on' : ''}" data-act="score" data-item="${esc(it.key)}" data-val="na" ${editable ? '' : 'disabled'}>غير منطبق</button></div><div class="scale-hint" id="sh_${esc(it.key)}">${v != null && v !== 'na' ? `<b style="color:${B.scaleFor(v).color}">${B.scaleFor(v).name}:</b> ${esc(B.scaleFor(v).text)} <small>(الدليل: ${esc(B.scaleFor(v).evidence)})</small>` : (v === 'na' ? 'يُستبعد هذا البند ويُعاد توزيع وزنه. اذكر السبب في الملاحظة.' : '')}</div>`;
  }
  function itemBlock(it, idx, e, editable, atts) {
    const sc = (Object.prototype.hasOwnProperty.call(e.scores || {}, it.key) && e.scores[it.key]) || {}; const mine = atts.filter(a => a.itemKey === it.key);
    return `<div class="item ${it.critical ? 'critical' : ''}" id="it_${esc(it.key)}"><div class="item-head"><span class="item-no">${idx}</span><div class="item-text"><p>${esc(it.text)} ${it.critical ? '<span class="crit">بند حاسم</span>' : ''} ${it.importance > 1 ? `<span class="imp">أهمية ×${esc(it.importance)}</span>` : ''}</p>${it.hint ? `<small class="hint">الدليل المقترح: ${esc(it.hint)}</small>` : ''}</div></div>${chips(it, sc, editable)}
      <div class="item-foot"><textarea class="note-in" placeholder="ملاحظة / مرجع الدليل (إلزامية للدرجات الطرفية)" data-input="note" data-item="${esc(it.key)}" rows="1" maxlength="10000" ${editable ? '' : 'disabled'}>${esc(sc.n || '')}</textarea>
      <div class="atts">${mine.map(a => `<span class="att"><button class="linkbtn" data-act="openFile" data-path="${esc(a.path)}" data-name="${esc(a.name)}">📎 ${esc(a.name)}</button>${editable ? `<button class="icon-btn" data-act="delAtt" data-id="${esc(a.id)}" title="حذف">✕</button>` : ''}</span>`).join('')}${editable ? `<label class="btn small ghost">📎 إرفاق<input type="file" multiple hidden data-change="attach" data-item="${esc(it.key)}"></label>` : ''}</div></div></div>`;
  }
  function panel(e, t, w, k, cy) {
    const r = EV.compute(t, w, e.scores, st.settings, attachedKeys(e)); e.computed = r;
    const pct = r.totalItems ? Math.round(r.answered / r.totalItems * 100) : 0;
    return `<div class="score-panel"><div class="total-box"><span class="lbl">الدرجة الكلية الحالية</span><div class="big-score">${r.total == null ? '—' : fmtNum(r.total)}<small>/10</small></div>${ratingBadge(r.rating)}</div><div class="progress"><div style="width:${pct}%"></div></div><small class="muted">${r.answered} من ${r.totalItems} سؤالاً (${pct}%)</small>
      <table class="axis-mini">${r.axes.map(a => `<tr><td><a href="#ax_${esc(a.key)}">${esc(a.name)}</a></td><td class="num muted">${esc(a.weight)}%</td><td class="num"><b>${a.score == null ? '—' : fmtNum(a.score)}</b>${a.critical ? ' ⛔' : ''}</td></tr>`).join('')}</table>
      ${r.missingEvidence.length ? `<div class="note bad small">${r.missingEvidence.length} درجة طرفية بلا ملاحظة أو مرفق: ${r.missingEvidence.map(k2 => `<a href="#it_${esc(k2)}">${esc(k2)}</a>`).join('، ')}</div>` : ''}${r.critical ? '<div class="note bad small">يوجد بند حاسم بدرجة 0: سيُصنَّف التقييم «تقرير سلبي» بعد تأكيد المراجع.</div>' : ''}</div>`;
  }

  R(/^#\/eval\/(.+)$/, id => {
    const e = byId('evaluations', id); if (!e) return EV.navigate('#/home'); const cy = byId('cycles', e.cycleId); const k = byId('contracts', e.contractId); if (!cy || !k) return EV.navigate('#/home');
    if (!canView(e, cy)) { EV.toast('لا يمكنك الاطلاع على هذا التقييم قبل تقديم تقييمك', 'warn'); return EV.navigate('#/cycle/' + cy.id); }
    const t = byId('templates', e.templateId) || EV.templateFor(k, cy); const w = EV.weightsFor(k, t, cy); const editable = canEdit(e); const atts = attsOf(e); cur = { e, t, w, k, cy };
    const comp = byId('companies', k.companyId) || {};
    let idx = 0;
    EV.page(`<div class="eval-head card"><div><h2>${esc(comp.name_ar)} <small>${L.role[k.role]}</small></h2><p class="muted">${esc(EV.projectName(k.projectId))} · ${L.cycleType[cy.type]} · ${esc(cy.label)} · النموذج: ${esc(t.name)} (إصدار ${esc(t.version)})</p><p>المقيّم: <b>${esc(EV.userName(e.evaluatorId))}</b> · ${badge(L.evalStatus[e.status], e.status === 'submitted' ? 'ok' : 'warn')}${e.submittedAt ? ` · قُدّم في ${fmtDate(e.submittedAt)}` : ''}</p>${e.status === 'returned' && e.returnedNote ? `<div class="note warn">أُعيد إليك للمراجعة: ${esc(e.returnedNote)}</div>` : ''}</div><div class="row gap"><a class="btn" href="#/cycle/${esc(cy.id)}">المقارنة</a><a class="btn" href="#/contract/${esc(k.id)}">العقد</a>${editable ? `<button class="btn primary" data-act="submitEval">تقديم التقييم</button>` : ''}</div></div>
      <div class="eval-layout"><div class="eval-main">${t.axes.map((ax, ai) => `<section class="axis card" id="ax_${esc(ax.key)}"><div class="axis-head"><h3>${ai + 1} · ${esc(ax.name)}</h3><span class="wt">الوزن ${esc(w[ax.key])}%</span><span class="axis-score" id="as_${esc(ax.key)}"></span></div>${ax.items.filter(i => i.enabled !== false).map(it => itemBlock(it, ++idx, e, editable, atts)).join('')}</section>`).join('')}
        <section class="card"><h3>الخلاصة</h3><div class="grid2">${field('نقاط القوة', `<textarea rows="3" data-input="summary" data-f="strengths" maxlength="20000" ${editable ? '' : 'disabled'}>${esc(e.strengths || '')}</textarea>`)}${field('نقاط الضعف', `<textarea rows="3" data-input="summary" data-f="weaknesses" maxlength="20000" ${editable ? '' : 'disabled'}>${esc(e.weaknesses || '')}</textarea>`)}${field('توصية المقيّم', `<select data-change="summary" data-f="recommendation" ${editable ? '' : 'disabled'}><option value="">— اختر —</option>${opts(L.recommendation, e.recommendation)}</select>`)}</div>${editable ? `<div class="row gap"><button class="btn primary big" data-act="submitEval">تقديم التقييم</button><span class="muted" id="save-state">يُحفظ تلقائياً</span></div>` : ''}</section></div>
        <aside class="eval-side" id="eval-side">${panel(e, t, w, k, cy)}</aside></div>`, { title: 'تقييم ' + comp.name_ar, wide: true });
    refreshAxisScores();
  });
  function refreshAxisScores() { const { e, t, w, k, cy } = cur; const side = document.getElementById('eval-side'); if (side) side.innerHTML = panel(e, t, w, k, cy); e.computed.axes.forEach(a => { const el = document.getElementById('as_' + a.key); if (el) el.textContent = a.score == null ? '' : fmtNum(a.score) + ' / 10'; }); }
  /* الحفظ التلقائي. في السحابي تُجمع التعديلات المتتالية 5 ثوانٍ قبل إرسالها (توفيراً لعمليات التخزين)، وتُرسل فوراً عند مغادرة
     الشاشة أو إخفاء الصفحة أو قبل التحديث والخروج؛ ولا يُرسل شيء إن لم يتغير التقييم منذ آخر حفظ.
     الانقطاع وأخطاء الخادم المؤقتة تُعاد تلقائياً، والتعديلات المعلّقة تبقى لكل تقييم على حدة حتى تُحفظ. */
  const dirty = new Set(), held = new Set(), savedSig = new WeakMap(); let saving = null, retryTimer = null, retries = 0;
  const sigOf = e => JSON.stringify(Object.assign({}, e, { updatedAt: 0, createdAt: 0, createdBy: 0 }));
  const saveState = t => { const el = document.getElementById('save-state'); if (el) el.textContent = t; };
  window.addEventListener('beforeunload', ev => { if (dirty.size || held.size || saving) { ev.preventDefault(); ev.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && dirty.size) flushSave(); });
  window.addEventListener('pagehide', () => { if (dirty.size) flushSave(); });
  window.addEventListener('hashchange', () => { if (dirty.size) flushSave(); });
  function scheduleSave() { if (!cur) return; dirty.add(cur.e); clearTimeout(saveTimer); saveState('جارٍ الحفظ…'); saveTimer = setTimeout(flushSave, EV.isCloud() ? 5000 : 500); }
  async function flushSave() {
    clearTimeout(saveTimer); clearTimeout(retryTimer);
    while (saving) await saving;
    if (!dirty.size) return true;
    saving = (async () => {
      for (const rec of [...dirty]) {
        dirty.delete(rec); const sig = sigOf(rec);
        if (!st.user || rec.evaluatorId !== st.user.id || savedSig.get(rec) === sig) continue;
        try { await EV.save('evaluations', rec, null); savedSig.set(rec, sig); retries = 0; }
        catch (err) {
          const transient = err.network || err.status === 429 || err.status >= 500;
          if (err.status === 401) { held.add(rec); EV.toast('انتهت الجلسة. سجّل الدخول مجدداً وسيُحفظ ما كتبته تلقائياً.', 'warn'); continue; }
          if (err.status === 409 || err.status === 403) { retries = 0; EV.toast('لم يُحفظ التقييم: ' + err.message, 'bad'); if (EV.isCloud()) setTimeout(() => EV.reload().catch(() => { }), 800); continue; }   // تُعاد البيانات من الخادم
          dirty.add(rec);                                                       // يبقى معلّقاً حتى يُحفظ: لا يُنسى ولا يُعرض «تم الحفظ»
          if (transient && retries < 6) { retries++; EV.toast('تعذر الحفظ مؤقتاً، ستُعاد المحاولة تلقائياً', 'warn'); clearTimeout(retryTimer); retryTimer = setTimeout(flushSave, err.status === 429 ? 30000 : 3000 * retries); }
          else if (transient) { retries = 0; EV.toast('تعذر حفظ التقييم بعد عدة محاولات (' + err.message + '). سيُعاد إرساله مع تعديلك التالي أو عند الضغط على «تحديث».', 'bad'); }
          else { retries = 0; EV.toast('لم يُحفظ التقييم: ' + err.message, 'bad'); }          // خطأ في المحتوى نفسه: يبقى معلّقاً حتى يصحّحه المقيّم
        }
      }
      saveState(dirty.size || held.size ? '⚠️ لم يُحفظ بعد' : 'تم الحفظ ' + new Date().toLocaleTimeString('ar-QA-u-nu-latn', { hour: '2-digit', minute: '2-digit' }));
    })();
    try { await saving; } finally { saving = null; }
    return !dirty.size && !held.size;
  }
  EV.flushPending = flushSave;
  /* بعد إعادة الدخول بالحساب نفسه تُرسل التعديلات التي رُفضت لانتهاء الجلسة؛ والخادم يرفضها إن عدّل غيرك السجل في هذه الأثناء */
  EV.resumeHeld = async userId => {
    let n = 0; for (const rec of [...held]) { held.delete(rec); if (rec.evaluatorId === userId) { dirty.add(rec); n++; } }
    if (!n) return; await flushSave(); EV.render();
  };
  /* عند الخروج (أو تخلي المستخدم عن تعديلاته) لا يبقى شيء منها في الطابور فيُرسل لاحقاً باسم من يدخل بعده */
  EV.onLogout(() => { held.clear(); dirty.clear(); clearTimeout(saveTimer); clearTimeout(retryTimer); retries = 0; cur = null; });
  const safeKey = k => typeof k === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(k) && !(k in Object.prototype);    // مفاتيح أسئلة آمنة فقط (لا __proto__ ولا constructor ونحوهما)
  A.score = el => { const { e, t } = cur; if (!canEdit(e)) return; const key = el.dataset.item, v = el.dataset.val; if (!safeKey(key)) return; const sc = e.scores[key] = e.scores[key] || {}; if (v === 'na') { sc.na = !sc.na; sc.s = null; } else { sc.na = false; sc.s = Number(v); } const it = t.axes.flatMap(a => a.items).find(i => i.key === key); const box = el.closest('.item'); const sel = box.querySelector('.chips'); sel.outerHTML = chips(it, sc, true).replace(/<div class="scale-hint"[\s\S]*$/, ''); const hint = box.querySelector('.scale-hint'); const nh = document.createElement('div'); nh.innerHTML = chips(it, sc, true); hint.replaceWith(nh.querySelector('.scale-hint')); refreshAxisScores(); scheduleSave(); };
  A['input:note'] = el => { if (!safeKey(el.dataset.item)) return; const sc = cur.e.scores[el.dataset.item] = cur.e.scores[el.dataset.item] || {}; sc.n = el.value; el.style.height = 'auto'; el.style.height = (el.scrollHeight) + 'px'; refreshAxisScores(); scheduleSave(); };
  A['input:summary'] = el => { cur.e[el.dataset.f] = el.value; scheduleSave(); };
  A['change:summary'] = el => { cur.e[el.dataset.f] = el.value; scheduleSave(); };
  A['change:attach'] = async el => {
    const { e, k, cy, t } = cur; const key = el.dataset.item; const ax = t.axes.find(a => a.items.some(i => i.key === key)); const files = [...el.files]; let n = 0;
    for (const f of files) {
      const path = `attachments/${k.id}/${uid().slice(0, 8)}__${EV.safeFileName(f.name)}`;
      try { await st.store.saveFile(path, f); await EV.save('attachments', { id: uid(), contractId: k.id, cycleId: cy.id, evaluationId: e.id, axisKey: ax ? ax.key : null, itemKey: key, path, name: f.name, size: f.size, mime: f.type, uploadedBy: st.user.id }, 'attachment_add'); n++; }
      catch (err) { EV.toast('لم يُرفق «' + f.name + '»: ' + err.message, 'bad'); if (err.status === 401) return; }
    }
    el.value = '';
    if (n) EV.toast(n === 1 ? 'تم إرفاق الملف' : 'تم إرفاق ' + n + ' ملفات', 'ok');
    EV.render();
  };
  /* في السحابي يحذف الخادم الملف مع سجله */
  A.delAtt = async el => { const a = byId('attachments', el.dataset.id); if (!a) return; if (!(await EV.confirm('حذف المرفق؟'))) return; if (!EV.isCloud()) await st.store.deleteFile(a.path); await EV.remove('attachments', a.id); EV.render(); };
  A.submitEval = async () => {
    const { e, t, w, cy } = cur; const r = EV.compute(t, w, e.scores, st.settings, attachedKeys(e));
    if (!r.complete) return EV.toast(`بقي ${r.totalItems - r.answered} سؤالاً بلا درجة. أجب عنها أو اختر «غير منطبق».`, 'bad');
    if (r.missingEvidence.length) return EV.toast('الدرجات الطرفية (' + st.settings.evidenceLow + ' فأقل أو ' + st.settings.evidenceHigh + ' فأكثر) تحتاج ملاحظة أو مرفقاً: ' + r.missingEvidence.length + ' بند', 'bad');
    if (!e.recommendation) return EV.toast('اختر توصية المقيّم في الخلاصة', 'bad');
    const ok = await EV.modal({ title: 'تقديم التقييم', okText: 'تقديم نهائي', body: `<p>الدرجة الكلية <b>${fmtNum(r.total)}</b> من 10 — ${ratingBadge(r.rating)}</p>${r.critical ? '<div class="note bad">يوجد بند حاسم بدرجة 0، وسيُعرض التقييم كتقرير سلبي.</div>' : ''}<p class="muted">بعد التقديم لا يمكنك تعديل الدرجات إلا إذا أعاده إليك رئيس القسم.</p>` });
    if (!ok) return;
    /* التقديم يحفظ التقييم كاملاً، فيُلغى الحفظ التلقائي المعلّق له؛ وإن فشل التقديم يعود التقييم مسودة كما كان */
    clearTimeout(saveTimer); while (saving) await saving; dirty.delete(e);
    const before = { computed: e.computed, status: e.status, submittedAt: e.submittedAt, returnedNote: e.returnedNote };
    e.computed = r; e.status = 'submitted'; e.submittedAt = EV.nowISO(); e.returnedNote = '';
    try { await EV.save('evaluations', e, 'evaluation_submit'); }
    catch (err) {
      Object.keys(before).forEach(x => { if (before[x] === undefined) delete e[x]; else e[x] = before[x]; });
      if (err.status === 401) held.add(e);                                          // يُحفظ مسودةً بعد إعادة الدخول
      else if (err.status !== 409 && err.status !== 403) { dirty.add(e); if (err.network || err.status === 429 || err.status >= 500) { clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, 3000); } }
      EV.render(); throw err;
    }
    savedSig.set(e, sigOf(e)); EV.toast('تم تقديم التقييم', 'ok'); EV.navigate('#/cycle/' + cy.id);
  };
})(window.EV);
