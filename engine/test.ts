// =============================================================
// Painto's Lab — engine smoke test
// Runs a sample image at colorCount 8/16/32 and writes the two
// SVGs + palette JSON for each to engine/out/. Re-runs the
// colorCount=8 case to confirm a fixed randomSeed produces
// byte-identical output.
//
// Run:  npm --prefix engine test
// =============================================================

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import { generatePaintByNumbers } from './generate';

const SEED = 7707;
const SAMPLE = path.join(__dirname, 'sample.png');
const OUT = path.join(__dirname, 'out');
const COUNTS = [8, 16, 32];

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function main() {
  if (!fs.existsSync(SAMPLE)) {
    throw new Error(`Sample image not found at ${SAMPLE}`);
  }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const buf = fs.readFileSync(SAMPLE);
  const summary: Array<Record<string, unknown>> = [];

  for (const colorCount of COUNTS) {
    const tag = String(colorCount).padStart(2, '0');
    process.stdout.write(`\n=== colorCount=${colorCount} ===\n`);
    const t0 = Date.now();
    const result = await generatePaintByNumbers(buf, {
      colorCount,
      randomSeed: SEED,
      // PRD §5: keep regions large enough for the numbers to physically fit.
      minFacetSize: 24,
    });
    const took = Date.now() - t0;

    const filledPath = path.join(OUT, `sample-c${tag}-filled.svg`);
    const outlinePath = path.join(OUT, `sample-c${tag}-outline.svg`);
    const palettePath = path.join(OUT, `sample-c${tag}-palette.json`);
    fs.writeFileSync(filledPath, result.filledSvg);
    fs.writeFileSync(outlinePath, result.outlineSvg);
    fs.writeFileSync(palettePath, JSON.stringify(result.palette, null, 2));

    const areaSum = result.palette.reduce((a, p) => a + p.areaPercentage, 0);
    const nonEmpty = result.palette.filter((p) => p.frequency > 0).length;
    console.log(
      `  wrote ${path.basename(filledPath)} / ${path.basename(outlinePath)} / ${path.basename(
        palettePath,
      )}`,
    );
    console.log(`  ${nonEmpty}/${result.palette.length} colors used`);
    console.log(`  areaPercentage sum = ${areaSum.toFixed(6)} (expect ~1.0)`);
    console.log(`  bitmap ${result.width}x${result.height}, took ${took}ms`);

    summary.push({
      colorCount,
      nonEmpty,
      paletteSize: result.palette.length,
      areaSum: Number(areaSum.toFixed(6)),
      width: result.width,
      height: result.height,
      tookMs: took,
      filledSha: sha256(result.filledSvg),
      outlineSha: sha256(result.outlineSvg),
    });
  }

  // ---- Determinism check ------------------------------------
  console.log('\n=== determinism check (colorCount=8, seed=7707, twice) ===');
  const a = await generatePaintByNumbers(buf, { colorCount: 8, randomSeed: SEED, minFacetSize: 24 });
  const b = await generatePaintByNumbers(buf, { colorCount: 8, randomSeed: SEED, minFacetSize: 24 });
  const same =
    a.filledSvg === b.filledSvg &&
    a.outlineSvg === b.outlineSvg &&
    JSON.stringify(a.palette) === JSON.stringify(b.palette);
  console.log(`  identical: ${same}`);
  if (!same) {
    process.exitCode = 1;
    throw new Error('Determinism check failed — same seed yielded different output');
  }

  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log('\nAll done. Eyeball the SVGs in engine/out/.');
}

main().catch((err) => {
  console.error('Engine test failed:', err);
  process.exit(1);
});
