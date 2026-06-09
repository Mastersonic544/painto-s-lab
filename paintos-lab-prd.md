# Painto's Lab: Product Requirements Document

Version 0.1 (working draft, ready to code against)

## 1. What this is

Painto's Lab is a web platform that turns any photo or painting into a custom paint-by-numbers kit. An operator uploads a source image, the platform flattens it into clean numbered regions, decides how many colors the piece needs, calculates how much of each paint to mix, and guides the operator through mixing every shade from a small set of stocked base paints. It also tracks paint inventory in physical containers.

The brand is playful and tactile: a friendly mad-painter mixing potions in a swampy Amazonian greenhouse. The product should never feel sterile, corporate, or AI-generated.

## 2. Scope (read this first)

**Phase 1 (this build) is a single-operator production tool plus a public landing page.** Everything in the original flow is done by one role, the operator/admin: upload, approve, batch pieces into the cart, plan paint, mix, manage stock. There are no customer accounts, no customer uploads, and no payment processing in Phase 1. The "cart" and "checkout" are a production-batching metaphor: the cart is a set of pieces you intend to produce, and checking out generates the consolidated paint plan for that batch.

The public landing page is a marketing front for the brand. It sits in front of the login and showcases the platform with playful animated elements. It does not sell anything yet.

Customer-facing commerce (a real storefront, or letting customers upload their own photos for custom kits) is a deliberate Phase 2 decision. See Section 12, Open Decisions. The core engine below is identical regardless of which direction Phase 2 takes, so building Phase 1 commits you to nothing.

## 3. Tech stack

- Frontend: React with Tailwind CSS.
- Backend and data: Supabase (Postgres, Auth, Storage, optionally Edge Functions and Realtime).
- Hosting: Vercel for the frontend.
- Conversion engine: a fork of `drake7707/paintbynumbersgenerator` (TypeScript, MIT licensed, SVG output, k-means quantization). Run as a Node worker, see Section 5.
- Complexity and color-count decision: OpenRouter (free NVIDIA-class model) as primary, with an algorithmic fallback when the model is unavailable or rate-limited.

## 4. Color tiers and the auto/manual decision

Three tiers map to fixed color counts:

- Simple: 8 colors
- Normal: 16 colors
- Complex: 32 colors

Custom counts (for example 12 or 24) are supported as a per-piece override but are not part of the default flow.

**Quality-first rounding rule:** whenever the decision lands between two tiers or two color counts, always round up to more colors. Never round down.

**Mode:**

- Global default is Auto.
- In Auto, the platform estimates the piece's complexity and recommends a tier and color count. Decision source is OpenRouter first (the model sees the image and returns a complexity rating plus a suggested color count). An algorithmic score runs in parallel as a sanity check and a fallback: distinct-color count after a first quantization pass, edge density (Canny edge ratio), region count after a first pass, and overall color variance. The final tier follows the round-up rule. The operator always sees the recommendation before generation.
- In Manual, the operator picks the tier directly (or a custom count) and that value is forced. A global Manual setting pins every new piece to one tier; a per-piece Manual override affects only that piece.

## 5. The conversion engine

There are two distinct steps. Keeping them separate matters.

**Step A, decide the color count.** Input: the source image. Output: an integer N (8, 16, 32, or a custom value), derived from the mode logic in Section 4.

**Step B, generate the piece.** Input: the source image and N. Run the forked generator with `kMeansNrOfClusters = N`. Outputs:

1. A filled SVG (facets filled with their colors): the finished-piece preview, the left side of the approval slider.
2. A borders-and-labels SVG (outlines with numbers, no fills): the numbered template, the right side of the slider, and the print master.
3. A palette JSON: an array of entries, each with `index`, `color` (RGB), `areaPercentage`, and `frequency`. This feeds every downstream calculation.

**Engine settings to expose and tune:**

- `randomSeed`: fixed per piece so the approved preview equals the produced output.
- `removeFacetsSmallerThanNrOfPoints` and `maximumNumberOfFacets`: enforce a minimum region size so numbers physically fit on the printed canvas. Tie the threshold to canvas size.
- `kMeansColorRestrictions` and `colorAliases`: optional, restrict generation to colors you can mix from stocked base paints, and name them so the names appear in the palette JSON.
- `resizeImageIfTooLarge`, `resizeImageWidth`, `resizeImageHeight`: cap input dimensions to keep processing time inside serverless limits.

**Where it runs.** k-means on a full image is CPU-heavy and can exceed serverless time limits on large inputs. Recommended pattern:

1. Operator uploads the image to Supabase Storage.
2. A job record is created with status `queued`.
3. A Node worker picks it up, runs Step A then Step B, and writes the two SVGs plus the palette JSON back to Storage and the database, setting status `ready`.
4. The frontend subscribes (Supabase Realtime) or polls and shows the preview when ready.

