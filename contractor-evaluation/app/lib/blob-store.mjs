/* محرك التخزين على Vercel Blob (متجر خاص private): قراءة مباشرة من المصدر دون ذاكرة CDN، وكتابة مشروطة بـ ETag. */
import { put, get, del, copy, BlobPreconditionFailedError, BlobNotFoundError } from '@vercel/blob';

const precondition = () => { const e = new Error('precondition'); e.code = 'precondition'; return e; };
export function blobStore() {
  const ready = !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
  return {
    ready,
    async read(path, o = {}) {
      const r = await get(path, Object.assign({ access: 'private', useCache: false }, o.ifNoneMatch ? { ifNoneMatch: o.ifNoneMatch } : {}));
      if (!r) return { status: 404 };
      if (r.statusCode === 304) return { status: 304, etag: r.blob.etag };
      const body = Buffer.from(await new Response(r.stream).arrayBuffer());
      return { status: 200, etag: r.blob.etag, body, contentType: r.blob.contentType };
    },
    async write(path, body, o = {}) {
      try {
        const res = await put(path, body, Object.assign({ access: 'private', addRandomSuffix: false, allowOverwrite: !o.create, contentType: o.contentType || 'application/octet-stream', cacheControlMaxAge: 60 }, o.ifMatch ? { ifMatch: o.ifMatch } : {}));
        return res.etag;
      } catch (e) {
        if (e instanceof BlobPreconditionFailedError) throw precondition();
        throw e;
      }
    },
    async del(path) { try { await del(path); } catch (e) { if (!(e instanceof BlobNotFoundError)) throw e; } },
    async copy(from, to) { await copy(from, to, { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/gzip', cacheControlMaxAge: 60 }); },
  };
}
