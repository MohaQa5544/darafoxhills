/* طبقة التخزين — سجل الأداء
   FolderStore: ملفات JSON داخل مجلد البيانات (data/) عبر File System Access API — مناسب لمجلد دروب بوكس المشترك.
   LocalStore : localStorage في المتصفح على هذا الجهاز (احتياطي). */
window.EV_STORE = (function () {
  const COLLS = ['users', 'companies', 'projects', 'contracts', 'templates', 'cycles', 'evaluations', 'letters', 'attachments'];
  const empty = () => ({ users: [], companies: [], projects: [], contracts: [], templates: [], cycles: [], evaluations: [], letters: [], attachments: [], settings: null, audit: [] });
  const upsert = (arr, rec) => { const i = arr.findIndex(r => r.id === rec.id); if (i >= 0) arr[i] = rec; else arr.push(rec); };
  const toDataURL = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });

  /* IndexedDB لحفظ مقبض المجلد بين الجلسات */
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open('ev_store', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbGet(k) { try { const db = await idb(); return await new Promise((res, rej) => { const t = db.transaction('kv', 'readonly').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); } catch (e) { return undefined; } }
  async function idbSet(k, v) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').put(v, k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); } catch (e) { } }
  async function idbDel(k) { try { const db = await idb(); await new Promise((res, rej) => { const t = db.transaction('kv', 'readwrite').objectStore('kv').delete(k); t.onsuccess = () => res(); t.onerror = () => rej(t.error); }); } catch (e) { } }

  class LocalStore {
    constructor() { this.mode = 'local'; this.key = 'ev_db_v1'; this.data = empty(); this.files = {}; }
    async init() { try { const raw = localStorage.getItem(this.key); if (raw) { const d = JSON.parse(raw); this.files = d.files || {}; delete d.files; this.data = Object.assign(empty(), d); } } catch (e) { console.warn(e); } return this; }
    async load() { return this.data; }
    persist() { localStorage.setItem(this.key, JSON.stringify(Object.assign({}, this.data, { files: this.files }))); }
    async put(coll, rec) { upsert(this.data[coll], rec); this.persist(); }
    async remove(coll, id) { this.data[coll] = this.data[coll].filter(r => r.id !== id); this.persist(); }
    async putSettings(s) { this.data.settings = s; this.persist(); }
    async appendAudit(rec) { this.data.audit.push(rec); if (this.data.audit.length > 5000) this.data.audit.splice(0, this.data.audit.length - 5000); this.persist(); }
    async saveFile(path, file) { if (file.size > 2 * 1024 * 1024) throw new Error('في وضع المتصفح يُسمح بملفات حتى 2 ميجابايت فقط. استخدم مجلد البيانات المشترك للملفات الأكبر.'); this.files[path] = { data: await toDataURL(file), name: file.name, type: file.type }; this.persist(); }
    async fileURL(path) { const f = this.files[path]; return f ? f.data : null; }
    async fileBlob(path) { const f = this.files[path]; if (!f) return null; const m = /^data:([^;,]*)(;base64)?,(.*)$/.exec(f.data || ''); if (!m) return null; const raw = m[2] ? atob(m[3]) : decodeURIComponent(m[3]); const u = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i); return new Blob([u], { type: f.type || m[1] || 'application/octet-stream' }); }
    async deleteFile(path) { delete this.files[path]; this.persist(); }
    async exportAll() { return JSON.stringify(Object.assign({}, this.data, { files: this.files, exportedAt: new Date().toISOString() })); }
    async importAll(json) { const d = JSON.parse(json); this.files = d.files || {}; delete d.files; delete d.exportedAt; this.data = Object.assign(empty(), d); this.persist(); }
    describe() { return 'المتصفح على هذا الجهاز (بيانات غير مشتركة)'; }
  }

  class FolderStore {
    constructor(handle) { this.mode = 'folder'; this.root = handle; this.data = empty(); this.conflicts = 0; }
    async dir(name, create = true) { if (!this.dataDir) this.dataDir = await this.root.getDirectoryHandle('data', { create: true }); return name ? await this.dataDir.getDirectoryHandle(name, { create }) : this.dataDir; }
    async init() { await this.dir(); for (const c of COLLS) await this.dir(c); await this.dir('audit'); await this.dir('attachments'); return this; }
    async readJSON(dirH, name) { const fh = await dirH.getFileHandle(name); const f = await fh.getFile(); const t = await f.text(); return t ? JSON.parse(t) : null; }
    async writeJSON(dirH, name, obj) { const fh = await dirH.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(JSON.stringify(obj, null, 1)); await w.close(); }
    async load() {
      const data = empty(); this.conflicts = 0;
      for (const c of COLLS) {
        const d = await this.dir(c);
        for await (const [name, h] of d.entries()) {
          if (h.kind !== 'file' || !name.endsWith('.json')) continue;
          if (/conflicted copy|نسخة متعارضة|conflict/i.test(name)) { this.conflicts++; continue; }
          try { const rec = await this.readJSON(d, name); if (rec && rec.id) data[c].push(rec); } catch (e) { console.warn('ملف غير صالح', c, name, e); }
        }
      }
      try { data.settings = await this.readJSON(await this.dir(), 'settings.json'); } catch (e) { data.settings = null; }
      const ad = await this.dir('audit');
      for await (const [name, h] of ad.entries()) { if (h.kind !== 'file' || !name.endsWith('.json')) continue; try { const arr = await this.readJSON(ad, name); if (Array.isArray(arr)) data.audit.push(...arr); } catch (e) { } }
      data.audit.sort((a, b) => (a.at < b.at ? -1 : 1));
      this.data = data; return data;
    }
    async put(coll, rec) { await this.writeJSON(await this.dir(coll), rec.id + '.json', rec); upsert(this.data[coll], rec); }
    async remove(coll, id) { try { await (await this.dir(coll)).removeEntry(id + '.json'); } catch (e) { } this.data[coll] = this.data[coll].filter(r => r.id !== id); }
    async putSettings(s) { await this.writeJSON(await this.dir(), 'settings.json', s); this.data.settings = s; }
    async appendAudit(rec) { const name = `${rec.at.slice(0, 7)}__${rec.actorName || 'system'}.json`.replace(/[\\/:*?"<>|]/g, '_'); const ad = await this.dir('audit'); let arr = []; try { arr = (await this.readJSON(ad, name)) || []; } catch (e) { } arr.push(rec); await this.writeJSON(ad, name, arr); this.data.audit.push(rec); }
    async walk(path, create) { const parts = path.split('/').filter(Boolean); let d = await this.dir(parts[0], create); for (let i = 1; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i], { create }); return { dir: d, name: parts[parts.length - 1] }; }
    async saveFile(path, file) { const { dir, name } = await this.walk(path, true); const fh = await dir.getFileHandle(name, { create: true }); const w = await fh.createWritable(); await w.write(file); await w.close(); }
    async fileURL(path) { const b = await this.fileBlob(path); return b ? URL.createObjectURL(b) : null; }
    async fileBlob(path) { try { const { dir, name } = await this.walk(path, false); const fh = await dir.getFileHandle(name); return await fh.getFile(); } catch (e) { return null; } }
    async deleteFile(path) { try { const { dir, name } = await this.walk(path, false); await dir.removeEntry(name); } catch (e) { } }
    async exportAll() { return JSON.stringify(Object.assign({}, this.data, { exportedAt: new Date().toISOString() })); }
    async importAll(json) { const d = JSON.parse(json); for (const c of COLLS) for (const r of (d[c] || [])) await this.put(c, r); if (d.settings) await this.putSettings(d.settings); }
    describe() { return 'مجلد البيانات المشترك: ' + this.root.name + '\\data'; }
  }


  /* CloudStore: الخادم السحابي — بيانات مشتركة لكل الفريق، والدخول والصلاحيات على الخادم */
  class CloudStore {
    constructor(base) { this.mode = 'cloud'; this.base = base || 'api/'; this.data = empty(); this.token = null; try { this.token = sessionStorage.getItem('ev_token'); } catch (e) { } this.rev = 0; this.remoteChanged = false; this.q = Promise.resolve(); this.onUnauthorized = null; this.onRemoteChange = null; this.me = null; this.unacked = new Map(); }
    async init() { return this; }
    setToken(t) { this.token = t || null; try { if (t) sessionStorage.setItem('ev_token', t); else sessionStorage.removeItem('ev_token'); } catch (e) { } }
    /* كل طلب بمهلة: الطلب المعلّق لا يجمّد الواجهة. read يقرأ الرد داخل المهلة نفسها. */
    async req(path, init, ms, read) {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null; const timer = ctl ? setTimeout(() => ctl.abort(), ms || 30000) : null;
      try {
        const res = await fetch(this.base + path, Object.assign({ cache: 'no-store', credentials: 'same-origin' }, init, ctl ? { signal: ctl.signal } : {}));
        return read ? await read(res) : res;
      } catch (e) {
        if (e && e.status) throw e;
        const timeout = !!(ctl && ctl.signal.aborted);
        const err = new Error(timeout ? 'انتهت مهلة الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.' : 'تعذر الاتصال بالخادم. تحقق من اتصال الإنترنت ثم أعد المحاولة.'); err.network = true; err.timeout = timeout; throw err;
      } finally { if (timer) clearTimeout(timer); }
    }
    async fail(res, op) {
      let b = null; try { b = await res.json(); } catch (e) { }
      const err = new Error((b && b.error) || ('تعذر تنفيذ الطلب (' + res.status + ')')); err.status = res.status; err.code = b && b.code;
      if (b && 'current' in b) err.current = b.current; if (b && b.deleted) err.deleted = true;
      if (res.status === 401 && op !== 'login') { this.setToken(null); if (this.onUnauthorized) setTimeout(() => this.onUnauthorized(err), 0); }
      return err;
    }
    async call(op, payload, o) {
      o = o || {}; const headers = { 'content-type': o.type || 'application/json' }; if (this.token) headers.authorization = 'Bearer ' + this.token;
      return this.req('rpc', { method: 'POST', headers, body: o.body || JSON.stringify(Object.assign({ op }, payload || {})) }, o.ms, async res => {
        if (!res.ok) throw await this.fail(res, op);
        try { return (await res.json()) || {}; } catch (e) { const err = new Error('رد غير صالح من الخادم. أعد المحاولة.'); err.status = res.status; throw err; }
      });
    }
    serial(fn) { const p = this.q.then(fn, fn); this.q = p.catch(() => { }); return p; }
    /* تغيّر شيء من غيرنا إن لم تكن نسختنا السابقة هي أساس كتابتنا، أو كُتب معنا في الكتابة نفسها طلب من مستخدم آخر */
    track(r) { if (!r || typeof r.rev !== 'number') return; if ((typeof r.prevRev === 'number' && this.rev && r.prevRev !== this.rev) || r.others > 0) { this.remoteChanged = true; if (this.onRemoteChange) this.onRemoteChange(); } this.rev = r.rev; }
    applyData(r) { this.data = Object.assign(empty(), r.data || {}); this.rev = r.rev || 0; this.remoteChanged = false; this.me = r.me || this.me; return this.data; }
    async login(username, password) { const r = await this.call('login', { username, password }); this.setToken(r.token); this.applyData(r); return r; }
    load() { return this.serial(async () => { if (!this.token) { const e = new Error('no session'); e.status = 401; throw e; } const r = await this.call('load'); this.applyData(r); return this.data; }); }
    logout() { if (this.token) this.call('audit', { entry: { action: 'logout', entity: 'users' } }).catch(() => { }); this.setToken(null); this.data = empty(); this.me = null; this.rev = 0; this.unacked.clear(); }
    /* طلب انقطع رده (شبكة أو خطأ خادم) ربما وصل فعلاً. إن رد الخادم بتعارض نسخته الحالية هي ما أرسلناه نحن، فهو طلبنا: نكمل فوقه بدل إظهار تعارض وهمي. */
    noteUnacked(key, at, e) { if (at && e && (e.network || e.status >= 500)) { const s = this.unacked.get(key) || new Set(); s.add(at); this.unacked.set(key, s); } }
    putRecord(coll, rec, o) {
      o = o || {};
      return this.serial(async () => {
        const key = coll + '/' + rec.id; const send = base => this.call('put', { coll, rec, base: base || null, audit: o.audit || null });
        let r;
        try { r = await send(o.base); }
        catch (e) {
          const mine = this.unacked.get(key);
          if (!(e.status === 409 && e.current && mine && mine.has(e.current))) { this.noteUnacked(key, rec.updatedAt, e); throw e; }
          try { r = await send(e.current); } catch (e2) { this.noteUnacked(key, rec.updatedAt, e2); throw e2; }
        }
        this.unacked.delete(key);
        if (r.patch && typeof r.patch === 'object') Object.assign(rec, r.patch);          // ما يحدده الخادم (رقم الخطاب مثلاً)
        upsert(this.data[coll], rec); this.track(r); return r;
      });
    }
    put(coll, rec) { return this.putRecord(coll, rec, {}); }
    remove(coll, id, o) { o = o || {}; return this.serial(async () => { const r = await this.call('remove', { coll, id, audit: o.audit || null }); this.data[coll] = this.data[coll].filter(x => x.id !== id); this.track(r); return r; }); }
    putSettings(s) { return this.serial(async () => { const r = await this.call('settings', { settings: s }); this.data.settings = s; this.track(r); }); }
    appendAudit(rec) { if (rec.action !== 'logout') return Promise.resolve(); return this.serial(() => this.call('audit', { entry: { action: rec.action, entity: rec.entity, entityId: rec.entityId, detail: rec.detail } }).catch(() => { })); }
    async changePassword(next, current) { const r = await this.serial(() => this.call('password', { next, current })); this.setToken(r.token); this.track(r); return r; }
    createUser(u) { return this.serial(async () => { const r = await this.call('userCreate', { user: u }); upsert(this.data.users, r.user); this.track(r); return r; }); }
    resetPassword(id) { return this.serial(async () => { const r = await this.call('userReset', { id }); const u = this.data.users.find(x => x.id === id); if (u) u.mustChange = true; this.track(r); return r; }); }
    saveFile(path, file) {
      if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error('حجم الملف «' + file.name + '» أكبر من 4 ميجابايت. اضغطه أو قسّمه ثم أعد الإرفاق.'));
      return this.serial(() => this.req('file?path=' + encodeURIComponent(path), { method: 'POST', headers: { authorization: 'Bearer ' + this.token, 'content-type': file.type || 'application/octet-stream' }, body: file }, 180000, async res => { if (!res.ok) throw await this.fail(res, 'file'); }));
    }
    fileBlob(path) { return this.req('file?path=' + encodeURIComponent(path), { headers: { authorization: 'Bearer ' + this.token } }, 120000, async res => { if (!res.ok) { if (res.status === 401) await this.fail(res, 'file'); return null; } return await res.blob(); }); }
    async fileURL(path) { const b = await this.fileBlob(path); return b ? URL.createObjectURL(b) : null; }
    deleteFile(path) { return this.serial(() => this.req('file?path=' + encodeURIComponent(path), { method: 'DELETE', headers: { authorization: 'Bearer ' + this.token } }, 30000, async res => { if (!res.ok && res.status !== 404) throw await this.fail(res, 'file'); })); }
    async exportAll() { const r = await this.call('export', null, { ms: 120000 }); return r.json; }
    /* الاستعادة تُرسل مضغوطة (gzip) فتتسع لنسخ أكبر بكثير من حد 4 ميجابايت للطلب الواحد */
    async importAll(json) {
      let payload; try { payload = JSON.parse(json); } catch (e) { throw new Error('ملف النسخة غير صالح (JSON).'); }
      let files = 0; if (payload && payload.files) { files = Object.keys(payload.files).length; delete payload.files; }
      const text = JSON.stringify({ op: 'import', payload }); let r;
      if (typeof CompressionStream === 'function') {
        const gz = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
        if (gz.byteLength > 4 * 1024 * 1024) throw new Error('ملف النسخة كبير جداً حتى بعد الضغط (أكثر من 4 ميجابايت).');
        r = await this.serial(() => this.call('import', null, { body: gz, type: 'application/gzip', ms: 180000 }));
      } else {
        if (text.length > 4 * 1024 * 1024) throw new Error('ملف النسخة كبير؛ استخدم متصفحاً حديثاً (Chrome أو Edge) لاستعادته.');
        r = await this.serial(() => this.call('import', { payload }, { ms: 180000 }));
      }
      if (r.token) this.setToken(r.token); if (files) r.files = files; return r;
    }
    describe() { return 'الخادم السحابي — بيانات مشتركة لكل الفريق'; }
  }

  async function detectCloud(base) {
    if (!/^https?:$/.test(location.protocol)) return false;
    try { const ctl = typeof AbortController === 'function' ? new AbortController() : null; const t = setTimeout(() => { if (ctl) ctl.abort(); }, 6000); const res = await fetch((base || 'api/') + 'health', { cache: 'no-store', signal: ctl ? ctl.signal : undefined }); clearTimeout(t); if (!res.ok) return false; const j = await res.json(); return j && j.app === 'sijil-alada' ? j : false; } catch (e) { return false; }
  }

  const supportsFolder = () => typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
  async function pickFolder() { const h = await window.showDirectoryPicker({ mode: 'readwrite' }); await idbSet('dirHandle', h); return h; }
  const savedFolder = () => idbGet('dirHandle');
  async function ensurePermission(h, ask) { try { if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true; if (ask) return (await h.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { } return false; }
  return { COLLS, empty, LocalStore, FolderStore, CloudStore, detectCloud, supportsFolder, pickFolder, savedFolder, ensurePermission, forgetFolder: () => idbDel('dirHandle'), toDataURL };
})();
