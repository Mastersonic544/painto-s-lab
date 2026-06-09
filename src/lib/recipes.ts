// =============================================================
// Painto's Lab — recipe resolution + mix-task completion
// PRD §7: completing a mix task decrements the consumed base
// paints from stock. PRD §8: recipes are stored as parts OR ml;
// we resolve to actual ml at a given target volume so the math
// is portable.
// =============================================================

import { supabase } from './supabase';
import type { RecipeJson, RecipeStep, Tables } from '../types/db';

export type BasePaint = Tables<'base_paints'>;
export type ColorRecipe = Tables<'color_recipes'>;
export type MixTask = Tables<'mix_tasks'>;

export interface ResolvedStep {
  base_paint_id: string;
  ml: number;
}

/**
 * Resolve a stored recipe into per-base-paint ml at a specific target
 * volume. Two stored formats are accepted:
 *   - parts:  ratios. The output ml respects the ratio so the operator
 *             can scale to any target. (the natural form for "1 part red,
 *             2 parts white" style recipes)
 *   - ml:     literal volumes. The recipe's yield is the sum; we scale
 *             to the requested target so the ratio is preserved.
 * Mixed (some parts, some ml) is treated as parts on the steps that have
 * them and silently zero on the steps that don't.
 */
export function resolveRecipeSteps(steps: RecipeJson, targetMl: number): ResolvedStep[] {
  if (!Array.isArray(steps) || steps.length === 0 || targetMl <= 0) return [];

  const allHaveParts = steps.every((s) => typeof s.parts === 'number' && s.parts >= 0);
  if (allHaveParts) {
    const totalParts = steps.reduce((a, s) => a + (s.parts ?? 0), 0);
    if (totalParts <= 0) return [];
    return steps.map((s) => ({
      base_paint_id: s.base_paint_id,
      ml: ((s.parts ?? 0) / totalParts) * targetMl,
    }));
  }

  const totalMl = steps.reduce((a, s) => a + (s.ml ?? s.parts ?? 0), 0);
  if (totalMl <= 0) return [];
  const scale = targetMl / totalMl;
  return steps.map((s) => ({
    base_paint_id: s.base_paint_id,
    ml: (s.ml ?? s.parts ?? 0) * scale,
  }));
}

/** A friendlier shape for UI rendering — joins each step to its base paint name. */
export interface RecipeDisplay {
  totalMl: number;
  steps: Array<ResolvedStep & { base?: BasePaint }>;
  /** True iff every step references a known base_paint id. */
  resolvable: boolean;
}

export function buildRecipeDisplay(
  steps: RecipeJson,
  targetMl: number,
  bases: BasePaint[],
): RecipeDisplay {
  const byId = new Map(bases.map((b) => [b.id, b]));
  const resolved = resolveRecipeSteps(steps, targetMl);
  const joined = resolved.map((r) => ({ ...r, base: byId.get(r.base_paint_id) }));
  return {
    totalMl: targetMl,
    steps: joined,
    resolvable: joined.every((s) => Boolean(s.base)),
  };
}

/**
 * Mark a mix task done and decrement the consumed base paints from stock.
 * If the task has no recipe attached, we just flip the status — there's
 * nothing to decrement yet.
 *
 * Not transactional. Supabase doesn't expose a multi-row atomic RPC out
 * of the box and the rare partial-failure case here is non-corrupting
 * (operator can edit stock manually). If atomicity becomes load-bearing
 * later, wrap this in a SECURITY DEFINER plpgsql RPC.
 */
export async function completeMixTask(taskId: string): Promise<void> {
  const { data: task, error: tErr } = await supabase
    .from('mix_tasks')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!task) throw new Error('Mix task not found');
  if (task.status === 'done') return; // idempotent

  if (task.recipe_id) {
    const { data: recipe, error: rErr } = await supabase
      .from('color_recipes')
      .select('*')
      .eq('id', task.recipe_id)
      .maybeSingle();
    if (rErr) throw rErr;
    if (recipe) {
      const steps = resolveRecipeSteps(recipe.recipe_json, task.target_volume_ml);
      const ids = [...new Set(steps.map((s) => s.base_paint_id))];
      if (ids.length) {
        const { data: bases, error: bErr } = await supabase
          .from('base_paints')
          .select('id, current_level_ml')
          .in('id', ids);
        if (bErr) throw bErr;
        const levelById = new Map((bases ?? []).map((b) => [b.id, b.current_level_ml]));
        // Aggregate ml-per-base before writing so steps that repeat a base
        // (rare but allowed) are summed once.
        const usageById = new Map<string, number>();
        for (const s of steps) {
          usageById.set(s.base_paint_id, (usageById.get(s.base_paint_id) ?? 0) + s.ml);
        }
        for (const [baseId, ml] of usageById) {
          const cur = levelById.get(baseId) ?? 0;
          const next = Math.max(0, cur - ml);
          const { error } = await supabase
            .from('base_paints')
            .update({ current_level_ml: Math.round(next * 100) / 100 })
            .eq('id', baseId);
          if (error) throw error;
        }
      }
    }
  }

  const { error } = await supabase
    .from('mix_tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) throw error;
}

/** Reopen a completed mix task. Does NOT refund stock — operator has
 *  already poured the paint. */
export async function reopenMixTask(taskId: string): Promise<void> {
  const { error } = await supabase
    .from('mix_tasks')
    .update({ status: 'todo', completed_at: null })
    .eq('id', taskId);
  if (error) throw error;
}

/** Save a recipe for a target color. Reuses the row if one exists. */
export async function upsertRecipe(args: {
  targetRgbHex: string;
  steps: RecipeStep[];
  isVerified: boolean;
  notes?: string;
}): Promise<ColorRecipe> {
  const { data: existing, error: lookupErr } = await supabase
    .from('color_recipes')
    .select('*')
    .eq('target_rgb_hex', args.targetRgbHex)
    .maybeSingle();
  if (lookupErr) throw lookupErr;

  if (existing) {
    const { data, error } = await supabase
      .from('color_recipes')
      .update({
        recipe_json: args.steps,
        is_verified: args.isVerified,
        notes: args.notes ?? existing.notes,
      })
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }
  const { data, error } = await supabase
    .from('color_recipes')
    .insert({
      target_rgb_hex: args.targetRgbHex,
      recipe_json: args.steps,
      is_verified: args.isVerified,
      notes: args.notes ?? null,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function fetchRecipesByHex(hexes: string[]): Promise<Map<string, ColorRecipe>> {
  if (hexes.length === 0) return new Map();
  const { data, error } = await supabase
    .from('color_recipes')
    .select('*')
    .in('target_rgb_hex', hexes);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.target_rgb_hex, r]));
}

export async function fetchBasePaints(): Promise<BasePaint[]> {
  const { data, error } = await supabase
    .from('base_paints')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchMixTasks(cartId: string): Promise<MixTask[]> {
  const { data, error } = await supabase
    .from('mix_tasks')
    .select('*')
    .eq('cart_id', cartId)
    .order('target_volume_ml', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
