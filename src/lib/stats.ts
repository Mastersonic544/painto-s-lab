// =============================================================
// Painto's Lab — dashboard stats
// Rolls up pieces, production batches (checked-out carts) and paint
// usage into the KPIs an operator needs to make decisions.
// =============================================================

import { supabase } from './supabase';
import { getCartRollup, listCartItems } from './cart';
import { computeBaseUsage, fetchBasePaints, resolveRecipes } from './recipes';
import type { PieceStatus } from '../types/db';

export interface DashboardStats {
  totalPieces: number;
  statusCounts: Partial<Record<PieceStatus, number>>;
  batches: number;
  /** Total target-paint planned across all production batches (ml). */
  totalPaintMl: number;
  /** Most-produced pieces by quantity across batches. */
  topPieces: Array<{ id: string; title: string; qty: number }>;
  /** Most-demanded target colors across batches (ml). */
  topColors: Array<{ hex: string; ml: number }>;
  /** Base-paint consumption across batches, resolved through recipes (ml). */
  paintByBase: Array<{ name: string; rgb_hex: string; ml: number }>;
  stock: { totalCurrentMl: number; totalCapacityMl: number; lowCount: number; bases: number };
}

export async function loadDashboardStats(): Promise<DashboardStats> {
  const [{ data: pieces }, { data: carts }, bases] = await Promise.all([
    supabase.from('pieces').select('id,title,status'),
    supabase.from('carts').select('id').eq('status', 'checked_out'),
    fetchBasePaints(),
  ]);

  const statusCounts: Partial<Record<PieceStatus, number>> = {};
  for (const p of pieces ?? []) {
    statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
  }
  const titleById = new Map((pieces ?? []).map((p) => [p.id, p.title]));

  const cartIds = (carts ?? []).map((c) => c.id);
  const qtyByPiece = new Map<string, number>();
  const mlByHex = new Map<string, number>();
  const usageByBase = new Map<string, number>();
  let totalPaintMl = 0;

  for (const cartId of cartIds) {
    const [items, rollup] = await Promise.all([listCartItems(cartId), getCartRollup(cartId)]);
    for (const it of items) {
      qtyByPiece.set(it.piece_id, (qtyByPiece.get(it.piece_id) ?? 0) + it.quantity);
    }
    for (const r of rollup) {
      mlByHex.set(r.rgbHex, (mlByHex.get(r.rgbHex) ?? 0) + r.totalMl);
      totalPaintMl += r.totalMl;
    }
    const recipes = await resolveRecipes(
      rollup.map((r) => r.rgbHex),
      bases,
    );
    const usage = computeBaseUsage(
      rollup.map((r) => ({ rgbHex: r.rgbHex, volumeMl: r.totalMl })),
      recipes,
      bases,
    );
    for (const [id, ml] of usage) usageByBase.set(id, (usageByBase.get(id) ?? 0) + ml);
  }

  const topPieces = [...qtyByPiece.entries()]
    .map(([id, qty]) => ({ id, title: titleById.get(id) ?? 'Untitled', qty }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 6);

  const topColors = [...mlByHex.entries()]
    .map(([hex, ml]) => ({ hex, ml: Math.ceil(ml) }))
    .sort((a, b) => b.ml - a.ml)
    .slice(0, 8);

  const baseById = new Map(bases.map((b) => [b.id, b]));
  const paintByBase = [...usageByBase.entries()]
    .map(([id, ml]) => {
      const b = baseById.get(id);
      return { name: b?.name ?? 'Unknown', rgb_hex: b?.rgb_hex ?? '#888888', ml: Math.ceil(ml) };
    })
    .sort((a, b) => b.ml - a.ml)
    .slice(0, 8);

  return {
    totalPieces: (pieces ?? []).length,
    statusCounts,
    batches: cartIds.length,
    totalPaintMl: Math.ceil(totalPaintMl),
    topPieces,
    topColors,
    paintByBase,
    stock: {
      totalCurrentMl: Math.round(bases.reduce((a, b) => a + b.current_level_ml, 0)),
      totalCapacityMl: Math.round(bases.reduce((a, b) => a + b.container_capacity_ml, 0)),
      lowCount: bases.filter((b) => b.current_level_ml <= b.reorder_threshold_ml).length,
      bases: bases.length,
    },
  };
}
