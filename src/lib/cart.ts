import { supabase } from './supabase';
import { consumeBaseStock } from './recipes';
import type { Tables } from '../types/db';

export type Cart = Tables<'carts'>;
export type CartItem = Tables<'cart_items'>;
export type Piece = Tables<'pieces'>;
export type PieceColor = Tables<'piece_colors'>;

export interface CartItemWithPiece {
  id: string;
  cart_id: string;
  piece_id: string;
  quantity: number;
  piece: Piece;
}

export interface RollupEntry {
  rgbHex: string;
  totalMl: number;
  /** Per-piece contribution for the tooltip ("48ml from Mossy heron × 2"). */
  contributions: Array<{ pieceId: string; title: string; quantity: number; ml: number }>;
}

/**
 * Phase 1 is single-tenant — one open cart at a time. If none exists, make
 * one. Returns the cart row so callers can stash the id.
 */
export async function getOrCreateOpenCart(): Promise<Cart> {
  const { data: existing, error: fetchErr } = await supabase
    .from('carts')
    .select('*')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (existing) return existing;

  const { data: created, error: insertErr } = await supabase
    .from('carts')
    .insert({ name: 'Lab Cart', status: 'open' })
    .select('*')
    .single();
  if (insertErr) throw insertErr;
  return created;
}

/**
 * Add a piece to the open cart. If it's already in the cart, bump the
 * quantity. cart_items has a UNIQUE(cart_id, piece_id) constraint so this
 * stays one row per piece.
 */
export async function addPieceToCart(pieceId: string): Promise<void> {
  const cart = await getOrCreateOpenCart();
  // Try to read the current row; if present, bump quantity. Otherwise
  // insert a new row at quantity 1.
  const { data: existing, error: lookupErr } = await supabase
    .from('cart_items')
    .select('id, quantity')
    .eq('cart_id', cart.id)
    .eq('piece_id', pieceId)
    .maybeSingle();
  if (lookupErr) throw lookupErr;

  if (existing) {
    const { error } = await supabase
      .from('cart_items')
      .update({ quantity: existing.quantity + 1 })
      .eq('id', existing.id);
    if (error) throw error;
    return;
  }

  const { error: insertErr } = await supabase
    .from('cart_items')
    .insert({ cart_id: cart.id, piece_id: pieceId, quantity: 1 });
  if (insertErr) throw insertErr;
}

/** Items in the open cart, joined to the pieces row. Empty if none. */
export async function listCartItems(cartId: string): Promise<CartItemWithPiece[]> {
  // Two-step fetch keeps the typed Database happy without a synthesized
  // relationship — we don't declare cart_items.piece_id as a FK in the
  // Database type, so a single-shot embed would type as never.
  const { data: items, error: itemsErr } = await supabase
    .from('cart_items')
    .select('*')
    .eq('cart_id', cartId);
  if (itemsErr) throw itemsErr;
  if (!items?.length) return [];

  const pieceIds = items.map((i) => i.piece_id);
  const { data: pieces, error: piecesErr } = await supabase
    .from('pieces')
    .select('*')
    .in('id', pieceIds);
  if (piecesErr) throw piecesErr;
  const byId = new Map((pieces ?? []).map((p) => [p.id, p]));

  return items
    .map((i) => {
      const piece = byId.get(i.piece_id);
      if (!piece) return null;
      return {
        id: i.id,
        cart_id: i.cart_id,
        piece_id: i.piece_id,
        quantity: i.quantity,
        piece,
      };
    })
    .filter((x): x is CartItemWithPiece => x !== null);
}

export async function setItemQuantity(itemId: string, quantity: number): Promise<void> {
  const q = Math.max(1, Math.min(99, Math.round(quantity)));
  const { error } = await supabase.from('cart_items').update({ quantity: q }).eq('id', itemId);
  if (error) throw error;
}

export async function removeCartItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('cart_items').delete().eq('id', itemId);
  if (error) throw error;
}

/**
 * Roll up every color needed across the cart, grouped by target hex.
 * Source of truth is piece_colors.estimated_volume_ml (already rounded up
 * with the safety margin at generation time per PRD §7). Quantities scale
 * linearly; we round each total up to 0.01ml so totals never under-report.
 */
