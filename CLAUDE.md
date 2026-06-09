# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

This repo currently contains only `paintos-lab-prd.md` — the product requirements document for **Painto's Lab**. No code, package manifests, or build tooling exist yet. Read the PRD before doing implementation work; it is the source of truth for scope, data model, and build order.

## Product in one paragraph

Painto's Lab turns photos/paintings into custom paint-by-numbers kits. **Phase 1 is a single-operator production tool**, not a customer-facing storefront — no customer accounts, no uploads from customers, no payments. The "cart" and "checkout" are a production-batching metaphor: operator batches approved pieces, checkout produces the consolidated paint plan and mix task list.

## Tech stack (planned)

- Frontend: React + Tailwind, hosted on Vercel
- Backend: Supabase (Postgres, Auth, Storage, Realtime)
- Conversion engine: fork of `drake7707/paintbynumbersgenerator` (TypeScript, k-means, SVG output) run as a Node worker
- Complexity scoring: OpenRouter (free NVIDIA-class model) primary, algorithmic fallback (distinct colors after first pass, Canny edge ratio, region count, color variance)

## Architecture that spans files / requires the PRD to understand

**Two-step conversion pipeline (Section 5).** Step A decides color count N (8/16/32 by tier, or custom). Step B runs the generator with `kMeansNrOfClusters = N` and emits three artifacts that every downstream feature depends on:
1. Filled SVG (preview, left of approval slider)
2. Borders+labels SVG (numbered template, right of slider, print master)
3. Palette JSON (`index`, `color`, `areaPercentage`, `frequency`) — feeds all paint math

**Job pipeline.** Uploads land in Supabase Storage → `pieces` row created with status `queued` → Node worker runs Step A+B → writes SVGs + palette JSON back, sets status `ready` → frontend gets it via Realtime/polling. Start with a Vercel serverless function; move to a dedicated queue if k-means exceeds the time limit. The engine's `resizeImageIfTooLarge`/`resizeImageWidth`/`resizeImageHeight` settings buy headroom.

**Quality-first rounding rule.** Whenever color-count or paint-volume math lands between two values, **always round up, never down**. This applies to tier selection (Section 4) and to `volume_ml = area_cm2 * coats * coverage_factor` (Section 7).

**Paint math chain (Section 7).** palette JSON `areaPercentage` × canvas dims → per-color cm² → × coats (default 2) × `coverage_factor` (single tunable constant) → ml per color. Cart total groups by target color across all pieces × quantities. At checkout, compare required base-paint volumes (resolved via `color_recipes`) against `base_paints.current_level_ml` and surface shortfalls. Completing a mix task decrements consumed base paints.

**Verified-recipe loop (Section 8).** Mixing is subtractive/nonlinear, so computed recipes are starting points. The product's central learning mechanism: operator adjusts the mix by eye, saves it, `color_recipes.is_verified` flips to true, and that recipe is reused for matching target colors. Optionally feed verified colors back into the engine via `kMeansColorRestrictions` to bias generation toward mixable colors.

**Data model (Section 6).** All tables behind operator role + RLS. Key relationships: `source_images` → `pieces` (with `palette_json` jsonb + SVG storage paths) → `piece_colors` (one row per palette entry). `carts` → `cart_items` (piece + quantity). Checkout generates `mix_tasks` (one per target color in batch) referencing reusable `color_recipes` keyed by `target_rgb_hex`. Storage buckets: `source-images`, `piece-previews`, `piece-outlines`.

**Build order (Section 11) is load-bearing.** Converter + approval slider first — if SVG output isn't pretty/paintable, nothing else matters. Then Supabase schema, intake/job pipeline, slider, Hub, Cart, Lab/checkout, paint math + verified recipes, stock management, landing page.

## Design constraints engineering must respect (Section 10)

- Primary background is **deep swamp green `#0d3d3a`** (not an accent — it dominates). Surfaces/text in warm cream around `#EAE6DB`.
- Visual language: thick outlines, organic blob shapes, watercolor/paint-splatter textures, physics-driven liquid in the paint-container components (shared motif between landing-page hero and stock-management UI; on mobile, deviceorientation drives the liquid).
- **Anti-patterns — do not ship:** generic AI-looking layouts, flat drop-shadow cards, neon/electric greens, thin minimalist corporate styling, sterile grids, and **em dashes anywhere in copy**.

## Phase 1 non-goals (Section 13)

No customer accounts, no customer uploads, no payments, no shipping/order management, no multi-operator teams, no native mobile app. Don't build toward these unless the PRD is updated.
