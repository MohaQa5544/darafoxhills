/* تهيئة الخادم مرة واحدة لكل نسخة دافئة من الدالة: المفاتيح من متغيرات البيئة، وبنك الأسئلة من bank.js نفسه الذي تستخدمه الواجهة. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Server } from './core.mjs';
import { blobStore } from './blob-store.mjs';

/* إعادة محاولة مكتبة Blob الافتراضية (10 مرات بتأخير متزايد) تتجاوز مهلة الدالة؛ مرتان تكفيان والخادم يعيد المحاولة بنفسه */
if (!process.env.VERCEL_BLOB_RETRIES) process.env.VERCEL_BLOB_RETRIES = '2';
/* بيانات الإنتاج تحت ev/، وأي بيئة أخرى (معاينة أو تطوير) تحت بادئة منفصلة فلا تمس بيانات الإنتاج حتى لو أُعطيت المفاتيح نفسها */
export function dataPrefix(env) { env = String(env || 'production').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'production'; return env === 'production' ? 'ev/' : 'ev-' + env + '/'; }
let server = null;
export function loadBank(src) { const sandbox = { window: {} }; vm.runInNewContext(src, sandbox, { timeout: 2000 }); return JSON.parse(JSON.stringify(sandbox.window.EV_BANK)); }
export function getServer() {
  if (server) return server;
  let bank = null; try { bank = loadBank(readFileSync(new URL('../bank.js', import.meta.url), 'utf8')); } catch (e) { console.error('bank.js load failed', e && e.message); }
  let seed = []; try { seed = JSON.parse(process.env.SEED_USERS || '[]'); } catch (e) { console.error('SEED_USERS is not valid JSON'); }
  server = new Server({ store: blobStore(), secret: process.env.SESSION_SECRET || '', seedUsers: seed, bank, prefix: dataPrefix(process.env.VERCEL_ENV), log: (...a) => console.error(...a) });
  return server;
}
