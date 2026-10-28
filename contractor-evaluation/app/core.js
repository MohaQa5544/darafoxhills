/* النواة — سجل الأداء: الحالة، الدخول، التوجيه، الحفظ، محرك الاحتساب، أدوات الواجهة */
window.EV = (function () {
  const B = window.EV_BANK, L = B.labels, S = window.EV_STORE;
  const state = { user: null, store: null, data: null, settings: null, pendingHandle: null, printOrientation: 'portrait' };
  const routes = []; const actions = {}; const forms = {};
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  /* تنقية HTML المخزّن في الخطابات: تبقى وسوم قوالب texts.js وmakeLetter وحدها (أضف هنا أي وسم جديد يُستخدم فيها) وسماتها الآمنة،
     وتُحذف العناصر النشطة بمحتواها، ويُفكّ أي وسم آخر ويبقى نصه، ولا تبقى أجزاء الجدول إلا داخل جدول حتى لا تخرج من خلية الورقة */
  const SAFE_TAGS = new Set(['p', 'br', 'b', 'strong', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td']), SAFE_ATTRS = new Set(['class', 'dir', 'colspan', 'rowspan']);
  const DROP_TAGS = new Set(['script', 'style', 'meta', 'link', 'base', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup', 'datalist', 'svg', 'math', 'img', 'picture', 'video', 'audio', 'source', 'track', 'canvas', 'template', 'noscript', 'noembed', 'noframes', 'title']);
  const TABLE_PARENT = { thead: ['table'], tbody: ['table'], tr: ['table', 'thead', 'tbody'], th: ['tr'], td: ['tr'] };
  function safeHtml(html) {
    const tpl = document.createElement('template'); tpl.innerHTML = String(html == null ? '' : html);
    (function walk(parent) {
      for (let n = parent.firstChild, next; n; n = next) {
        next = n.nextSibling; if (n.nodeType === 3) continue;
        const tag = n.nodeType === 1 && n.namespaceURI === 'http://www.w3.org/1999/xhtml' ? n.localName : null;
        if (!tag || DROP_TAGS.has(tag)) { n.remove(); continue; }
        if (!SAFE_TAGS.has(tag) || n.hasAttribute('is') || (TABLE_PARENT[tag] && !TABLE_PARENT[tag].includes(parent.localName))) { next = n.firstChild || next; n.replaceWith(...n.childNodes); continue; }
        [...n.attributes].forEach(a => { if (!SAFE_ATTRS.has(a.name)) n.removeAttribute(a.name); }); walk(n);
      }
    })(tpl.content);
    return tpl.innerHTML;
  }
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
  const clone = o => JSON.parse(JSON.stringify(o));
  const nowISO = () => new Date().toISOString();
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const fmtDate = d => { if (!d) return '—'; try { return new Date(d).toLocaleDateString('ar-QA-u-nu-latn', { year: 'numeric', month: 'long', day: 'numeric' }); } catch (e) { return String(d).slice(0, 10); } };
  const fmtDateTime = d => { if (!d) return '—'; try { return new Date(d).toLocaleString('ar-QA-u-nu-latn', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(d); } };
  const fmtNum = (n, dg = 1) => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US', { minimumFractionDigits: dg, maximumFractionDigits: dg });
  const fmtMoney = n => (n == null || n === '' || isNaN(n)) ? '—' : Number(n).toLocaleString('en-US') + ' ر.ق';
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };

  /* ---------- SHA-256 (WebCrypto مع بديل JS) ---------- */
  function sha256js(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    const mathPow = Math.pow, maxWord = mathPow(2, 32); let result = '';
    const words = [], asciiBitLength = ascii.length * 8; let hash = sha256js.h = sha256js.h || [], k = sha256js.k = sha256js.k || [], primeCounter = k.length; const isComposite = {};
    for (let candidate = 2; primeCounter < 64; candidate++) { if (!isComposite[candidate]) { for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate; hash[primeCounter] = (mathPow(candidate, .5) * maxWord) | 0; k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0; } }
    ascii += '\x80'; while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) { const j = ascii.charCodeAt(i); if (j >> 8) return; words[i >> 2] |= j << ((3 - i) % 4) * 8; }
    words[words.length] = ((asciiBitLength / maxWord) | 0); words[words.length] = (asciiBitLength);
    for (let j = 0; j < words.length;) { const w = words.slice(j, j += 16); const oldHash = hash; hash = hash.slice(0, 8);
      for (let i = 0; i < 64; i++) { const w15 = w[i - 15], w2 = w[i - 2]; const a = hash[0], e = hash[4]; const temp1 = hash[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & hash[5]) ^ ((~e) & hash[6])) + k[i] + (w[i] = (i < 16) ? w[i] : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0); const temp2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2])); hash = [(temp1 + temp2) | 0].concat(hash); hash[4] = (hash[4] + temp1) | 0; }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0; }
    for (let i = 0; i < 8; i++) for (let j = 3; j + 1; j--) { const b = (hash[i] >> (j * 8)) & 255; result += ((b < 16) ? 0 : '') + b.toString(16); }
    return result;
  }
  async function sha256(str) {
    const bytes = new TextEncoder().encode(str);
    if (crypto.subtle) { try { const buf = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (e) { } }
    let bin = ''; bytes.forEach(b => bin += String.fromCharCode(b)); return sha256js(bin);
  }
  const hashPassword = (pw, salt) => sha256(salt + ':' + pw);

  /* ---------- الصلاحيات ---------- */
  const RANK = { secretary: 0, engineer: 1, section_head: 2, assistant_director: 3, waqf_dev_head: 3, director: 4, admin: 5 };
  const rank = () => state.user ? (RANK[state.user.role] || 0) : 0;
  const isManager = () => rank() >= 2, isApprover = () => rank() >= 3, isAdmin = () => state.user && state.user.role === 'admin';
  const canEvaluate = () => !!state.user && state.user.role !== 'secretary';
  const canViewAll = () => isManager() || (!!state.user && state.user.role === 'secretary');
  function can(what) { switch (what) { case 'evaluate': return canEvaluate(); case 'viewAll': return canViewAll(); case 'manage': return isManager(); case 'approve': return isApprover(); case 'admin': return isAdmin(); case 'templates': return isApprover(); case 'audit': return isApprover(); default: return !!state.user; } }

  /* ---------- البيانات ---------- */
  const byId = (coll, id) => (state.data && state.data[coll] || []).find(r => r.id === id);
  const list = (coll, f) => (state.data && state.data[coll] || []).filter(f || (() => true));
  async function audit(action, entity, entityId, detail) { try { await state.store.appendAudit({ id: uid(), at: nowISO(), actor: state.user ? state.user.id : null, actorName: state.user ? state.user.username : 'system', action, entity, entityId: entityId || null, detail: detail || null }); } catch (e) { console.warn('audit', e); } }
  const recName = r => r ? (r.name || r.name_ar || r.username || r.label || r.type || '') : '';
  async function save(coll, rec, action) {
    const prev = [rec.updatedAt, rec.createdAt, rec.createdBy];
    rec.updatedAt = nowISO(); if (!rec.createdAt) rec.createdAt = rec.updatedAt; if (!rec.createdBy && state.user) rec.createdBy = state.user.id;
    if (state.store.putRecord) {
      try { await state.store.putRecord(coll, rec, { base: prev[0] || null, audit: action === null ? null : { action: action || 'save', detail: { name: recName(rec) } } }); }
      catch (e) { ['updatedAt', 'createdAt', 'createdBy'].forEach((k, i) => { if (prev[i] === undefined) delete rec[k]; else rec[k] = prev[i]; }); throw e; }
      return rec;
    }
    await state.store.put(coll, rec); if (action !== null) await audit(action || 'save', coll, rec.id, { name: recName(rec) }); return rec;
  }
  async function remove(coll, id) { const r = byId(coll, id); if (state.store.mode === 'cloud') { await state.store.remove(coll, id, { audit: { action: 'delete', detail: { name: recName(r) } } }); return; } await state.store.remove(coll, id); await audit('delete', coll, id, { name: recName(r) }); }
  const userName = id => { const u = byId('users', id); return u ? u.name : '—'; };
  const companyName = id => { const c = byId('companies', id); return c ? c.name_ar : '—'; };
  const projectName = id => { const p = byId('projects', id); return p ? p.name : '—'; };

  async function seedIfEmpty() {
    const d = state.data;
    if (!d.settings) await state.store.putSettings(clone(B.defaultSettings));
    state.settings = Object.assign(clone(B.defaultSettings), d.settings);
    if (!d.templates.length) for (const t of B.templates) await state.store.put('templates', { id: uid(), role: t.role, name: t.name, version: 1, status: 'active', axes: clone(t.axes), note: 'الإصدار الافتراضي من المنهجية المرجعية', createdAt: nowISO() });
    if (!d.users.length) {
      const seed = (window.EV_SEED_USERS && window.EV_SEED_USERS.length) ? window.EV_SEED_USERS : [{ username: 'fhussni', name: 'فراس عبدالعليم الحصني', role: 'admin', email: 'fhussni@awqaf.gov.qa' }];
      for (const s of seed) { const u = { id: uid(), username: s.username, name: s.name, email: s.email || '', role: s.role || 'engineer', active: true, mustChange: true, salt: uid(), createdAt: nowISO() }; u.hash = await hashPassword(s.password || '123456', u.salt); await state.store.put('users', u); }
    }
  }

  /* ---------- الدخول ---------- */
  const isCloud = () => !!(state.store && state.store.mode === 'cloud');
  function applyData(d) { state.data = d; state.settings = Object.assign(clone(B.defaultSettings), d.settings); }
  async function login(username, password) {
    if (isCloud()) { const r = await state.store.login(String(username || '').trim(), password); applyData(state.store.data); state.user = byId('users', r.me); if (!state.user) throw new Error('تعذر تحميل بيانات الحساب'); return; }
    const u = list('users').find(x => x.username.toLowerCase() === String(username || '').trim().toLowerCase());
    if (!u) throw new Error('اسم المستخدم غير موجود');
    if (!u.active) throw new Error('هذا الحساب معطَّل. راجع مدير النظام');
    if ((await hashPassword(password, u.salt)) !== u.hash) throw new Error('كلمة المرور غير صحيحة');
    state.user = u; sessionStorage.setItem('ev_user', u.id); u.lastLoginAt = nowISO(); await save('users', u, null); await audit('login', 'users', u.id);
  }
  function logout() { if (isCloud()) { state.store.logout(); applyData(state.store.data); } else audit('logout', 'users', state.user && state.user.id); state.user = null; sessionStorage.removeItem('ev_user'); navigate('#/login'); }
  async function setPassword(user, pw, current) { if (isCloud()) { await state.store.changePassword(pw, current); user.mustChange = false; return; } user.salt = uid(); user.hash = await hashPassword(pw, user.salt); user.mustChange = false; await save('users', user, 'password_change'); }

  /* ---------- النماذج والاحتساب ---------- */
  const activeTemplate = role => list('templates', t => t.role === role && t.status === 'active').sort((a, b) => b.version - a.version)[0];
  function templateFor(contract, cycle) { if (cycle && cycle.type === 'post_occupancy') return activeTemplate('post_occupancy'); return byId('templates', contract.templateId) || activeTemplate(contract.model === 'small' ? 'small' : contract.role); }
  function weightsFor(contract, template, cycle) { const w = {}; template.axes.forEach(a => w[a.key] = Number(a.weight)); if (!(cycle && cycle.type === 'post_occupancy') && contract.weights) Object.keys(contract.weights).forEach(k => { if (w[k] != null && contract.weights[k] !== '' && contract.weights[k] != null) w[k] = Number(contract.weights[k]); }); return w; }
  function ratingFor(t, th) { th = th || state.settings.thresholds; if (t >= th.excellent) return 'excellent'; if (t >= th.very_good) return 'very_good'; if (t >= th.good) return 'good'; if (t >= th.acceptable) return 'acceptable'; return 'weak'; }
  function compute(template, weights, scores, settings, attachedKeys) {
    settings = settings || state.settings; attachedKeys = attachedKeys || new Set(); scores = scores || {};
    const axes = []; let acc = 0, wsum = 0, critical = false, answered = 0, totalItems = 0; const missingEvidence = [];
    for (const ax of template.axes) {
      const items = ax.items.filter(i => i.enabled !== false); let s = 0, wi = 0, axCrit = false; const rows = [];
      for (const it of items) {
        totalItems++; const sc = scores[it.key] || {};
        if (sc.na) { answered++; rows.push({ key: it.key, na: true, n: sc.n || '' }); continue; }
        if (sc.s == null || sc.s === '') { rows.push({ key: it.key, s: null, n: sc.n || '' }); continue; }
        answered++; const v = Number(sc.s), imp = Number(it.importance) || 1; s += v * imp; wi += imp;
        if (it.critical && v === 0) { critical = true; axCrit = true; }
        if ((v <= settings.evidenceLow || v >= settings.evidenceHigh) && !(sc.n && sc.n.trim()) && !attachedKeys.has(it.key)) missingEvidence.push(it.key);
        rows.push({ key: it.key, s: v, n: sc.n || '' });
      }
      const score = wi ? s / wi : null; const w = Number(weights[ax.key] != null ? weights[ax.key] : ax.weight) || 0;
      if (score != null) { acc += w * score; wsum += w; }
      axes.push({ key: ax.key, name: ax.name, weight: w, score, critical: axCrit, na: wi === 0, items: rows });
    }
    const total = wsum ? acc / wsum : null; let rating = total == null ? 'none' : ratingFor(total, settings.thresholds); if (critical) rating = 'negative';
    return { axes, total, rating, critical, answered, totalItems, complete: answered === totalItems, missingEvidence };
  }
  function consolidate(cycle, evals, contract, template, settings) {
    settings = settings || state.settings; const included = evals.filter(e => e.status === 'submitted' && !(cycle.excluded || []).includes(e.id));
    const weights = weightsFor(contract, template, cycle); const method = cycle.method || 'mean', ew = cycle.evalWeights || {};
    const axes = template.axes.map(ax => { const vals = []; let s = 0, w = 0; for (const e of included) { const a = ((e.computed && e.computed.axes) || []).find(x => x.key === ax.key); if (!a || a.score == null) continue; const ww = method === 'weighted' ? (Number(ew[e.evaluatorId]) || 1) : 1; s += a.score * ww; w += ww; vals.push(a.score); } const score = w ? s / w : null; const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0; return { key: ax.key, name: ax.name, weight: Number(weights[ax.key] != null ? weights[ax.key] : ax.weight), score, spread, gap: spread > settings.gapThreshold, n: vals.length }; });
    let acc = 0, wsum = 0; for (const a of axes) if (a.score != null) { acc += a.weight * a.score; wsum += a.weight; }
    const total = wsum ? acc / wsum : null; const critical = included.some(e => e.computed && e.computed.critical);
    let rating = total == null ? 'none' : ratingFor(total, settings.thresholds); if (critical) rating = 'negative';
    return { axes, total, rating, critical, count: included.length, evaluationIds: included.map(e => e.id), method, at: nowISO() };
  }
  function companyScores(companyId) {
    const rows = [];
    for (const c of list('contracts', x => x.companyId === companyId)) for (const cy of list('cycles', x => x.contractId === c.id && x.status === 'approved' && x.consolidated && x.consolidated.total != null)) rows.push({ contract: c, cycle: cy, total: cy.consolidated.total, rating: cy.consolidated.rating, value: Number(c.value) || 0, date: cy.approvedAt || cy.updatedAt || cy.createdAt });
    rows.sort((a, b) => (a.date < b.date ? 1 : -1));
    const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 3);
    const recent = rows.filter(r => r.cycle.type !== 'interim' && new Date(r.date) >= cutoff);
    let acc = 0, w = 0; for (const r of recent) { const base = r.value || 1; const ww = r.cycle.type === 'post_occupancy' ? base * (state.settings.postOccupancyWeight || 0.15) : base; acc += r.total * ww; w += ww; }
    const annual = w ? acc / w : null;
    return { rows, recent, annual, latest: rows[0] || null, rating: annual == null ? 'none' : ratingFor(annual), negative: rows.some(r => r.rating === 'negative') };
  }
  function suggestedConsequence(rating) { return { excellent: 'preferred', very_good: 'eligible', good: 'improvement', acceptable: 'warning', weak: 'blacklist', negative: 'blacklist' }[rating] || 'none'; }
  const isSmallContract = c => (Number(c.value) > 0 && Number(c.value) < state.settings.smallContractValue) || (Number(c.durationMonths) > 0 && Number(c.durationMonths) < state.settings.smallContractMonths);

  /* ---------- الواجهة ---------- */
  function toast(msg, type) { const t = $('#toast'); const el = document.createElement('div'); el.className = 'toast ' + (type || 'info'); el.textContent = msg; t.appendChild(el); setTimeout(() => el.classList.add('show'), 10); setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3600); }
  function modal(opts) {
    return new Promise(resolve => {
      const m = $('#modal'); m.hidden = false; m.innerHTML = `<div class="modal-box ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true"><div class="modal-head"><h3>${esc(opts.title || '')}</h3><button class="icon-btn" data-m="cancel" aria-label="إغلاق">✕</button></div><div class="modal-body">${opts.body || ''}</div><div class="modal-foot">${opts.hideOk ? '' : `<button class="btn primary" data-m="ok">${esc(opts.okText || 'موافق')}</button>`}${opts.hideCancel ? '' : `<button class="btn" data-m="cancel">${esc(opts.cancelText || 'إلغاء')}</button>`}</div></div>`;
      const done = v => { m.hidden = true; m.innerHTML = ''; resolve(v); };
      let busy = false;
      m.onclick = async e => { const b = e.target.closest('[data-m]'); if (!b) { if (e.target === m && !busy) done(false); return; } if (busy) return;
        if (b.dataset.m === 'ok') { if (opts.onOk) { busy = true; b.disabled = true; let r; try { r = await opts.onOk(m); } catch (err) { console.error(err); busy = false; b.disabled = false; toast('خطأ: ' + err.message, 'bad'); if (err.status === 409 || err.status === 403) { done(false); resync(err); } return; } busy = false; b.disabled = false; if (r === false) return; done(r === undefined ? true : r); } else done(true); } else done(false); };
      if (opts.onOpen) opts.onOpen(m); const f = m.querySelector('input,select,textarea'); if (f) f.focus();
    });
  }
  const confirm = (msg, okText) => modal({ title: 'تأكيد', body: `<p>${esc(msg)}</p>`, okText: okText || 'نعم، متابعة' });
  const badge = (text, cls) => `<span class="badge b-${esc(cls || 'soft')}">${esc(text)}</span>`;
  const ratingBadge = code => badge(L.rating[code] || code, L.ratingClass[code] || 'soft');
  const field = (label, input, hint) => `<label class="field"><span class="lbl">${esc(label)}</span>${input}${hint ? `<small class="hint">${esc(hint)}</small>` : ''}</label>`;
  const opts = (map, sel) => Object.keys(map).map(k => `<option value="${esc(k)}" ${String(sel) === k ? 'selected' : ''}>${esc(map[k])}</option>`).join('');
  function formData(form) { const o = {}; new FormData(form).forEach((v, k) => { if (k.endsWith('[]')) { (o[k.slice(0, -2)] = o[k.slice(0, -2)] || []).push(v); } else o[k] = v; }); form.querySelectorAll('input[type=checkbox]').forEach(c => { if (!c.name.endsWith('[]')) o[c.name] = c.checked; }); return o; }

  function page(html, o) {
    o = o || {}; document.title = (o.title ? o.title + ' — ' : '') + state.settings.appName;
    document.body.classList.toggle('print-mode', !!o.print);
    const u = state.user; const nav = [['#/home', 'الرئيسية'], ['#/companies', 'الشركات'], ['#/projects', 'المشاريع والعقود'], ['#/register', 'السجل والقوائم'], ['#/settings', 'الإعدادات']];
    const cur = location.hash.split('/')[1] || 'home';
    $('#app').innerHTML = `<header class="top"><div class="brand"><img src="${window.LOGO_MOE || ''}" alt="وزارة الأوقاف والشؤون الإسلامية" class="logo-moe"><div class="app-title"><h1>${esc(state.settings.appName)}</h1><p>نظام تقييم أداء المقاولين والاستشاريين — ${esc(state.settings.orgName)}</p></div><img src="${window.LOGO_AWQAF || ''}" alt="أوقاف" class="logo-awqaf"></div>
      <div class="userbar"><span class="who"><b>${esc(u.name)}</b> · ${esc(L.userRole[u.role])}</span><button class="btn small${state.store.remoteChanged ? ' has-updates' : ''}" data-act="reload" title="${state.store.remoteChanged ? 'أضاف الزملاء تعديلات جديدة — اضغط لتحميلها' : 'إعادة تحميل أحدث البيانات'}">⟳ تحديث</button><a class="btn small" href="#/password">كلمة المرور</a><button class="btn small" data-act="logout">خروج</button></div></header>
      <nav class="tabs">${nav.map(([h, t]) => `<a href="${h}" ${('#/' + cur) === h ? 'aria-current="page"' : ''}>${t}</a>`).join('')}<span class="grow"></span><span class="store-info" title="${esc(state.store.describe())}">${state.store.mode === 'folder' ? '📁 مجلد مشترك' : state.store.mode === 'cloud' ? '☁️ سحابي' : '💾 هذا الجهاز'}</span></nav>
      <main id="main" class="${o.wide ? 'wide' : ''}">${html}</main>
      <footer class="foot"><span>${esc(state.settings.orgName)} · ${esc(state.settings.ministryName)}</span><span>سجل الأداء · الإصدار 1.0</span></footer>`;
    window.scrollTo(0, 0);
  }
  function printPage(html, o) { o = o || {}; document.title = o.title || 'تقرير'; document.body.classList.add('print-mode'); setOrientation(o.orientation || state.printOrientation); $('#app').innerHTML = `<div class="print-bar no-print"><button class="btn" data-act="back">← رجوع</button><span class="grow"></span><label>الاتجاه: <select data-change="orientation"><option value="portrait" ${state.printOrientation === 'portrait' ? 'selected' : ''}>طولي A4</option><option value="landscape" ${state.printOrientation === 'landscape' ? 'selected' : ''}>عرضي A4</option></select></label><button class="btn primary" data-act="print">🖨 طباعة / حفظ PDF</button></div>${html}`; window.scrollTo(0, 0); }
  function setOrientation(o) { state.printOrientation = o; let st = $('#page-style'); if (!st) { st = document.createElement('style'); st.id = 'page-style'; document.head.appendChild(st); } st.textContent = `@page{size:A4 ${o};margin:0}`; document.body.classList.toggle('landscape', o === 'landscape'); }

  /* ---------- التوجيه ---------- */
  function route(re, fn, o) { routes.push({ re, fn, o: o || {} }); }
  function navigate(h) { if (location.hash === h) render(); else location.hash = h; }
  async function render() {
    try {
      if (!state.store) return renderSetup();
      const h = location.hash || '#/home';
      if (!state.user) return EV.screens.login();
      if (state.user.mustChange && h !== '#/password') return navigate('#/password');
      for (const r of routes) { const m = h.match(r.re); if (m) return await r.fn(...m.slice(1).map(decodeURIComponent)); }
      navigate('#/home');
    } catch (e) { console.error(e); toast('حدث خطأ: ' + e.message, 'bad'); }
  }
  function renderSetup() {
    const folderOk = S.supportsFolder(); const pend = state.pendingHandle;
    document.body.classList.remove('print-mode');
    $('#app').innerHTML = `<div class="setup"><div class="setup-card"><img src="${window.LOGO_AWQAF || ''}" alt="أوقاف" class="setup-logo"><h1>سجل الأداء</h1><p class="muted">نظام تقييم أداء المقاولين والاستشاريين — الإدارة العامة للأوقاف</p>
      <h2>أين تُحفظ البيانات؟</h2>
      ${pend ? `<div class="note ok"><b>مجلد محفوظ:</b> ${esc(pend.name)} — يحتاج إذنك لإعادة فتحه. <button class="btn primary" data-act="resumeFolder">فتح المجلد</button></div>` : ''}
      <div class="choices">
        <div class="choice ${folderOk ? '' : 'disabled'}"><h3>📁 مجلد البيانات المشترك (موصى به)</h3><p>اختر مجلد البرنامج داخل دروب بوكس (المجلد الذي فيه هذا الملف). تُحفظ البيانات والمرفقات في مجلد <code>data</code> ويتشاركها الفريق تلقائياً عبر المزامنة.</p><button class="btn primary" data-act="pickFolder" ${folderOk ? '' : 'disabled'}>اختيار المجلد</button>${folderOk ? '' : '<p class="hint">يحتاج متصفح Chrome أو Edge على الحاسوب.</p>'}</div>
        <div class="choice"><h3>💾 المتصفح على هذا الجهاز</h3><p>تُحفظ البيانات داخل هذا المتصفح فقط، مع إمكانية التصدير والاستيراد يدوياً. مناسب للتجربة.</p><button class="btn" data-act="useLocal">المتابعة بهذا الجهاز</button></div>
      </div></div></div>`;
  }
  async function useFolder(h) { state.store = await new S.FolderStore(h).init(); state.data = await state.store.load(); localStorage.setItem('ev_mode', 'folder'); await afterStore(); }
  async function useLocal() { state.store = await new S.LocalStore().init(); state.data = await state.store.load(); localStorage.setItem('ev_mode', 'local'); await afterStore(); }
  async function afterStore() { await seedIfEmpty(); state.settings = Object.assign(clone(B.defaultSettings), state.data.settings); const id = sessionStorage.getItem('ev_user'); if (id) { const u = byId('users', id); if (u && u.active) state.user = u; } if (state.store.conflicts) toast(`تنبيه: ${state.store.conflicts} ملف متعارض في مجلد البيانات تم تجاهله`, 'warn'); render(); }
  async function useCloud(info) {
    state.store = await new S.CloudStore().init(); applyData(state.store.data);
    state.store.onUnauthorized = () => { if (!state.user) return; state.user = null; applyData(S.empty()); state.store.data = state.data; render(); };
    state.store.onRemoteChange = () => { const b = $('[data-act="reload"]'); if (b) { b.classList.add('has-updates'); b.title = 'أضاف الزملاء تعديلات جديدة — اضغط لتحميلها'; } };
    if (info && info.configured === false) { $('#app').innerHTML = `<div class="setup"><div class="setup-card"><h1>سجل الأداء</h1><div class="note bad">الخادم السحابي غير مهيأ بعد (مفتاح الجلسات أو التخزين). راجع مدير النظام.</div></div></div>`; return; }
    if (state.store.token) { try { await state.store.load(); applyData(state.store.data); state.user = byId('users', state.store.me) || null; } catch (e) { if (e.status !== 401) toast(e.message, 'bad'); } }
    render();
  }
  async function reload() { if (!state.store) return; if (isCloud()) { await state.store.load(); applyData(state.store.data); if (state.user) { const u = byId('users', state.user.id); if (!u || !u.active) return logout(); state.user = u; } render(); toast('تم تحديث البيانات'); return; } state.data = await state.store.load(); state.settings = Object.assign(clone(B.defaultSettings), state.data.settings); if (state.user) state.user = byId('users', state.user.id) || state.user; render(); toast('تم تحديث البيانات'); }

  actions.pickFolder = async () => { try { const h = await S.pickFolder(); await useFolder(h); } catch (e) { if (e.name !== 'AbortError') toast('تعذر فتح المجلد: ' + e.message, 'bad'); } };
  actions.resumeFolder = async () => { const h = state.pendingHandle; if (!h) return; if (await S.ensurePermission(h, true)) await useFolder(h); else toast('لم يُمنح الإذن', 'warn'); };
  actions.useLocal = () => useLocal();
  actions.reload = () => reload();
  actions.logout = () => logout();
  actions.back = () => history.back();
  actions.print = () => window.print();
  actions.nav = el => navigate(el.dataset.to);

  /* بعد رفض الخادم لتعديل (تعارض أو صلاحية) تُعاد البيانات من الخادم حتى لا تبقى الشاشة على حالة لم تُحفظ */
  function resync(err) { if (isCloud() && state.user && err && (err.status === 409 || err.status === 403)) setTimeout(() => reload().catch(() => { }), 600); }
  function bind() {
    document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el || el.disabled) return; const fn = actions[el.dataset.act]; if (fn) { e.preventDefault(); Promise.resolve(fn(el, e)).catch(err => { console.error(err); toast('خطأ: ' + err.message, 'bad'); resync(err); }); } });
    document.addEventListener('submit', e => { const f = e.target.closest('form[data-form]'); if (!f) return; e.preventDefault(); const fn = forms[f.dataset.form]; if (fn) Promise.resolve(fn(f, formData(f))).catch(err => { console.error(err); toast('خطأ: ' + err.message, 'bad'); resync(err); }); });
    document.addEventListener('change', e => { const el = e.target.closest('[data-change]'); if (!el) return; if (el.dataset.change === 'orientation') { setOrientation(el.value); return; } const fn = actions['change:' + el.dataset.change]; if (fn) Promise.resolve(fn(el, e)).catch(err => { toast('خطأ: ' + err.message, 'bad'); resync(err); }); });
    document.addEventListener('input', e => { const el = e.target.closest('[data-input]'); if (!el) return; const fn = actions['input:' + el.dataset.input]; if (fn) fn(el, e); });
    window.addEventListener('hashchange', render);
    document.addEventListener('error', e => { const t = e.target; if (t && t.tagName === 'IMG' && t.hasAttribute('data-bg-fallback')) { const bg = t.closest('.bg'); if (bg) bg.classList.add('nobg'); } }, true);
  }
  async function boot() {
    bind(); state.settings = clone(B.defaultSettings);
    const cloud = await S.detectCloud(); if (cloud) { await useCloud(cloud); return; }
    const mode = localStorage.getItem('ev_mode');
    if (S.supportsFolder() && mode !== 'local') { const h = await S.savedFolder(); if (h) { if (await S.ensurePermission(h, false)) { try { await useFolder(h); return; } catch (e) { console.warn(e); } } state.pendingHandle = h; } }
    if (mode === 'local') { await useLocal(); return; }
    render();
  }

  /* فتح المرفق: الصور وPDF والنص تُعرض، وما عداها يُنزَّل فقط حتى لا يُنفَّذ محتوى نشط داخل البرنامج */
  async function openStoredFile(path, name) {
    const blob = await state.store.fileBlob(path); if (!blob) throw new Error('تعذر فتح الملف');
    const safe = /^(image\/(png|jpe?g|gif|webp|bmp)|application\/pdf|text\/plain)$/i.test(blob.type);
    const obj = URL.createObjectURL(new Blob([blob], { type: safe ? blob.type : 'application/octet-stream' }));
    if (safe) window.open(obj, '_blank', 'noopener'); else { const a = document.createElement('a'); a.href = obj; a.download = name || path.split('/').pop().replace(/^([0-9a-f]{8}|notice)__/, ''); document.body.appendChild(a); a.click(); a.remove(); }
    setTimeout(() => URL.revokeObjectURL(obj), 120000);
  }
  return { state, routes, actions, forms, route, navigate, render, page, printPage, setOrientation, boot, reload, useLocal, $, esc, safeHtml, uid, clone, nowISO, today, fmtDate, fmtDateTime, fmtNum, fmtMoney, addDays, sha256, hashPassword, can, isManager, isApprover, isAdmin, canEvaluate, canViewAll, byId, list, save, remove, audit, userName, companyName, projectName, login, logout, setPassword, isCloud, openStoredFile, activeTemplate, templateFor, weightsFor, ratingFor, compute, consolidate, companyScores, suggestedConsequence, isSmallContract, toast, modal, confirm, badge, ratingBadge, field, opts, formData, L, B, screens: {} };
})();
