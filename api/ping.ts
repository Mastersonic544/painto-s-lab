// Diagnostic: import getAdmin from ./_lib/admin (the exact import that
// decide-complexity/generate use). If this crashes, admin.ts is the culprit.
import { getAdmin } from './_lib/admin';
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: true, node: process.version, getAdmin: typeof getAdmin });
}
