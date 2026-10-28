/* محرك تخزين محلي للاختبار يحاكي دلالات Vercel Blob: ETag، والكتابة المشروطة ifMatch، والإنشاء فقط create. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export function fsStore(root, opts = {}) {
  let lock = Promise.resolve();
  const withLock = fn => { const p = lock.then(fn, fn); lock = p.catch(() => { }); return p; };
  const file = p => { if (p.includes('..')) throw new Error('bad path'); return path.join(root, ...p.split('/')); };
  const etagOf = buf => '"' + createHash('sha1').update(buf).digest('hex') + '"';
  const wait = () => (opts.latency ? new Promise(r => setTimeout(r, opts.latency)) : null);
  const stats = { read: 0, write: 0, del: 0, copy: 0 };
  return {
    ready: true, stats,
    async read(p, o = {}) {
      stats.read++; await wait(); let buf;
      try { buf = await fs.readFile(file(p)); } catch (e) { if (e.code === 'ENOENT') return { status: 404 }; throw e; }
      const etag = etagOf(buf); if (o.ifNoneMatch && o.ifNoneMatch === etag) return { status: 304, etag };
      let ct = 'application/octet-stream'; try { ct = (await fs.readFile(file(p) + '.ct', 'utf8')) || ct; } catch (e) { }
      return { status: 200, etag, body: buf, contentType: ct };
    },
    async write(p, body, o = {}) {
      stats.write++; await wait();
      return withLock(async () => {
        const f = file(p); let cur = null; try { cur = await fs.readFile(f); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (o.create && cur) throw new Error('This blob already exists');
        if (o.ifMatch && (!cur || etagOf(cur) !== o.ifMatch)) { const e = new Error('precondition'); e.code = 'precondition'; throw e; }
        await fs.mkdir(path.dirname(f), { recursive: true }); const tmp = f + '.tmp' + process.pid + Math.random().toString(36).slice(2);
        const buf = Buffer.isBuffer(body) ? body : Buffer.from(body); await fs.writeFile(tmp, buf); await fs.rename(tmp, f);
        if (o.contentType) await fs.writeFile(f + '.ct', o.contentType);
        return etagOf(buf);
      });
    },
    async del(p) { stats.del++; for (const x of [file(p), file(p) + '.ct']) { try { await fs.unlink(x); } catch (e) { } } },
    async copy(a, b) { stats.copy++; const buf = await fs.readFile(file(a)); await fs.mkdir(path.dirname(file(b)), { recursive: true }); await fs.writeFile(file(b), buf); },
  };
}