Start simple: a Vercel serverless function can handle reasonably sized, pre-resized images. If large images push past the time limit, move the worker to a dedicated queue and long-running process. The engine's resize settings buy you a lot of headroom early.

## 6. Data model (Supabase / Postgres)

Lock all tables behind an authenticated operator role with row-level security. Phase 1 is single-tenant.

**profiles**: `id` (uuid, references auth.users), `display_name`, `role` (default `operator`), `created_at`.

**source_images**: `id`, `storage_path`, `original_filename`, `uploaded_by`, `created_at`.

**pieces**: `id`, `source_image_id`, `title`, `status` (`queued` | `ready` | `approved` | `archived`), `mode` (`auto` | `manual`), `complexity` (`simple` | `normal` | `complex`), `color_count`, `canvas_width_cm`, `canvas_height_cm`, `coats` (default 2), `preview_svg_path`, `outline_svg_path`, `palette_json` (jsonb), `created_at`, `approved_at`.

**piece_colors**: `id`, `piece_id`, `color_index`, `label`, `rgb_hex`, `area_percentage`, `estimated_volume_ml`. One row per color in a piece, derived from the palette JSON.

**base_paints**: `id`, `name`, `rgb_hex`, `container_capacity_ml`, `current_level_ml`, `reorder_threshold_ml`, `created_at`. These are the physical containers you stock and refill.

**color_recipes**: `id`, `target_rgb_hex`, `recipe_json` (jsonb array of `{ base_paint_id, parts }` or `{ base_paint_id, ml }`), `is_verified` (boolean, true once the operator confirms the real-world mix), `notes`, `updated_at`. Recipes are keyed by target color so they are reusable across pieces.

**carts**: `id`, `name`, `status` (`open` | `checked_out`), `created_at`, `checked_out_at`.

**cart_items**: `id`, `cart_id`, `piece_id`, `quantity`.

**mix_tasks**: `id`, `cart_id`, `target_rgb_hex`, `target_volume_ml`, `recipe_id`, `status` (`todo` | `done`), `created_at`, `completed_at`. Generated at checkout, one per color the batch needs.

**Storage buckets**: `source-images`, `piece-previews`, `piece-outlines`.

## 7. Paint quantity math

Per-color painted area comes straight from the palette JSON: `area_cm2 = areaPercentage * canvas_width_cm * canvas_height_cm`.

Volume estimate: `volume_ml = area_cm2 * coats * coverage_factor`, where `coverage_factor` (ml of paint per cm² per coat) is a single tunable constant you calibrate from real painting, plus a safety margin. Acrylics commonly want two coats for opacity, so default `coats` to 2.

This is always an estimate, which fits the round-up philosophy: over-estimating means nobody runs out mid-piece. Always round up.

The cart total is the sum of per-color volumes across every piece (times quantities) in the cart, grouped by target color.

**Stock linkage:** at checkout, compare required base-paint volumes (derived from recipes) against `base_paints.current_level_ml`. If a batch needs more of a base color than is in the container, surface a clear low-stock warning naming the color and the shortfall. Mixing a task decrements the base paints it consumes.

## 8. Paint mixing

Real pigment mixing is subtractive and nonlinear, so any computed recipe is an approximation, accurate for easy colors and looser for saturated greens, purples, and oranges. The product handles this honestly rather than pretending precision.

**Approach:**

1. The operator maintains a set of base paints (the containers). These are the "primaries" the system mixes from.
2. For each target color in a piece, the platform shows a recipe as parts or ml of base paints, presented as a starting point to adjust by eye, not a guarantee.
3. **The key feature:** once the operator mixes a color for real and is happy, they save the corrected recipe. `is_verified` flips to true. Next time that color (or a near match) appears, the verified recipe is used. The platform gets more accurate the more you use it, and your real-world knowledge becomes the source of truth.

Optionally, use the engine's `kMeansColorRestrictions` to bias generation toward colors you already have verified recipes for, which tightens the loop further.

## 9. Feature modules

### 9.1 Auth and login
Supabase email auth. Login screen is the entry point to the operator app. Public landing page is reachable without auth; the app is gated.

### 9.2 Public landing page
A lively marketing page that sells the feeling of the platform. Requirements: hero with the Painto's Lab logo and brand voice, scroll sections showing off real product elements (the slider, the lab, the cart, the containers), and animated flourishes throughout. Paint-splash themed section transitions. The signature interactive element is a paint container rendered like a printer cartridge with a transparent window and animated liquid. On mobile the liquid should respond to device tilt with real motion (accelerometer / deviceorientation driving a lightweight liquid simulation, for example a wave or metaball surface), so it sloshes as the phone moves. No payment or signup flow yet; a single call to action into the app.

