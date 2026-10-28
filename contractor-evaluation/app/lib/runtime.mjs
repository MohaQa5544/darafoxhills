/* تهيئة الخادم مرة واحدة لكل نسخة دافئة من الدالة: المفاتيح من متغيرات البيئة، وبنك الأسئلة من bank.js نفسه الذي تستخدمه الواجهة. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Server } from './core.mjs';
import { blobStore } from './blob-store.mjs';

let server = null;
export function loadBank(src) { const sandbox = { window: {} }; vm.runInNewContext(src, sandbox, { timeout: 2000 }); return JSON.parse(JSON.stringify(sandbox.window.EV_BANK)); }
export function getServer() {
  if (server) return server;
  let bank = null; try { bank = loadBank(readFileSync(new URL('../bank.js', import.meta.url), 'utf8')); } catch (e) { console.error('bank.js load failed', e && e.message); }
  let seed = []; try { seed = JSON.parse(process.env.SEED_USERS || '[]'); } catch (e) { console.error('SEED_USERS is not valid JSON'); }
  server = new Server({ store: blobStore(), secret: process.env.SESSION_SECRET || '', seedUsers: seed, bank, log: (...a) => console.error(...a) });
  return server;
}
