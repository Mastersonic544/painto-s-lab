import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

function app() {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!projectId || !databaseURL) throw new Error('Firebase Admin settings are missing');
  const credential = clientEmail && privateKey
    ? cert({ projectId, clientEmail, privateKey })
    : process.env.GOOGLE_APPLICATION_CREDENTIALS
      ? applicationDefault()
      : null;
  if (!credential) throw new Error('Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS');
  return initializeApp({ credential, projectId, databaseURL });
}

export async function verifyToken(token: string): Promise<string> {
  return (await getAuth(app()).verifyIdToken(token)).uid;
}

export function getAdmin(uid: string) {
  if (!uid) throw new Error('Firebase user ID required');
  const database = getDatabase(app());
  const table = (name: string) => database.ref(`apps/paintos/users/${uid}/${name}`);
  const textRef = (name: string, path: string) => database.ref(`apps/paintos/users/${uid}/artifact_text/${name}/${encodeURIComponent(path).replaceAll('.', '%2E')}`);
  const isText = (path: string) => path.endsWith('.json');
  const cloud = process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const preset = process.env.VITE_CLOUDINARY_UPLOAD_PRESET;
  const asError = (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) });

  class Query implements PromiseLike<{ data: any; error: { message: string } | null }> {
    private filters: Array<{ key: string; value: unknown }> = [];
    private ordering: Array<{ key: string; ascending: boolean }> = [];
    private max: number | null = null;
    private one = false;
    private optional = false;
    private records: Record<string, unknown>[] = [];
    private changes: Record<string, unknown> = {};
    constructor(private name: string, private action: 'read' | 'insert' | 'update' | 'delete' = 'read') {}
    select(_fields = '*') { void _fields; return this; }
    eq(key: string, value: unknown) { this.filters.push({ key, value }); return this; }
    order(key: string, options?: { ascending?: boolean }) { this.ordering.push({ key, ascending: options?.ascending !== false }); return this; }
    limit(max: number) { this.max = max; return this; }
    maybeSingle() { this.one = true; this.optional = true; return this; }
    single() { this.one = true; return this; }
    insert(records: Record<string, unknown> | Record<string, unknown>[]) { this.action = 'insert'; this.records = Array.isArray(records) ? records : [records]; return this; }
    update(changes: Record<string, unknown>) { this.action = 'update'; this.changes = changes; return this; }
    delete() { this.action = 'delete'; return this; }
    private async run() {
      try {
        const value = (await table(this.name).get()).val() as Record<string, Record<string, unknown>> | null;
        let rows = Object.entries(value ?? {}).map(([id, row]) => ({ ...row, id }));
        rows = rows.filter(row => this.filters.every(f => row[f.key] === f.value));
        if (this.action === 'read') {
          for (const order of [...this.ordering].reverse()) rows.sort((a, b) => String(a[order.key] ?? '').localeCompare(String(b[order.key] ?? '')) * (order.ascending ? 1 : -1));
          if (this.max !== null) rows = rows.slice(0, this.max);
        } else if (this.action === 'insert') {
          rows = await Promise.all(this.records.map(async record => { const row = { ...record, id: String(record.id || crypto.randomUUID()) }; await table(this.name).child(row.id).set(row); return row; }));
        } else if (this.action === 'update') {
          rows = await Promise.all(rows.map(async row => { const updated = { ...row, ...this.changes }; await table(this.name).child(String(row.id)).update(this.changes); return updated; }));
        } else {
          await Promise.all(rows.map(row => table(this.name).child(String(row.id)).remove()));
        }
        if (this.one) return rows.length ? { data: rows[0], error: null } : this.optional ? { data: null, error: null } : { data: null, error: { message: 'Row not found' } };
        return { data: rows, error: null };
      } catch (error) { return { data: null, error: asError(error) }; }
    }
    then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(onfulfilled?: ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> { return this.run().then(onfulfilled, onrejected); }
  }

  return {
    from: (name: string) => new Query(name),
    storage: { from: (name: string) => ({
      async download(path: string) {
        try {
          if (isText(path)) {
            const value = (await textRef(name, path).get()).val();
            if (typeof value !== 'string') throw new Error('Stored text not found');
            return { data: new Blob([value], { type: 'application/json' }), error: null };
          }
          const url = new URL(path);
          if (!cloud || url.protocol !== 'https:' || url.hostname !== 'res.cloudinary.com' || !url.pathname.startsWith(`/${cloud}/image/upload/`)) throw new Error('Untrusted media URL');
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Media download HTTP ${response.status}`);
          return { data: new Blob([await response.arrayBuffer()]), error: null };
        }
        catch (error) { return { data: null, error: asError(error) }; }
      },
      async upload(path: string, value: string | Buffer, options?: { contentType?: string; upsert?: boolean }) {
        try {
          if (isText(path)) {
            await textRef(name, path).set(typeof value === 'string' ? value : value.toString('utf8'));
            return { data: { path }, error: null };
          }
          if (!cloud || !preset) throw new Error('Cloudinary settings are missing');
          const folder = name === 'source-images' ? 'paintos/sources' : 'paintos/generated';
          const filename = path.startsWith('https://') ? `${crypto.randomUUID()}.svg` : path.split('/').pop() || 'image.svg';
          const file = new Blob([typeof value === 'string' ? value : Uint8Array.from(value)], { type: options?.contentType || 'image/svg+xml' });
          const body = new FormData(); body.set('file', file, filename); body.set('upload_preset', preset); body.set('folder', folder); body.set('asset_folder', folder); body.set('public_id_prefix', folder);
          const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, { method: 'POST', body });
          const json = await response.json() as { secure_url?: string; error?: { message?: string } };
          if (!response.ok || !json.secure_url) throw new Error(json.error?.message || 'Cloudinary upload failed');
          return { data: { path: json.secure_url }, error: null };
        }
        catch (error) { return { data: null, error: asError(error) }; }
      },
    }) },
  };
}
