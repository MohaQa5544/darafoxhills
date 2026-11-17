/* طبقة التخزين — برنامج المتابعة
   FolderStore: ملفات JSON داخل data/ في مجلد البرنامج (مجلد دروب بوكس المشترك) عبر File System Access API.
   LocalStore : localStorage في المتصفح على هذا الجهاز (للتجربة). */
window.FU_STORE = (function () {
  const COLLS = ['users', 'depts', 'letters', 'tasks', 'updates'];
  const empty = () => ({ users: [], depts: [], letters: [], tasks: [], updates: [], settings: null, audit: [] });
  const upsert = (arr, rec) => { const i = arr.findIndex(r => r.id === rec.id); if (i >= 0) arr[i] = rec; else arr.push(rec); };
  const toDataURL = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  const isConflictName = n => /conflicted copy|نسخة متعارضة|conflict/i.test(n);
  const stale = msg => { const e = new Error(msg); e.status = 409; return e; };

  /* IndexedDB لحفظ مقبض المجلد بين الجلسات */
  function idb() { return new Promise((res, rej) => { const r = indexedDB.open('fu_store', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
  async function idbDo(mode, fn) { try { const db = await idb(); return await new Promise((res, rej) => { const t = fn(db.transaction('kv', mode).objectStore('kv')); t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error); }); } catch (e) { return undefined; } }

  class LocalStore {
    constructor() { this.mode = 'local'; this.key = 'fu_db_v1'; this.data = empty(); this.files = {}; this.conflicts = 0; }
    async init() {
      this.data = empty(); this.files = {};
      try { const raw = localStorage.getItem(this.key); if (raw) { const d = JSON.parse(raw); this.files = d.files || {}; delete d.files; this.data = Object.assign(empty(), d); } } catch (e) { console.warn(e); }
      return this;
    }
    async load() { await this.init(); return this.data; }
    /* إن رفض المتصفح الحفظ (امتلاء المساحة) تُعاد الذاكرة إلى آخر ما حُفظ فعلاً */
    async commit(change) {
      change();
      try { localStorage.setItem(this.key, JSON.stringify(Object.assign({}, this.data, { files: this.files }))); }
      catch (e) { await this.init(); throw new Error(/quota/i.test((e && (e.name + ' ' + e.message)) || '') ? 'امتلأت مساحة المتصفح، فلم يُحفظ التعديل. استخدم مجلد البيانات المشترك.' : 'تعذر الحفظ في المتصفح: ' + (e && e.message)); }
    }
    async put(coll, rec) { await this.commit(() => upsert(this.data[coll], rec)); }
    async remove(coll, id) { await this.commit(() => { this.data[coll] = this.data[coll].filter(r => r.id !== id); }); }
    async putSettings(s) { await this.commit(() => { this.data.settings = s; }); }
    async appendAudit(rec) { await this.commit(() => { const a = this.data.audit; a.push(rec); if (a.length > 3000) a.splice(0, a.length - 3000); }); }
    async saveFile(path, file) {
      if (file.size > 2 * 1024 * 1024) throw new Error('في وضع المتصفح يُسمح بملفات حتى 2 ميجابايت فقط. استخدم مجلد البيانات المشترك للملفات الأكبر.');
      const f = { data: await toDataURL(file), name: file.name, type: file.type }; await this.commit(() => { this.files[path] = f; });
    }
    async fileBlob(path) { const f = this.files[path]; if (!f) return null; return await (await fetch(f.data)).blob(); }
    async deleteFile(path) { if (this.files[path]) await this.commit(() => { delete this.files[path]; }); }
    async scan() { return null; }
    async exportAll() { return JSON.stringify(Object.assign({ app: 'followup', exportedAt: new Date().toISOString() }, this.data, { files: this.files })); }
    /* الاستيراد دمج: السجل بالمعرّف نفسه يُستبدل، وما سواه يبقى */
    async importAll(d) {
      await this.commit(() => {
        for (const c of COLLS) for (const r of (Array.isArray(d[c]) ? d[c] : [])) if (r && r.id) upsert(this.data[c], r);
        if (d.settings) this.data.settings = d.settings;
        if (d.files && typeof d.files === 'object') Object.assign(this.files, d.files);
      });
    }
    describe() { return 'المتصفح على هذا الجهاز (بيانات غير مشتركة)'; }
  }

  class FolderStore {
    constructor(handle) { this.mode = 'folder'; this.root = handle; this.data = empty(); this.conflicts = 0; this.dirs = {}; }
    async dir(name) {
      if (!this.dataDir) this.dataDir = await this.root.getDirectoryHandle('data', { create: true });
      if (!name) return this.dataDir;
      return this.dirs[name] || (this.dirs[name] = await this.dataDir.getDirectoryHandle(name, { create: true }));
    }
    async init() { for (const c of COLLS.concat(['audit', 'files'])) await this.dir(c); return this; }
    async readJSON(d, name) { const f = await (await d.getFileHandle(name)).getFile(); const t = await f.text(); return t ? JSON.parse(t) : null; }
    async writeJSON(d, name, obj) { const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(JSON.stringify(obj, null, 1)); await w.close(); }
    async names(d) { const out = []; for await (const [name, h] of d.entries()) if (h.kind === 'file' && name.endsWith('.json')) out.push(name); return out; }
    async load() {
      const data = empty(); let conflicts = 0;
      for (const c of COLLS) {
        const d = await this.dir(c);
        const names = (await this.names(d)).filter(n => { if (isConflictName(n)) { conflicts++; return false; } return true; });
        const recs = await Promise.all(names.map(n => this.readJSON(d, n).catch(e => { console.warn('ملف غير صالح', c, n, e); return null; })));
        for (const r of recs) if (r && r.id) data[c].push(r);
      }
      try { data.settings = await this.readJSON(await this.dir(), 'settings.json'); } catch (e) { data.settings = null; }
      const ad = await this.dir('audit');
      for (const n of await this.names(ad)) { if (isConflictName(n)) continue; try { const arr = await this.readJSON(ad, n); if (Array.isArray(arr)) data.audit.push(...arr); } catch (e) { } }
      data.audit.sort((a, b) => (a.at < b.at ? -1 : 1));
      this.data = data; this.conflicts = conflicts; return data;
    }
    /* قبل الكتابة يُقرأ الملف من القرص: إن غيّره زميل بعد آخر تحميل (أو حذفه) يُرفض الحفظ بدل الكتابة فوق عمله.
       base = قيمة updatedAt التي بُني عليها التعديل؛ undefined تعني الكتابة دون فحص (الاستيراد). */
    async put(coll, rec, base) {
      const d = await this.dir(coll), name = rec.id + '.json';
      if (base !== undefined) {
        let cur = null; try { cur = await this.readJSON(d, name); } catch (e) { }
        if (cur && (cur.updatedAt || null) !== (base || null)) throw stale('عدّل زميل هذا السجل قبل لحظات. حُمّلت أحدث نسخة؛ راجعها ثم أعد المحاولة.');
        if (!cur && base) throw stale('حذف زميل هذا السجل. حُمّلت أحدث البيانات.');
      }
      await this.writeJSON(d, name, rec); upsert(this.data[coll], rec);
    }
    async remove(coll, id) { try { await (await this.dir(coll)).removeEntry(id + '.json'); } catch (e) { } this.data[coll] = this.data[coll].filter(r => r.id !== id); }
    async putSettings(s) { await this.writeJSON(await this.dir(), 'settings.json', s); this.data.settings = s; }
    /* ملف تدقيق لكل مستخدم في كل شهر، فلا تتعارض كتابات الزملاء */
    async appendAudit(rec) {
      const name = (rec.at.slice(0, 7) + '__' + (rec.actorName || 'system') + '.json').replace(/[\\/:*?"<>|]/g, '_');
      const ad = await this.dir('audit'); let arr = []; try { arr = (await this.readJSON(ad, name)) || []; } catch (e) { }
      arr.push(rec); await this.writeJSON(ad, name, arr); this.data.audit.push(rec);
    }
    async walk(path, create) {
      const parts = path.split('/').filter(Boolean); let d = await this.dir('files');
      for (let i = 0; i < parts.length - 1; i++) d = await d.getDirectoryHandle(parts[i], { create });
      return { d, name: parts[parts.length - 1] };
    }
    async saveFile(path, file) { const { d, name } = await this.walk(path, true); const w = await (await d.getFileHandle(name, { create: true })).createWritable(); await w.write(file); await w.close(); }
    async fileBlob(path) { try { const { d, name } = await this.walk(path, false); return await (await d.getFileHandle(name)).getFile(); } catch (e) { return null; } }
    async deleteFile(path) { try { const { d, name } = await this.walk(path, false); await d.removeEntry(name); } catch (e) { } }
    /* بصمة سريعة لمحتوى المجلد (عدد الملفات وأحدث تعديل) لاكتشاف ما أضافه الزملاء دون قراءة كل شيء */
    async scan() {
      let n = 0, max = 0;
      for (const c of COLLS) {
        const d = await this.dir(c);
        for await (const [name, h] of d.entries()) {
          if (h.kind !== 'file' || !name.endsWith('.json') || isConflictName(name)) continue;
          const f = await h.getFile(); n++; if (f.lastModified > max) max = f.lastModified;
        }
      }
      try { const f = await (await (await this.dir()).getFileHandle('settings.json')).getFile(); if (f.lastModified > max) max = f.lastModified; } catch (e) { }
      return n + ':' + max;
    }
    async exportAll() { return JSON.stringify(Object.assign({ app: 'followup', exportedAt: new Date().toISOString() }, this.data)); }
    async importAll(d) {
      for (const c of COLLS) for (const r of (Array.isArray(d[c]) ? d[c] : [])) if (r && r.id) await this.put(c, r);
      if (d.settings) await this.putSettings(d.settings);
    }
    describe() { return 'مجلد البيانات المشترك: ' + this.root.name + '\\data'; }
  }

  const supportsFolder = () => typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
  async function pickFolder() { const h = await window.showDirectoryPicker({ mode: 'readwrite' }); await idbDo('readwrite', s => s.put(h, 'dirHandle')); return h; }
  const savedFolder = () => idbDo('readonly', s => s.get('dirHandle'));
  const forgetFolder = () => idbDo('readwrite', s => s.delete('dirHandle'));
  async function ensurePermission(h, ask) {
    try { if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true; if (ask) return (await h.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { }
    return false;
  }
  return { COLLS, empty, LocalStore, FolderStore, supportsFolder, pickFolder, savedFolder, forgetFolder, ensurePermission };
})();
