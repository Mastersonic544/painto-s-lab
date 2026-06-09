// =============================================================
// Painto's Lab — base paint stock helpers
// PRD §9.8: container is the source of truth. Top-ups, edits,
// and shortfall checks all flow through here.
// =============================================================

import { supabase } from './supabase';
import type { Tables } from '../types/db';

export type BasePaint = Tables<'base_paints'>;

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
