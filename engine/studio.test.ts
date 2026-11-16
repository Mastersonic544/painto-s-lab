import assert from 'node:assert/strict';
import { createCanvas } from 'canvas';
import { generatePaintByNumbers } from './generate';
import { renderSvgCached, type CachedSegmentation } from '../api/_lib/regenerate-renderer';

async function main() {
  const canvas = createCanvas(96, 96);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#bf8c50';
  ctx.fillRect(0, 0, 96, 96);
  ctx.fillStyle = '#302332';
  ctx.fillRect(48, 0, 48, 96);

  for (let y = 50; y < 90; y += 8)
    for (let x = 4; x < 44; x += 8) {
      ctx.fillStyle = '#302332';
      ctx.fillRect(x, y, 4, 4);
    }
  const originalLog = console.log;
  console.log = () => {};
  try {
    const options = {
      colorCount: 2,
      randomSeed: 7707,
      strokeWidth: 0.1,
      fontSize: 18,
      narrowPixelStripCleanupRuns: 0,
    };
    const detailed = await generatePaintByNumbers(canvas.toBuffer(), {
      ...options,
      minFacetSize: 1,
    });
    const simple = await generatePaintByNumbers(canvas.toBuffer(), {
      ...options,
      minFacetSize: 1000,
    });
    const cache = simple.segmentationCache as CachedSegmentation;
    assert.ok(
      cache.facets.length < (detailed.segmentationCache as CachedSegmentation).facets.length,
      'simplification merges small spots',
    );
    assert.equal(
      simple.outlineSvg,
      renderSvgCached(cache, 3, false, true, true, 18, '#1A1A1A', 0.1),
      'fresh and cached renders match',
    );
    assert.match(simple.outlineSvg, /stroke-width:0.1px/);
    assert.match(
      simple.filledSvg,
      /stroke-width:0.5px/,
      'fill sealing is independent of outline thickness',
    );
    assert.match(simple.outlineSvg, /stroke="white".*paint-order="stroke fill"/);
    assert.ok(
      simple.outlineSvg.lastIndexOf('<path ') < simple.outlineSvg.indexOf('<g class="label"'),
      'all numbers render above all region borders',
    );
    assert.ok(!simple.outlineSvg.includes('NaN'));
    const repeat = await generatePaintByNumbers(canvas.toBuffer(), {
      ...options,
      minFacetSize: 1000,
    });
    assert.equal(simple.outlineSvg, repeat.outlineSvg, 'generation remains deterministic');
    const bright = await generatePaintByNumbers(canvas.toBuffer(), {
      ...options,
      minFacetSize: 1000,
      brightnessBoost: 1.4,
    });
    assert.notEqual(
      simple.filledSvg,
      bright.filledSvg,
      'source adjustments affect generated output',
    );
    originalLog(
      'Studio regression checks passed: thin outlines, halos, layering, simplification, cache parity, source adjustment, determinism.',
    );
  } finally {
    console.log = originalLog;
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
