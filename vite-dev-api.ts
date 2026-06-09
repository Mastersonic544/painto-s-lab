// Dev-only bridge that runs the Vercel functions in /api during `npm run dev`.
// Vite normally serves only the SPA, so /api/* would 404 locally. This plugin
// loads .env into process.env (the handlers read process.env, not
// import.meta.env) and adapts Node's req/res to the @vercel/node shape so the
// same handler code runs unchanged. It is NEVER applied to production builds.
import type { Connect, Plugin } from 'vite';
import { loadEnv } from 'vite';
import type { ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

function readBody(req: Connect.IncomingMessage): Promise<string> {
  return new Promise((res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => res(''));
  });
}

// Add the handful of @vercel/node response helpers the handlers actually use.
function decorateRes(res: ServerResponse) {
  const r = res as ServerResponse & {
    status: (code: number) => typeof r;
    json: (body: unknown) => void;
    send: (body: unknown) => void;
  };
  r.status = (code: number) => {
    r.statusCode = code;
    return r;
  };
  r.json = (body: unknown) => {
    if (!r.headersSent) r.setHeader('content-type', 'application/json');
    r.end(JSON.stringify(body));
  };
  r.send = (body: unknown) => {
    if (typeof body === 'object') return r.json(body);
    r.end(String(body));
  };
  return r;
}

export function devApi(): Plugin {
  return {
    name: 'paintos-dev-api',
    apply: 'serve', // dev server only — never in `vite build`
    configResolved(config) {
      // Surface every .env value (VITE_ and server-only alike) to the
      // functions via process.env, without clobbering real env vars.
      const env = loadEnv(config.mode, config.root, '');
      for (const [k, v] of Object.entries(env)) {
        if (process.env[k] === undefined) process.env[k] = v;
      }
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (!url.startsWith('/api/')) return next();

        // /api/foo?x=1 -> api/foo.ts. Ignore shared helpers in api/_lib.
        const name = url.replace(/^\/api\//, '').split('?')[0].replace(/\/$/, '');
        if (!name || name.startsWith('_')) return next();
        const file = resolve(server.config.root, 'api', `${name}.ts`);
        if (!existsSync(file)) return next();

        try {
          const raw = await readBody(req);
          // Match @vercel/node: req.body is the parsed object for JSON.
          (req as Connect.IncomingMessage & { body?: unknown }).body = raw
            ? safeJson(raw) ?? raw
            : undefined;
          (req as Connect.IncomingMessage & { query?: unknown }).query = {};

          const mod = await server.ssrLoadModule(`/api/${name}.ts`);
          const handler = mod.default as (rq: unknown, rs: unknown) => unknown;
          if (typeof handler !== 'function') return next();

          await handler(req, decorateRes(res));
        } catch (err) {
          // Surface the real error so the dev sees why a function failed.
          server.config.logger.error(`[dev-api] /api/${name} threw: ${String(err)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
          }
          res.end(JSON.stringify({ ok: false, error: String(err) }));
        }
      });
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
