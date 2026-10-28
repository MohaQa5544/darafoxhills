/* خادم تطوير واختبار محلي: يقدّم ملفات app/ كما يقدّمها Vercel (مع رؤوس vercel.json) ويوجّه /api/* إلى منطق الخادم نفسه
   مع محرك تخزين محلي. الاستخدام:
   node dev/server.mjs --port 8787 --data /tmp/ev-data --seed dev/seed.example.json [--instances 2] [--latency 20] [--reset]
   [--audit-keep N] [--cache-ms N] [--write-limit N] [--upload-limit N] [--prefix ev-test/] */
import http from 'node:http';
import { readFileSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Server, hashPassword, LIMITS } from '../app/lib/core.mjs';
import { loadBank } from '../app/lib/runtime.mjs';
import { fsStore } from './fs-store.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)); const appDir = path.resolve(here, '../app');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) : d; };
const port = Number(arg('port', 8787)), dataDir = path.resolve(String(arg('data', path.join(here, '.data')))), instances = Number(arg('instances', 1)), latency = Number(arg('latency', 0));
if (arg('reset', false)) await fs.rm(dataDir, { recursive: true, force: true });
if (arg('audit-keep', false)) { LIMITS.auditKeep = Number(arg('audit-keep')); LIMITS.auditChunk = Math.max(1, Math.floor(LIMITS.auditKeep / 2)); }
if (arg('cache-ms', false)) LIMITS.cacheMs = Number(arg('cache-ms'));
if (arg('write-limit', false)) LIMITS.writesPer5Min = Number(arg('write-limit'));
if (arg('upload-limit', false)) LIMITS.uploadsPer10Min = Number(arg('upload-limit'));
await fs.mkdir(dataDir, { recursive: true });
const seedFile = arg('seed', path.join(here, 'seed.example.json'));
const seed = []; for (const s of JSON.parse(readFileSync(seedFile, 'utf8'))) { const h = await hashPassword(s.password); const x = Object.assign({}, s, h); delete x.password; seed.push(x); }
const store = fsStore(dataDir, { latency }); const bank = loadBank(readFileSync(path.join(appDir, 'bank.js'), 'utf8'));
const secret = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const prefix = String(arg('prefix', 'ev/'));
const servers = Array.from({ length: instances }, () => new Server({ store, secret, seedUsers: seed, bank, prefix, log: (...a) => console.error('[server]', ...a) }));
let rr = 0;
const vj = JSON.parse(readFileSync(path.join(appDir, 'vercel.json'), 'utf8'));
const toRe = src => new RegExp('^' + src.split('(.*)').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*)') + '$');
const rules = (vj.headers || []).map(h => ({ re: toRe(h.source), headers: h.headers }));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const applyRules = (res, p) => { for (const r of rules) if (r.re.test(p)) for (const h of r.headers) res.setHeader(h.key, h.value); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost'); const p = decodeURIComponent(url.pathname);
  try {
    if (p.startsWith('/api/')) {
      const name = p.slice(5); const srv = servers[rr++ % servers.length];
      const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const request = new Request('http://localhost' + req.url, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const out = name === 'rpc' ? await srv.rpc(request) : name === 'file' ? await srv.file(request) : name === 'health' ? srv.health() : new Response('{"error":"not found"}', { status: 404 });
      res.statusCode = out.status; out.headers.forEach((v, k) => res.setHeader(k, v)); applyRules(res, p);
      res.end(Buffer.from(await out.arrayBuffer())); return;
    }
    let f = path.join(appDir, p === '/' ? 'index.html' : p); if (!f.startsWith(appDir) || f.includes(path.sep + 'api' + path.sep) || /\.local\./.test(f)) { res.statusCode = 404; res.end('not found'); return; }
    const buf = await fs.readFile(f); res.setHeader('content-type', MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'); applyRules(res, p); res.end(buf);
  } catch (e) { if (e.code === 'ENOENT') { res.statusCode = 404; res.end('not found'); } else { console.error(e); res.statusCode = 500; res.end('error'); } }
}).listen(port, () => console.log(`dev server http://localhost:${port}  data=${dataDir}  instances=${instances}`));
export { store };
