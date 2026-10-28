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
    async fileURL(path) { try { const { dir, name } = await this.walk(path, false); const fh = await dir.getFileHandle(name); return URL.createObjectURL(await fh.getFile()); } catch (e) { return null; } }
    async deleteFile(path) { try { const { dir, name } = await this.walk(path, false); await dir.removeEntry(name); } catch (e) { } }
    async exportAll() { return JSON.stringify(Object.assign({}, this.data, { exportedAt: new Date().toISOString() })); }
    async importAll(json) { const d = JSON.parse(json); for (const c of COLLS) for (const r of (d[c] || [])) await this.put(c, r); if (d.settings) await this.putSettings(d.settings); }
    describe() { return 'مجلد البيانات المشترك: ' + this.root.name + '\\data'; }
  }

  const supportsFolder = () => typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
  async function pickFolder() { const h = await window.showDirectoryPicker({ mode: 'readwrite' }); await idbSet('dirHandle', h); return h; }
  const savedFolder = () => idbGet('dirHandle');
  async function ensurePermission(h, ask) { try { if ((await h.queryPermission({ mode: 'readwrite' })) === 'granted') return true; if (ask) return (await h.requestPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { } return false; }
  return { COLLS, LocalStore, FolderStore, supportsFolder, pickFolder, savedFolder, ensurePermission, forgetFolder: () => idbDel('dirHandle'), toDataURL };
})();
