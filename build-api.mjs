import { build } from 'esbuild';

await build({
  entryPoints: [
    'server/routes/generate.ts',
    'server/routes/regenerate.ts',
    'server/routes/decide-complexity.ts',
  ],
  outdir: 'api',
  entryNames: '[name]',
  bundle: true,
  packages: 'external',
  platform: 'node',
  format: 'esm',
  target: 'node22',
  logLevel: 'info',
});
