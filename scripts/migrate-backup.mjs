import fs from 'node:fs';
import path from 'node:path';
import { parseDump, parseJsonColumn } from './lib/dump.mjs';
import { loadEnvLocal, authApi, dbApi, cloudinaryConfig, repoRootDir } from './lib/firebase.mjs';

const root = repoRootDir();
const work = path.join(root, 'scripts/.work');
const tables = parseDump(path.join(work, 'backup.sql'));
const env = loadEnvLocal();
const { cloud, preset } = cloudinaryConfig(env);
const db = dbApi(env);
const auth = authApi(env);
const user = (await auth.getUserByEmail('admin@painto.com'));
const uid = user.uid;
const base = `apps/paintos/users/${uid}`;
const oldUsers = tables.get('auth.users').rows;
if (oldUsers.length !== 1) throw new Error(`Expected one source user, found ${oldUsers.length}; UID mapping needs review`);
const manifestFile = path.join(work, 'media-manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
const mediaRoot = path.join(work, 'media', 'eogiwvjzfafhqygbsjzc');
const objects = tables.get('storage.objects').rows;
const media = objects.filter(o => !o.name.toLowerCase().endsWith('.json'));
const json = objects.filter(o => o.name.toLowerCase().endsWith('.json'));

function saveManifest() { fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2)); }
async function upload(o) {
  const key = `${o.bucket_id}/${o.name}`;
  if (manifest[key]) return;
  const file = path.join(mediaRoot, o.bucket_id, ...o.name.split('/'));
  if (!fs.existsSync(file)) throw new Error(`Backup media missing: ${key}`);
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.svg' ? 'image/svg+xml' : ext === '.png' ? 'image/png' : 'image/jpeg';
  let error;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const form = new FormData();
      form.set('file', new Blob([fs.readFileSync(file)], { type: mime }), path.basename(file));
      form.set('upload_preset', preset);
      form.set('folder', o.bucket_id === 'source-images' ? 'paintos/migrated/sources' : 'paintos/migrated/generated');
      const response = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form, signal: AbortSignal.timeout(120000) });
      const result = await response.json();
      if (!response.ok || !result.secure_url) throw new Error(`${response.status} ${result.error?.message || 'upload failed'}`);
      manifest[key] = result.secure_url;
      saveManifest();
      return;
    } catch (e) { error = e; await new Promise(resolve => setTimeout(resolve, attempt * 1500)); }
  }
  throw new Error(`${key}: ${error.message}`);
}

const queue = media.filter(o => !manifest[`${o.bucket_id}/${o.name}`]);
console.log(`Media: ${media.length - queue.length}/${media.length} already uploaded; ${queue.length} remaining`);
let cursor = 0, failures = [];
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < queue.length) {
    const o = queue[cursor++];
    try { await upload(o); }
    catch (e) { failures.push(e.message); console.error(e.message); }
    const done = Object.keys(manifest).length;
    if (done % 10 === 0 || done === media.length) console.log(`Uploaded ${done}/${media.length} media`);
  }
}));
if (failures.length) throw new Error(`${failures.length} media uploads failed; rerun to retry`);

for (const o of json) {
  const file = path.join(mediaRoot, o.bucket_id, ...o.name.split('/'));
  const key = encodeURIComponent(o.name).replaceAll('.', '%2E');
  await db.ref(`${base}/artifact_text/${o.bucket_id}/${key}`).set(fs.readFileSync(file, 'utf8'));
}
console.log(`Saved ${json.length} JSON cache files to Firebase`);

const numeric = new Set(['color_count', 'canvas_width_cm', 'canvas_height_cm', 'coats', 'stroke_width', 'color_index', 'area_percentage', 'estimated_volume_ml', 'container_capacity_ml', 'current_level_ml', 'reorder_threshold_ml', 'quantity', 'target_volume_ml']);
const boolean = new Set(['is_verified']);
const structured = new Set(['palette_json', 'recipe_json']);
function convert(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null) continue;
    out[key] = numeric.has(key) ? Number(value) : boolean.has(key) ? value === 't' : structured.has(key) ? parseJsonColumn(value) : value;
  }
  return out;
}
function mediaUrl(bucket, storagePath) {
  if (!storagePath) return null;
  const key = `${bucket}/${storagePath}`;
  if (!manifest[key]) throw new Error(`No uploaded media for ${key}`);
  return manifest[key];
}
const tableNames = ['profiles', 'source_images', 'pieces', 'piece_colors', 'base_paints', 'color_recipes', 'carts', 'cart_items', 'mix_tasks'];
const updates = {};
for (const name of tableNames) {
  const rows = tables.get(name)?.rows || [];
  for (const input of rows) {
    const row = convert(input);
    if (name === 'profiles') row.id = uid;
    if (name === 'source_images') {
      row.uploaded_by = uid;
      row.storage_path = mediaUrl('source-images', input.storage_path);
    }
    if (name === 'pieces') {
      row.preview_svg_path = mediaUrl('piece-previews', input.preview_svg_path);
      row.outline_svg_path = mediaUrl('piece-outlines', input.outline_svg_path);
      if (row.status === 'queued') { row.status = 'error'; row.error_message = 'Generation was interrupted before migration. Retry this piece.'; }
    }
    updates[`${name}/${row.id}`] = row;
  }
  console.log(`${name}: ${rows.length} prepared`);
}
const entries = Object.entries(updates);
for (let i = 0; i < entries.length; i += 100) {
  await db.ref(base).update(Object.fromEntries(entries.slice(i, i + 100)));
  console.log(`Firebase rows ${Math.min(i + 100, entries.length)}/${entries.length}`);
}
const snap = await db.ref(base).get();
const value = snap.val() || {};
for (const name of tableNames) {
  const expected = tables.get(name)?.rows.length || 0;
  const actual = Object.keys(value[name] || {}).length;
  if (actual < expected) throw new Error(`${name}: expected at least ${expected}, found ${actual}`);
  console.log(`Verified ${name}: ${actual} (backup ${expected})`);
}
console.log(`MIGRATION COMPLETE: ${Object.keys(manifest).length}/${media.length} media, ${json.length} JSON, ${entries.length} rows`);
db.goOffline();
process.exit(0);
