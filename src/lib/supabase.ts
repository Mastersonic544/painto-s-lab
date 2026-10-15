/** Firebase bridge that keeps the finished app's existing query interface. */
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { getDatabase, ref as databaseRef, get, set, update, remove, onValue } from 'firebase/database';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/db';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY, authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID, databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
const configured = Boolean(config.apiKey && config.projectId && config.databaseURL);
const demo = import.meta.env.DEV && !configured;
const app = configured ? (getApps()[0] || initializeApp(config)) : null;
const auth = app ? getAuth(app) : null;
const db = app ? getDatabase(app) : null;
const now = () => new Date().toISOString();
const asError = (error: unknown) => ({ message: error instanceof Error ? error.message : String(error) });
function userId() { if (demo) return 'local-preview'; const id = auth?.currentUser?.uid; if (!id) throw new Error(configured ? 'Sign in to Painto’s Lab.' : 'Add Firebase settings to .env first.'); return id; }
const sessionUser = () => demo ? ({ id: 'local-preview', email: 'preview@paintos.local', user_metadata: { display_name: 'Local preview' } }) : auth?.currentUser ? ({ id: auth.currentUser.uid, email: auth.currentUser.email, user_metadata: { display_name: auth.currentUser.displayName } }) : null;
const tableRef = (table: string) => databaseRef(db!, `apps/paintos/users/${userId()}/${table}`);
const rowRef = (table: string, id: string) => databaseRef(db!, `apps/paintos/users/${userId()}/${table}/${id}`);
const textRef = (bucket: string, path: string) => databaseRef(db!, `apps/paintos/users/${userId()}/artifact_text/${bucket}/${encodeURIComponent(path).replaceAll('.', '%2E')}`);
const clean = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
function previewDb(): Promise<IDBDatabase> { return new Promise((resolve, reject) => { const request = indexedDB.open('paintos-preview', 1); request.onupgradeneeded = () => { request.result.createObjectStore('records', { keyPath: 'key' }); request.result.createObjectStore('objects', { keyPath: 'key' }); }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function previewRequest<T>(store: 'records' | 'objects', mode: IDBTransactionMode, act: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> { const database = await previewDb(); return new Promise((resolve, reject) => { const transaction = database.transaction(store, mode); const request = act(transaction.objectStore(store)); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); transaction.oncomplete = () => database.close(); transaction.onerror = () => reject(transaction.error); }); }
async function previewRows(table: string): Promise<Record<string, unknown>[]> { const all = await previewRequest<Array<{ key: string; value: Record<string, unknown> }>>('records', 'readonly', store => store.getAll()); return all.filter(item => item.key.startsWith(`${table}/`)).map(item => item.value); }
async function readRows(table: string): Promise<Record<string, unknown>[]> { if (demo) return previewRows(table); const value = (await get(tableRef(table))).val() as Record<string, Record<string, unknown>> | null; return Object.entries(value ?? {}).map(([id, row]) => ({ ...row, id })); }
async function writeRow(table: string, row: Record<string, unknown>) { if (demo) await previewRequest('records', 'readwrite', store => store.put({ key: `${table}/${row.id}`, value: row })); else await set(rowRef(table, String(row.id)), row); }
async function removeRow(table: string, row: Record<string, unknown>) { if (demo) await previewRequest('records', 'readwrite', store => store.delete(`${table}/${row.id}`)); else await remove(rowRef(table, String(row.id))); }

class Query implements PromiseLike<{ data: any; error: { message: string } | null }> {
  private filters: Array<{ key: string; op: 'eq' | 'in'; value: unknown }> = [];
  private orders: Array<{ key: string; ascending: boolean }> = [];
  private count: number | null = null;
  private singleRow = false;
  private optional = false;
  private rows: Record<string, unknown>[] = [];
  private patch: Record<string, unknown> = {};
  private conflict?: string;
  private ignoreDuplicates = false;
  constructor(private table: string, private action: 'read' | 'insert' | 'update' | 'delete' | 'upsert' = 'read') {}
  select(_columns = '*') { void _columns; return this; }
  insert(value: Record<string, unknown> | Record<string, unknown>[]) { this.action = 'insert'; this.rows = Array.isArray(value) ? value : [value]; return this; }
  update(value: Record<string, unknown>) { this.action = 'update'; this.patch = value; return this; }
  delete() { this.action = 'delete'; return this; }
  upsert(value: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string; ignoreDuplicates?: boolean }) { this.action = 'upsert'; this.rows = Array.isArray(value) ? value : [value]; this.conflict = options?.onConflict; this.ignoreDuplicates = Boolean(options?.ignoreDuplicates); return this; }
  eq(key: string, value: unknown) { this.filters.push({ key, op: 'eq', value }); return this; }
  in(key: string, value: unknown[]) { this.filters.push({ key, op: 'in', value }); return this; }
  order(key: string, options?: { ascending?: boolean }) { this.orders.push({ key, ascending: options?.ascending !== false }); return this; }
  limit(value: number) { this.count = value; return this; }
  single() { this.singleRow = true; return this; }
  maybeSingle() { this.singleRow = true; this.optional = true; return this; }
  private defaults(input: Record<string, unknown>) {
    const row: Record<string, unknown> = { ...input, id: input.id || crypto.randomUUID() };
    if (['source_images', 'pieces', 'base_paints', 'carts', 'mix_tasks', 'profiles'].includes(this.table)) row.created_at ??= now();
    if (this.table === 'profiles') { row.display_name ??= null; row.role ??= 'operator'; }
    if (this.table === 'piece_colors') row.label ??= null;
    if (this.table === 'base_paints') row.current_level_ml ??= 0;
    if (this.table === 'color_recipes') { row.is_verified ??= false; row.notes ??= null; }
    if (this.table === 'cart_items') row.quantity ??= 1;
    if (this.table === 'mix_tasks') { row.status ??= 'todo'; row.recipe_id ??= null; }
    if (this.table === 'pieces') { row.render_mode ??= 'painting'; row.stroke_width ??= 1; row.preview_svg_path ??= null; row.outline_svg_path ??= null; row.palette_json ??= null; row.approved_at ??= null; row.error_message ??= null; }
    if (this.table === 'carts') row.checked_out_at ??= null;
    if (this.table === 'mix_tasks') row.completed_at ??= null;
    if (this.table === 'color_recipes') row.updated_at ??= now();
    return clean(row);
  }
  private matches(row: Record<string, unknown>) { return this.filters.every(f => f.op === 'eq' ? row[f.key] === f.value : (f.value as unknown[]).includes(row[f.key])); }
  private async run() {
    try {
      const all = await readRows(this.table);
      let selected = all.filter(row => this.matches(row));
      if (this.action === 'read') {
        for (const order of [...this.orders].reverse()) selected.sort((a, b) => String(a[order.key] ?? '').localeCompare(String(b[order.key] ?? '')) * (order.ascending ? 1 : -1));
        if (this.count != null) selected = selected.slice(0, this.count);
      } else if (this.action === 'insert' || this.action === 'upsert') {
        const written: Record<string, unknown>[] = [];
        for (const input of this.rows) {
          const existing = this.action === 'upsert' && this.conflict ? all.find(r => r[this.conflict!] === input[this.conflict!]) : undefined;
          if (existing && this.ignoreDuplicates) continue;
          const row = this.defaults(existing ? { ...existing, ...input, id: existing.id } : input);
          await writeRow(this.table, row); written.push(row);
        }
        selected = written;
      } else if (this.action === 'update') {
        selected = await Promise.all(selected.map(async row => { const updated = clean({ ...row, ...this.patch }); if (demo) await writeRow(this.table, updated); else await update(rowRef(this.table, String(row.id)), clean(this.patch)); return updated; }));
      } else if (this.action === 'delete') await Promise.all(selected.map(row => removeRow(this.table, row)));
      if (this.singleRow) return selected.length ? { data: selected[0], error: null } : this.optional ? { data: null, error: null } : { data: null, error: { message: 'Row not found.' } };
      return { data: selected, error: null };
    } catch (error) { return { data: null, error: asError(error) }; }
  }
  then<TResult1 = { data: any; error: { message: string } | null }, TResult2 = never>(onfulfilled?: ((value: { data: any; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): Promise<TResult1 | TResult2> { return this.run().then(onfulfilled, onrejected); }
}

const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const cloudPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;
const isText = (path: string) => path.endsWith('.json');
const mediaUrl = (path: string) => path.startsWith(`https://res.cloudinary.com/${cloudName}/image/upload/`);
function bucket(name: string) {
  return {
    async upload(path: string, value: Blob | string, options?: { contentType?: string; upsert?: boolean }) {
      try {
        if (demo) { await previewRequest('objects', 'readwrite', store => store.put({ key: `${name}/${path}`, value: typeof value === 'string' ? new Blob([value], { type: options?.contentType || 'text/plain' }) : value })); return { data: { path }, error: null }; }
        if (isText(path)) {
          await set(textRef(name, path), typeof value === 'string' ? value : await value.text());
          return { data: { path }, error: null };
        }
        if (!cloudName || !cloudPreset) throw new Error('Cloudinary cloud name and upload preset are required for media uploads.');
        const folder = name === 'source-images' ? 'paintos/sources' : 'paintos/generated';
        const file = typeof value === 'string' ? new Blob([value], { type: options?.contentType || 'image/svg+xml' }) : value;
        const filename = path.startsWith('https://') ? `${crypto.randomUUID()}.svg` : path.split('/').pop() || 'image.svg';
        const body = new FormData(); body.set('file', file, filename); body.set('upload_preset', cloudPreset); body.set('folder', folder); body.set('asset_folder', folder); body.set('public_id_prefix', folder);
        const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`, { method: 'POST', body });
        const json = await response.json(); if (!response.ok || !json.secure_url) throw new Error(json.error?.message || 'Cloudinary upload failed.');
        return { data: { path: json.secure_url as string }, error: null };
      } catch (error) { return { data: null, error: asError(error) }; }
    },
    async createSignedUrl(path: string, _expires: number) { void _expires; try { if (demo) { const saved = await previewRequest<{ key: string; value: Blob } | undefined>('objects', 'readonly', store => store.get(`${name}/${path}`)); if (!saved) throw new Error('Stored file not found.'); return { data: { signedUrl: URL.createObjectURL(saved.value) }, error: null }; } if (!mediaUrl(path)) throw new Error('Stored media URL is invalid.'); return { data: { signedUrl: path }, error: null }; } catch (error) { return { data: null, error: asError(error) }; } },
    async createSignedUrls(paths: string[], expires: number) { try { return { data: await Promise.all(paths.map(async path => ({ path, signedUrl: (await this.createSignedUrl(path, expires)).data?.signedUrl || null }))), error: null }; } catch (error) { return { data: null, error: asError(error) }; } },
    async download(path: string) { try { if (demo) { const saved = await previewRequest<{ key: string; value: Blob } | undefined>('objects', 'readonly', store => store.get(`${name}/${path}`)); if (!saved) throw new Error('Stored file not found.'); return { data: saved.value, error: null }; } if (isText(path)) { const value = (await get(textRef(name, path))).val(); if (typeof value !== 'string') throw new Error('Stored text not found.'); return { data: new Blob([value], { type: 'application/json' }), error: null }; } if (!mediaUrl(path)) throw new Error('Stored media URL is invalid.'); const response = await fetch(path); if (!response.ok) throw new Error(`Media download HTTP ${response.status}`); return { data: await response.blob(), error: null }; } catch (error) { return { data: null, error: asError(error) }; } },
  };
}

const bridge = {
  from: (table: string) => new Query(table), storage: { from: bucket },
  auth: {
    async getUser() { return { data: { user: sessionUser() }, error: null }; },
    async getSession() { if (auth) await auth.authStateReady(); return { data: { session: sessionUser() ? { user: sessionUser(), access_token: demo ? 'local-preview' : await auth!.currentUser!.getIdToken() } : null }, error: null }; },
    onAuthStateChange(callback: (_event: string, session: unknown) => void) { if (demo) queueMicrotask(() => callback('SIGNED_IN', { user: sessionUser(), access_token: 'local-preview' })); const unsubscribe = auth ? onAuthStateChanged(auth, async user => callback('SIGNED_IN', user ? { user: sessionUser(), access_token: await user.getIdToken() } : null)) : (() => {}); return { data: { subscription: { unsubscribe } } }; },
    async signInWithPassword(input: { email: string; password: string }) { try { if (!auth) throw new Error('Add Firebase settings to .env before signing in.'); await signInWithEmailAndPassword(auth, input.email, input.password); return { data: { user: sessionUser() }, error: null }; } catch (error) { return { data: null, error: asError(error) }; } },
    async signOut() { if (auth) await signOut(auth); },
  },
  channel(name: string) {
    void name;
    let stop = () => {};
    return {
      on(_event: string, options: { table: string; filter?: string }, callback: (payload: { new: Record<string, unknown> | null }) => void) {
        return {
          subscribe(status?: (state: string) => void) {
            if (db && auth?.currentUser) {
              stop = onValue(tableRef(options.table), snapshot => {
                const id = options.filter?.startsWith('id=eq.') ? options.filter.slice(6) : null;
                if (id) callback({ new: snapshot.child(id).val() ?? null });
                else callback({ new: null });
              });
              status?.('SUBSCRIBED');
            }
            return this;
          },
          unsubscribe() { stop(); },
        };
      },
    };
  },
  removeChannel(channel: { unsubscribe?: () => void }) { channel.unsubscribe?.(); },
};
export const supabase = bridge as unknown as SupabaseClient<Database>;
