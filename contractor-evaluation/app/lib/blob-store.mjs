/* محرك التخزين على Vercel Blob (متجر خاص private): قراءة مباشرة من المصدر دون ذاكرة CDN، وكتابة مشروطة بـ ETag.
   أخطاء المنصة تُحوَّل إلى رموز يفهمها الخادم (precondition / suspended / store_denied / rate_limited / store_missing / unavailable). */
import { put, get, del, copy, list, BlobPreconditionFailedError, BlobNotFoundError, BlobStoreSuspendedError, BlobServiceRateLimited, BlobStoreNotFoundError, BlobServiceNotAvailable, BlobAccessError } from '@vercel/blob';

const coded = (code, cause) => { const e = new Error(code); e.code = code; if (cause) e.cause = cause; return e; };
function mapError(e) {
  if (e instanceof BlobPreconditionFailedError) return coded('precondition', e);
  if (e instanceof BlobStoreSuspendedError) return coded('suspended', e);
  if (e instanceof BlobServiceRateLimited) return coded('rate_limited', e);
  if (e instanceof BlobStoreNotFoundError) return coded('store_missing', e);
  if (e instanceof BlobServiceNotAvailable) return coded('unavailable', e);
  if (e instanceof BlobAccessError) return coded('store_denied', e);
  const m = /Failed to fetch blob: (\d{3})/.exec((e && e.message) || '');           // get() يقرأ من رابط المتجر مباشرة ولا يصنّف أخطاءه
  const st = m ? Number(m[1]) : 0;
  if (st === 429) return coded('rate_limited', e);
  if (st === 401 || st === 403) return coded('store_denied', e);
  if (st >= 500) return coded('unavailable', e);
  return e;
}
const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { throw mapError(e); } };

export function blobStore() {
  const ready = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
  return {
    ready,
    read: guard(async (path, o = {}) => {
      const r = await get(path, Object.assign({ access: 'private', useCache: false }, o.ifNoneMatch ? { ifNoneMatch: o.ifNoneMatch } : {}));
      if (!r) return { status: 404 };
      if (r.statusCode === 304) return { status: 304, etag: r.blob.etag };
      const body = Buffer.from(await new Response(r.stream).arrayBuffer());
      return { status: 200, etag: r.blob.etag, body, contentType: r.blob.contentType };
    }),
    /* create: لا يكتب فوق ملف موجود. ifMatch: لا يكتب إلا إن لم يتغير الملف منذ قراءته. */
    write: guard(async (path, body, o = {}) => {
      const res = await put(path, body, Object.assign({ access: 'private', addRandomSuffix: false, allowOverwrite: !o.create, contentType: o.contentType || 'application/octet-stream', cacheControlMaxAge: 60 }, o.ifMatch ? { ifMatch: o.ifMatch } : {}));
      return res.etag;
    }),
    del: guard(async path => { try { await del(path); } catch (e) { if (!(e instanceof BlobNotFoundError)) throw e; } }),
    copy: guard(async (from, to) => { await copy(from, to, { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/gzip', cacheControlMaxAge: 60 }); }),
    list: guard(async prefix => {
      const out = []; let cursor;
      do { const r = await list({ prefix, cursor, limit: 1000 }); for (const b of r.blobs) out.push({ path: b.pathname, size: b.size, uploadedAt: b.uploadedAt }); cursor = r.hasMore ? r.cursor : undefined; } while (cursor);
      return out;
    }),
  };
}
