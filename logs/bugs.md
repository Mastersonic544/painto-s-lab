# Bugs Log

## BUG-1 — Segmentation cache missing on older pieces and inconsistent label sizes
Symptom: 
1. Clicking "Regenerate files" on older pieces created before caching was implemented returns a "Could not find segmentation cache" error.
2. The default font size of 50 is too large for SVG user coordinates, causing numbers to look inconsistent (very large in big facets, scaled down in small ones).
3. Super tiny dots and narrow shapes remain in the templates despite the minimum area filter because the dynamic minimum area filter is bypassed by static defaults of 24/40 in run-job.ts.
File/line:
- `api/regenerate.ts` (cache retrieval)
- `engine/generate.ts` (getMinFacetSizeForPiece, renderSvg, calculateMinFacetSize)
- `api/_lib/run-job.ts` (options defaults)
Root cause: 
1. Older pieces don't have segmentation_cache.json in Supabase Storage.
2. A default font size of 50px is too large for consistent direct rendering in user-space without the legacy viewBox scaling.
3. run-job.ts always passes a non-undefined minFacetSize (24 or 40) into generatePaintByNumbers options, overriding the dynamic calculateMinFacetSize call.
Attempts:
[2026-07-08] Attempt 1: Fix run-job.ts options to pass undefined for minFacetSize by default, change unified font size default from 50 to 12, add shape safety multipliers in getMinFacetSizeForPiece, and add automatic generation fallback when cache is missing. → SUCCESS
Resolution: All three root causes addressed. Default fontSize changed to 12, minFacetSize now dynamically computed with safety multipliers (2.5x painting, 1.5x portrait), cache-missing pieces automatically fall back to full generation.
Status: RESOLVED

### 2026-07-08 — BUG-2: 500 Internal Server Error when regenerating old pieces
Symptom: Clicking "Regenerate" on an older piece without cache deletes the piece's colors and then throws a 500 error in the console. The piece appears stuck in "queued" state and is essentially deleted from both local and online views.
File/line: `api/regenerate.ts`
Root cause: The fallback block clears the `piece_colors` correctly, but then attempts to trigger the generation job. It either threw a `TypeError: AbortSignal.timeout is not a function` (on older Node versions) or threw an uncaught dynamic `import()` error. This crashed the API before returning the 200 OK response, causing the frontend to log a 500 and the DB to be stuck with deleted colors.
Attempts:
[2026-07-08] Attempt 1: Wrapped the trigger logic in a `try...catch` block so failures update the DB to `status: 'error'` instead of crashing the API. Added a fallback for `AbortSignal.timeout` and exposed the error stack in dev. Fixed React Router DOM v7 warnings. → SUCCESS
Resolution: The API will now gracefully handle any trigger failures, return 200 to the frontend, and mark the piece as 'error' in the UI instead of 'queued'. React router warnings silenced via future flags.
Status: RESOLVED
