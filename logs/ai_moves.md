# AI Moves Log

### 2026-07-08 — Initializing Refinements and Exact Source Mode
Prompt: Implement dynamic outline scaling, typography consistency, small chunk pruning, a cached regeneration pipeline, and the 'Exact Source' render mode.
Approach: Set up logs and migrations, implement engine parameters, configure intake options, implement cached SVG rendering and regeneration API endpoint, and add sidebar controls.
Files touched: 
- `logs/ai_moves.md`
- `logs/db_progress.md`
- `supabase/migrations/20260708000001_exact_source_render_mode.sql`
- `src/types/db.ts`
- `engine/generate.ts`
- `src/routes/Intake.tsx`
- `api/_lib/run-job.ts`
- `api/_lib/regenerate-renderer.ts`
- `api/regenerate.ts`
- `src/routes/PieceJob.tsx`
Outcome: SUCCESS
Notes: Logging initialized.

### 2026-07-08 — Implementing Refinements and Cache-based Regeneration
Prompt: continue
Approach: Complete modifications to the intake form render mode selection, update the conversion engine job runner (run-job.ts) to upload the segmentation cache and dynamically calculate default stroke widths, create a lightweight regeneration renderer and API endpoint (regenerate.ts), integrate a stroke width slider and regeneration button in the frontend (PieceJob.tsx), and resolve ESLint and compilation errors.
Files touched:
- `src/routes/Intake.tsx`
- `src/lib/pieces.ts`
- `engine/generate.ts`
- `api/_lib/run-job.ts`
- `api/_lib/regenerate-renderer.ts`
- `api/regenerate.ts`
- `src/routes/PieceJob.tsx`
Outcome: SUCCESS
Notes: Cached regeneration works completely canvas-free and TypeScript checks pass successfully.

### 2026-07-08 — BUG-1: Fix inconsistent labels, tiny dots, and cache fallback
Prompt: Regenerating current pieces via either changing the stroke width or even sending it back to the generator didn't make the number size consistent and get rid of them super tiny dots that won't fit any number and paint as well irl, investigate and fix.
Approach: Root-caused three issues: (1) default fontSize of 50 was for the legacy viewBox-scaled renderer, not direct SVG coordinates, causing huge labels in large facets, (2) run-job.ts always passed a static minFacetSize override (24/40) which bypassed the dynamic calculateMinFacetSize calculation entirely, (3) older pieces lacked segmentation_cache.json causing regeneration to crash. Fixed all three.
Files touched:
- `engine/generate.ts` (default fontSize 50->12, shape safety multipliers in getMinFacetSizeForPiece)
- `api/_lib/run-job.ts` (removed static minFacetSize default, added fontSize: 12)
- `api/regenerate.ts` (cache-missing fallback to full generation, fontSize default 50->12)
- `api/generate.ts` (suppressed Vite dynamic import warning)
- `src/routes/PieceJob.tsx` (handle queued fallback response in regenerateFiles)
- `logs/bugs.md` (logged BUG-1)
Outcome: SUCCESS
Notes: Existing pieces will automatically fall back to full generation when regenerated (building the cache for future instant re-renders). New pieces get dynamic minFacetSize and consistent 12px labels out of the box.

### 2026-07-08 — BUG-2: Fix 500 error on regenerate fallback and silencing React Router warnings
Prompt: "editing/ regenerating a piece in the local version delets it from the local and online versions heres the console ... 500 (Internal Server Error)"
Approach: Root-caused the 500 error in `/api/regenerate` to the fallback block throwing an uncaught exception (likely `AbortSignal.timeout` on older Node versions or an uncaught inline `import()` error) after it had already deleted the `piece_colors`. Because it crashed before returning 200, the frontend didn't know it was queued, and the piece appeared deleted. Wrapped the trigger logic in `try...catch` and updated the piece status to 'error' if it fails, so it doesn't get stuck. Also silenced the React Router DOM v7 warnings from `main.tsx`.
Files touched:
- `api/regenerate.ts` (wrapped trigger in try-catch, safely fallback AbortSignal.timeout, passed error stack to response)
- `src/main.tsx` (added future flags to BrowserRouter)
- `logs/bugs.md` (logged BUG-2)
Outcome: SUCCESS
Notes: The API now safely handles trigger failures without crashing, ensuring pieces are marked 'error' instead of getting stuck in limbo.