### 9.3 Image intake and complexity detection
Operator uploads a source image. The platform sets canvas dimensions and coats (with sensible presets), runs the mode logic from Section 4 to decide the color count, and queues a generation job. Operator sees the recommended tier and count and can override before or after generation.

### 9.4 Preview and approval slider
The custom component at the heart of approval. A single image frame split by a vertical slider handle. Drag left to reveal the finished filled piece (filled SVG); drag right to reveal the black-and-white numbered outline (borders-and-labels SVG). Approve adds the piece to the Hub; reject discards or re-queues with different settings. Include a light manual-edit step (merge two regions, recolor a region, nudge a number) so "almost right" output becomes sellable rather than forcing a full reject.

### 9.5 The Hub
An e-commerce-style gallery of approved pieces. Browse, filter by complexity, and add pieces to the lab cart. This is a production catalog, not a storefront, in Phase 1.

### 9.6 The Lab Cart
A cart of pieces the operator intends to produce. Add, remove, set quantity. Shows a running roll-up of the colors the batch will need. Checkout moves the operator into the Lab.

### 9.7 The Lab (checkout)
On checkout, generate the consolidated color sheet for the batch: every color across every piece, grouped, with total volume needed per color and the mix recipe for each. Two views:

- Color sheet view: the full palette and quantities for the batch.
- Mixing mode: a to-do list of mix tasks. Each task expands to show the recipe (base paints and amounts) for that color. The operator mixes, then checks the task off. Completing a task decrements the consumed base paints from stock.

Hovering or tapping a color anywhere shows its recipe formula (parts of base paints).

### 9.8 Stock management
The operator's inventory of base paints, each shown as a container styled like an injection-filled printer cartridge with a transparent window. An animated liquid fill shows the current level relative to capacity. Top-up flow: the operator records buying more of a base color, and the container animates filling. Low-stock indicators when a color is below its reorder threshold or when a queued batch would exhaust it. The water/liquid animation is a recurring brand motif shared with the landing page hero.

## 10. Design system

Detailed direction lives in the Claude Design system (see the separate form text). Summary for engineering:

- Dominant color is deep swamp-Amazon green, #0d3d3a, used as the primary background rather than an accent.
- Warm cream (around #EAE6DB, matching the logo lettering) for surfaces and text; near-black for outlines and definition.
- Accents are real paint colors used sparingly, like splashes on a palette (mustard, terracotta, teal).
- Typography echoes the logo: a rounded, chunky, bubbly display face for headings; a clean friendly sans for body.
- Visual language: thick outlines, soft rounded corners, irregular organic blob shapes, watercolor and paint-splatter textures rather than flat fills.
- Motion: splash, drip, and bloom transitions; squishy buttons; physics-driven liquid in containers.

**Explicit anti-patterns (do not ship these):** generic AI-looking layouts, flat uniform drop-shadow cards, neon or electric greens, thin minimalist corporate styling, sterile grids, and em dashes anywhere in copy.

## 11. Build order

The converter and the approval slider are the product. If that output is not pretty and paintable, nothing downstream matters. Suggested sequence:

1. Fork and stand up the conversion engine. Confirm SVG + palette JSON output on real images at 8, 16, 32 colors.
2. Supabase project: auth, schema, storage buckets, RLS.
3. Image intake plus the generation job pipeline.
4. The approval slider and the light edit step.
5. The Hub.
6. The Lab Cart and checkout.
7. Paint math, mixing mode, and verified-recipe saving.
8. Stock management with the container animation.
9. The public landing page and brand motion polish.

## 12. Open decisions (your call)

1. **Phase 2 customer model.** Three options, very different products: (a) keep it internal and sell finished kits elsewhere, (b) a public storefront browsing your pre-made pieces, (c) self-serve where customers upload their own photo for a custom kit (a proven niche, and it shifts copyright risk onto the uploader via terms of service). Phase 1 does not depend on this, but it shapes Phase 2.
2. **Payments.** Confirmed as out of scope for Phase 1 (cart is production batching). Revisit with the Phase 2 decision.
3. **Mixing accuracy ceiling.** Current plan is approximate recipes that you correct and save. Alternative is snapping every target color to a fixed stocked palette (more accurate, fewer mixing steps, more SKUs). Decide if and when the snap-to-palette path is worth it.
4. **Copyright.** Turning Pinterest or viral paintings into products you sell is a derivative-work risk. Not legal advice, but worth a real look before selling. The customer-upload model (option c above) is the cleanest way to move that risk off you.
5. **Canvas sizes.** Decide your preset canvas dimensions early, since they drive the minimum region size and the paint math.

## 13. Non-goals for Phase 1

No customer accounts. No customer uploads. No payment processing. No shipping or order management. No multi-operator teams. No mobile native app (responsive web only).
