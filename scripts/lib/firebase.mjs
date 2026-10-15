import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, applicationDefault, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

export function loadEnvLocal(file = path.join(repoRoot, '.env.local')) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

export function repoRootDir() { return repoRoot; }

export function firebaseApp(env = loadEnvLocal()) {
  if (getApps().length) return getApps()[0];
  const projectId = env.FIREBASE_PROJECT_ID;
  const databaseURL = env.FIREBASE_DATABASE_URL;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!projectId || !databaseURL) throw new Error('FIREBASE_PROJECT_ID / FIREBASE_DATABASE_URL missing from .env.local');
  let credential = null;
  if (clientEmail && privateKey) {
    credential = cert({ projectId, clientEmail, privateKey });
  } else if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    if (!fs.existsSync(env.GOOGLE_APPLICATION_CREDENTIALS)) throw new Error('GOOGLE_APPLICATION_CREDENTIALS file not found');
    process.env.GOOGLE_APPLICATION_CREDENTIALS = env.GOOGLE_APPLICATION_CREDENTIALS;
    credential = applicationDefault();
  }
  if (!credential) throw new Error('No Firebase credentials: set GOOGLE_APPLICATION_CREDENTIALS or client email/private key');
  return initializeApp({ credential, projectId, databaseURL });
}

export function authApi(env) { return getAuth(firebaseApp(env)); }
export function dbApi(env) { return getDatabase(firebaseApp(env)); }

export function cloudinaryConfig(env = loadEnvLocal()) {
  const cloud = env.VITE_CLOUDINARY_CLOUD_NAME;
  const preset = env.VITE_CLOUDINARY_UPLOAD_PRESET;
  if (!cloud || !preset) throw new Error('Cloudinary settings missing from .env.local');
  return { cloud, preset };
}
