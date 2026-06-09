import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import ColorChip from '../components/ui/ColorChip';
import IconButton from '../components/ui/IconButton';
import Spinner from '../components/ui/Spinner';
import { signedUrl } from '../lib/pieces';
import { useCart } from '../hooks/useCart';
import {
  CartItemWithPiece,
  RollupEntry,
  checkoutCart,
  getCartRollup,
  listCartItems,
  removeCartItem,
  setItemQuantity,
} from '../lib/cart';
import {
  BasePaint,
  ResolvedRecipe,
  Shortfall,
  buildRecipeDisplay,
  computeBaseUsage,
  fetchBasePaints,
  findShortfalls,
  resolveRecipes,
} from '../lib/recipes';

export default function LabCart() {
  const navigate = useNavigate();
  const { cartId, loading: cartLoading, refresh } = useCart();
  const [items, setItems] = useState<CartItemWithPiece[] | null>(null);
  const [rollup, setRollup] = useState<RollupEntry[]>([]);
  const [bases, setBases] = useState<BasePaint[]>([]);
  const [recipes, setRecipes] = useState<Map<string, ResolvedRecipe>>(new Map());
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);

  const reload = useCallback(async () => {
    if (!cartId) {
      setItems([]);
      setRollup([]);
      return;
    }
    try {
      const [is, ru, bs] = await Promise.all([
        listCartItems(cartId),
        getCartRollup(cartId),
        fetchBasePaints(),
      ]);
      setItems(is);
      setRollup(ru);
      setBases(bs);
      const rs = await resolveRecipes(
        ru.map((r) => r.rgbHex),
        bs,
      );
      setRecipes(rs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [cartId]);

  useEffect(() => {
    if (cartLoading) return;
    reload();
  }, [cartLoading, reload]);

  // Sign preview thumbs once items land.
  useEffect(() => {
    if (!items || items.length === 0) return;
    let cancelled = false;
    (async () => {
      const paths = items
        .map((i) => i.piece.preview_svg_path)
        .filter((p): p is string => Boolean(p));
      if (!paths.length) return;
      const next: Record<string, string> = {};
      await Promise.all(
        paths.map(async (path) => {
          try {
            const url = await signedUrl('piece-previews', path);
            next[path] = url;
          } catch {
            // skip — card will fall back to a placeholder
          }
        }),
      );
      if (!cancelled) setThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  async function changeQty(itemId: string, q: number) {
    setBusy(itemId);
    try {
      await setItemQuantity(itemId, q);
      await reload();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function remove(itemId: string) {
    setBusy(itemId);
    try {
      await removeCartItem(itemId);
      await reload();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  async function onCheckout() {
    if (!cartId) return;
    setCheckoutBusy(true);
    setError(null);
    try {
      const { taskCount } = await checkoutCart(cartId);
      await refresh();
      if (taskCount === 0) {
        setError('Cart had no colors to mix. Nothing to do.');
        setCheckoutBusy(false);
        return;
      }
      // Stock was deducted; the batch is now logged. Land on History.
      navigate('/app/history');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCheckoutBusy(false);
    }
  }

  const totalMl = useMemo(() => rollup.reduce((a, r) => a + r.totalMl, 0), [rollup]);

  // PRD §7: at checkout, compare required base-paint volumes against
  // current_level_ml and surface a low-stock warning naming the color
  // and the shortfall.
  const shortfalls: Shortfall[] = useMemo(() => {
    if (!rollup.length || !bases.length || !recipes.size) return [];
    const usage = computeBaseUsage(
      rollup.map((r) => ({ rgbHex: r.rgbHex, volumeMl: r.totalMl })),
      recipes,
      bases,
    );
    return findShortfalls(usage, bases);
  }, [rollup, recipes, bases]);

  if (cartLoading || items === null) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-container-lg flex flex-col gap-6">
      <header>
        <span className="pl-label text-mustard-soft">Lab Cart</span>
        <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">
          What we're making
        </h1>
        <p className="text-cream-200 mt-1">
          A production batch. Checkout doesn't sell anything. It produces the consolidated paint
          plan for the Lab.
        </p>
      </header>

      {error && (
        <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-3">
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <Card>
          <CardEyebrow>Cart is empty</CardEyebrow>
          <p className="text-text-on-light mt-2">
            Browse the Hub and add a few pieces to plan a batch.
          </p>
          <div className="mt-4">
            <Link to="/app/hub">
              <Button>Open the Hub</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          <div className="flex flex-col gap-4">
            {items.map((it) => (
              <CartRow
                key={it.id}
                item={it}
                thumb={
                  it.piece.preview_svg_path ? thumbs[it.piece.preview_svg_path] ?? null : null
                }
                busy={busy === it.id}
                onQty={(q) => changeQty(it.id, q)}
                onRemove={() => remove(it.id)}
              />
            ))}
          </div>

          <aside className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardEyebrow>Batch palette</CardEyebrow>
                <CardTitle>
                  {rollup.length} color{rollup.length === 1 ? '' : 's'} · {Math.ceil(totalMl)} ml
                </CardTitle>
              </CardHeader>
              <p className="text-text-on-light text-sm mb-3">
                Grouped across pieces. Hover any swatch for the recipe.
              </p>
              <div className="grid grid-cols-4 gap-3">
                {rollup.map((r) => {
                  const resolved = recipes.get(r.rgbHex) ?? null;
                  const display = resolved
                    ? buildRecipeDisplay(resolved.steps, r.totalMl, bases, {
                        kind: resolved.kind,
                        row: resolved.row,
                        matchedHex: resolved.matchedHex,
                      })
                    : null;
                  return (
                    <ColorChip
                      key={r.rgbHex}
                      hex={r.rgbHex}
                      totalMl={r.totalMl}
                      size="md"
                      recipe={display}
                      recipeRow={resolved?.row ?? null}
                      bases={bases}
                    />
                  );
                })}
              </div>
            </Card>

            {shortfalls.length > 0 && (
              <Card className="!bg-terracotta-soft">
                <CardHeader>
                  <CardEyebrow>Low stock warning</CardEyebrow>
                  <CardTitle>
                    {shortfalls.length} base{shortfalls.length === 1 ? '' : 's'} below the batch
                  </CardTitle>
                </CardHeader>
                <ul className="flex flex-col gap-2">
                  {shortfalls.map(({ base, neededMl, shortMl }) => (
                    <li
                      key={base.id}
                      className="flex items-center gap-2 text-text-on-light text-sm"
                    >
                      <span
                        className="h-4 w-4 rounded-full border border-ink-900 shrink-0"
                        style={{ background: base.rgb_hex }}
                      />
                      <span className="flex-1 truncate font-display font-bold">{base.name}</span>
                      <span className="font-mono text-xs whitespace-nowrap">
                        need {neededMl.toFixed(1)} ml · short {shortMl.toFixed(1)} ml
                      </span>
                    </li>
                  ))}
                </ul>
                <div className="mt-3">
                  <Link to="/app/stock" className="pl-label text-ink-900 hover:underline">
                    → top up in Stock
                  </Link>
                </div>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardEyebrow>Checkout</CardEyebrow>
                <CardTitle>Open the Lab</CardTitle>
              </CardHeader>
              <p className="text-text-on-light text-sm mb-4">
                Locks the cart, generates one mix task per target color, and drops you in mixing
                mode.
              </p>
              <Button
                size="lg"
                onClick={onCheckout}
                loading={checkoutBusy}
                disabled={rollup.length === 0}
                className="w-full"
              >
                Check out batch
              </Button>
              {shortfalls.length > 0 && (
                <p className="pl-label text-text-on-light-muted mt-3">
                  Checking out anyway is fine. Top up before you mix, or accept the shortfall.
                </p>
              )}
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}

function CartRow({
  item,
  thumb,
  busy,
  onQty,
  onRemove,
}: {
  item: CartItemWithPiece;
  thumb: string | null;
  busy: boolean;
  onQty: (q: number) => void;
  onRemove: () => void;
}) {
  return (
    <Card paper sticker>
      <div className="flex items-center gap-4">
        <Link
          to={`/app/piece/${item.piece.id}`}
          className="shrink-0 h-24 w-24 rounded-md overflow-hidden border-thick border-ink-900 bg-cream-50"
        >
          {thumb ? (
            <img src={thumb} alt={item.piece.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full grid place-items-center">
              <Spinner size="sm" />
            </div>
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-text-on-light text-h3 truncate">
            {item.piece.title}
          </div>
          <div className="pl-label text-text-on-light-muted mt-1">
            {item.piece.complexity} · {item.piece.color_count} colors ·{' '}
            {item.piece.canvas_width_cm}×{item.piece.canvas_height_cm} cm · {item.piece.coats} coats
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <IconButton
            label="Decrease quantity"
            size="sm"
            variant="ghost"
            disabled={busy || item.quantity <= 1}
            onClick={() => onQty(item.quantity - 1)}
          >
            −
          </IconButton>
          <span className="font-mono font-bold w-6 text-center text-cream-50">
            {item.quantity}
          </span>
          <IconButton
            label="Increase quantity"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onQty(item.quantity + 1)}
          >
            +
          </IconButton>
          <IconButton
            label="Remove from cart"
            size="sm"
            variant="tertiary"
            disabled={busy}
            onClick={onRemove}
          >
            ×
          </IconButton>
        </div>
      </div>
    </Card>
  );
}
