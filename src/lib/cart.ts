import { supabase } from './supabase';
import type { Tables } from '../types/db';

export type Cart = Tables<'carts'>;
export type CartItem = Tables<'cart_items'>;

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
