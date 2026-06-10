// =============================================================
// Painto's Lab — base paint stock helpers
// PRD §9.8: container is the source of truth. Top-ups, edits,
// and shortfall checks all flow through here.
// =============================================================

import { supabase } from './supabase';
import type { Tables } from '../types/db';
import {
  BASIC_ACRYLICS,
  STARTER_CONTAINER_ML,
  STARTER_REORDER_ML,
} from './basePaints';

export type BasePaint = Tables<'base_paints'>;

/**
 * Insert the basic acrylic starter set as placeholders. Idempotent:
 * `name` is unique, so re-running skips paints already on the shelf.
 * Returns how many new paints were added.
 */
export async function seedStarterPaints(): Promise<number> {
  const rows = BASIC_ACRYLICS.map((p) => ({
    name: p.name,
    rgb_hex: p.rgb_hex,
    container_capacity_ml: STARTER_CONTAINER_ML,
    current_level_ml: STARTER_CONTAINER_ML,
    reorder_threshold_ml: STARTER_REORDER_ML,
  }));
  const { data, error } = await supabase
    .from('base_paints')
    .upsert(rows, { onConflict: 'name', ignoreDuplicates: true })
    .select('id');
  if (error) throw error;
  return data?.length ?? 0;
}

export async function listBasePaints(): Promise<BasePaint[]> {
  const { data, error } = await supabase
    .from('base_paints')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export interface BasePaintInput {
  name: string;
  rgb_hex: string;
  container_capacity_ml: number;
  current_level_ml: number;
  reorder_threshold_ml: number;
}

export async function createBasePaint(input: BasePaintInput): Promise<BasePaint> {
  const { data, error } = await supabase
    .from('base_paints')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateBasePaint(id: string, patch: Partial<BasePaintInput>): Promise<void> {
  const { error } = await supabase.from('base_paints').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteBasePaint(id: string): Promise<void> {
  const { error } = await supabase.from('base_paints').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Add ml to a base paint's current level. Capped at container_capacity_ml
 * so a slip of the keyboard never reports more paint than physically fits.
 */
export async function topUpBasePaint(id: string, addMl: number): Promise<BasePaint> {
  const { data: current, error: getErr } = await supabase
    .from('base_paints')
    .select('current_level_ml, container_capacity_ml')
    .eq('id', id)
    .single();
  if (getErr) throw getErr;
  const next = Math.min(
    current.container_capacity_ml,
    Math.max(0, current.current_level_ml + addMl),
  );
  const { data, error } = await supabase
    .from('base_paints')
    .update({ current_level_ml: Math.round(next * 100) / 100 })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export function isLowStock(b: BasePaint): boolean {
  return b.current_level_ml <= b.reorder_threshold_ml;
}

export interface ReorderItem {
  base: BasePaint;
  /** ml the current cart batch demands of this base (0 if none). */
  cartNeedMl: number;
  /** Recommended amount to buy, in ml (rounded up). */
  buyMl: number;
  /** Why it's on the list: below reorder threshold and/or short for the batch. */
  reasons: Array<'low' | 'batch'>;
}

/**
 * Build a consolidated shopping list. A base lands on it if it's below its
 * reorder threshold OR the current cart batch needs more than is in stock.
 * Recommended buy refills to the container capacity, or to the batch demand
 * if that's larger. `cartUsage` is ml-per-base for the open cart (empty Map
 * if there's no cart).
 */
export function buildReorderList(
  bases: BasePaint[],
  cartUsage: Map<string, number>,
): ReorderItem[] {
  const items: ReorderItem[] = [];
  for (const base of bases) {
    const need = cartUsage.get(base.id) ?? 0;
    const low = base.current_level_ml <= base.reorder_threshold_ml;
    const short = need > base.current_level_ml;
    if (!low && !short) continue;
    const target = Math.max(base.container_capacity_ml, need);
    const buyMl = Math.max(0, Math.ceil(target - base.current_level_ml));
    if (buyMl <= 0) continue;
    const reasons: Array<'low' | 'batch'> = [];
    if (low) reasons.push('low');
    if (short) reasons.push('batch');
    items.push({ base, cartNeedMl: need, buyMl, reasons });
  }
  return items.sort((a, b) => b.buyMl - a.buyMl);
}
