// Vercel serverless function placeholder. Lives outside src/ so Vite ignores it
// and Vercel picks it up at /api/health.
export default function handler(_req: Request) {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