export async function getCartRollup(cartId: string): Promise<RollupEntry[]> {
  const items = await listCartItems(cartId);
  if (!items.length) return [];
  const pieceIds = items.map((i) => i.piece_id);

  const { data: colors, error } = await supabase
    .from('piece_colors')
    .select('*')
    .in('piece_id', pieceIds);
  if (error) throw error;

  const itemByPiece = new Map(items.map((i) => [i.piece_id, i]));
  const byHex = new Map<string, RollupEntry>();

  for (const c of colors ?? []) {
    const item = itemByPiece.get(c.piece_id);
    if (!item) continue;
    const ml = c.estimated_volume_ml * item.quantity;
    const entry = byHex.get(c.rgb_hex) ?? {
      rgbHex: c.rgb_hex,
      totalMl: 0,
      contributions: [],
    };
    entry.totalMl += ml;
    entry.contributions.push({
      pieceId: item.piece_id,
      title: item.piece.title,
      quantity: item.quantity,
      ml,
    });
    byHex.set(c.rgb_hex, entry);
  }

  // Round each total up. PRD §7: over-estimating means nobody runs out
  // mid-piece.
  const rounded: RollupEntry[] = [];
  for (const v of byHex.values()) {
    rounded.push({ ...v, totalMl: Math.ceil(v.totalMl * 100) / 100 });
  }
  rounded.sort((a, b) => b.totalMl - a.totalMl);
  return rounded;
}

/**
 * Flip the cart to checked_out and generate one mix_tasks row per target
 * color. If a verified recipe exists for a hex, link it; otherwise leave
 * recipe_id null and the operator gets to author it in mixing mode.
 */
export async function checkoutCart(cartId: string): Promise<{ taskCount: number }> {
  // Only the first checkout consumes stock; a re-checkout must not deduct again.
  const { data: cartRow, error: cartErr } = await supabase
    .from('carts')
    .select('status')
    .eq('id', cartId)
    .maybeSingle();
  if (cartErr) throw cartErr;
  const firstCheckout = cartRow?.status !== 'checked_out';

  const rollup = await getCartRollup(cartId);
  const hexes = rollup.map((r) => r.rgbHex);

  let recipeByHex = new Map<string, string>();
  if (hexes.length) {
    const { data: recipes, error } = await supabase
      .from('color_recipes')
      .select('id, target_rgb_hex')
      .in('target_rgb_hex', hexes);
    if (error) throw error;
    recipeByHex = new Map((recipes ?? []).map((r) => [r.target_rgb_hex, r.id]));
  }

  // Idempotent: re-checkout drops the prior task set first.
  const del = await supabase.from('mix_tasks').delete().eq('cart_id', cartId);
  if (del.error) throw del.error;

  if (rollup.length) {
    const rows = rollup.map((r) => ({
      cart_id: cartId,
      target_rgb_hex: r.rgbHex,
      target_volume_ml: r.totalMl,
      recipe_id: recipeByHex.get(r.rgbHex) ?? null,
      status: 'todo' as const,
    }));
    const ins = await supabase.from('mix_tasks').insert(rows);
    if (ins.error) throw ins.error;
  }

  // Drop the batch's paint from stock now (resolves recipes, accounts for
  // mixed colors). Shortfalls were already surfaced in the cart pre-checkout.
  if (firstCheckout && rollup.length) {
    await consumeBaseStock(rollup.map((r) => ({ rgbHex: r.rgbHex, volumeMl: r.totalMl })));
  }

  const upd = await supabase
    .from('carts')
    .update({ status: 'checked_out', checked_out_at: new Date().toISOString() })
    .eq('id', cartId);
  if (upd.error) throw upd.error;

  return { taskCount: rollup.length };
}

export interface BatchHistoryEntry {
  cart: Cart;
  items: CartItemWithPiece[];
  colorCount: number;
  totalMl: number;
}

/**
 * Past batches: every checked-out cart, newest first, with its pieces and a
 * rolled-up color count + total ml. Derived from existing data — no separate
 * history table, since a checked-out cart is already an immutable record.
 */
export async function listCheckoutHistory(): Promise<BatchHistoryEntry[]> {
  const { data: carts, error } = await supabase
    .from('carts')
    .select('*')
    .eq('status', 'checked_out')
    .order('checked_out_at', { ascending: false });
  if (error) throw error;

  const out: BatchHistoryEntry[] = [];
  for (const cart of carts ?? []) {
    const [items, rollup] = await Promise.all([listCartItems(cart.id), getCartRollup(cart.id)]);
    out.push({
      cart,
      items,
      colorCount: rollup.length,
      totalMl: Math.ceil(rollup.reduce((a, r) => a + r.totalMl, 0)),
    });
  }
  return out;
}

/** Sum of quantities in the open cart, 0 if none. */
export async function getOpenCartCount(): Promise<{ cartId: string | null; count: number }> {
  const { data: cart, error: cartErr } = await supabase
    .from('carts')
    .select('id')
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cartErr) throw cartErr;
  if (!cart) return { cartId: null, count: 0 };

  const { data: items, error: itemsErr } = await supabase
    .from('cart_items')
    .select('quantity')
    .eq('cart_id', cart.id);
  if (itemsErr) throw itemsErr;
  const count = (items ?? []).reduce((sum, i) => sum + (i.quantity ?? 0), 0);
  return { cartId: cart.id, count };
}
