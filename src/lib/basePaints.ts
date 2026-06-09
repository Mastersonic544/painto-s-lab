// =============================================================
// Painto's Lab — starter acrylic base paints
// A small, gamut-spanning set of acrylics used to (a) seed the
// base_paints table as placeholders and (b) drive the recipe
// estimate hover on the public landing page, where the real
// base_paints table isn't readable (operator RLS).
// =============================================================

import type { BasePaint } from './recipes';

export interface StarterPaint {
  name: string;
  rgb_hex: string;
}

// Primaries + white/black + a couple of earths give the estimator
// (nearest-3 RGB mix) enough range to sketch most targets.
export const BASIC_ACRYLICS: StarterPaint[] = [
  { name: 'Titanium White', rgb_hex: '#f7f7f2' },
  { name: 'Mars Black', rgb_hex: '#1b1b1b' },
  { name: 'Primary Yellow', rgb_hex: '#f5c518' },
  { name: 'Yellow Ochre', rgb_hex: '#c9a227' },
  { name: 'Cadmium Red', rgb_hex: '#d32e1f' },
  { name: 'Quinacridone Magenta', rgb_hex: '#9b2d5e' },
  { name: 'Ultramarine Blue', rgb_hex: '#2b3a8c' },
  { name: 'Phthalo Blue', rgb_hex: '#0b4f8a' },
  { name: 'Phthalo Green', rgb_hex: '#0b6b5b' },
  { name: 'Burnt Umber', rgb_hex: '#5a3a24' },
];

export const STARTER_CONTAINER_ML = 500;
export const STARTER_REORDER_ML = 100;

// Synthetic BasePaint[] for client-only recipe estimates (the public
// landing page). estimateRecipeFromBases / buildRecipeDisplay only read
// id, name and rgb_hex, so a minimal shape cast is safe here.
export const DEMO_BASES: BasePaint[] = BASIC_ACRYLICS.map((p, i) => ({
  id: `demo-${i}`,
  name: p.name,
  rgb_hex: p.rgb_hex,
  container_capacity_ml: STARTER_CONTAINER_ML,
  current_level_ml: STARTER_CONTAINER_ML,
  reorder_threshold_ml: STARTER_REORDER_ML,
  created_at: '',
})) as unknown as BasePaint[];
