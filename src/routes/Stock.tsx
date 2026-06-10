import { FormEvent, useCallback, useEffect, useState } from 'react';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import Dialog from '../components/ui/Dialog';
import IconButton from '../components/ui/IconButton';
import Input from '../components/ui/Input';
import LiquidContainer from '../components/ui/LiquidContainer';
import Spinner from '../components/ui/Spinner';
import { supabase } from '../lib/supabase';
import {
  BasePaint,
  BasePaintInput,
  ReorderItem,
  buildReorderList,
  createBasePaint,
  deleteBasePaint,
  isLowStock,
  listBasePaints,
  seedStarterPaints,
  topUpBasePaint,
  updateBasePaint,
} from '../lib/stock';
import { getCartRollup, getOpenCartCount } from '../lib/cart';
import { computeBaseUsage, resolveRecipes } from '../lib/recipes';

type DialogMode =
  | { kind: 'add' }
  | { kind: 'edit'; base: BasePaint }
  | { kind: 'topup'; base: BasePaint }
  | { kind: 'closed' };

export default function Stock() {
  const [bases, setBases] = useState<BasePaint[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogMode>({ kind: 'closed' });
  const [seeding, setSeeding] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [reorder, setReorder] = useState<ReorderItem[] | null>(null);

  async function openReorder() {
    setReorderOpen(true);
    setReorder(null); // loading
    setError(null);
    try {
      const list = bases ?? [];
      const usage = new Map<string, number>();
      const { cartId } = await getOpenCartCount();
      if (cartId && list.length) {
        const rollup = await getCartRollup(cartId);
        const recipes = await resolveRecipes(
          rollup.map((r) => r.rgbHex),
          list,
        );
        const u = computeBaseUsage(
          rollup.map((r) => ({ rgbHex: r.rgbHex, volumeMl: r.totalMl })),
          recipes,
          list,
        );
        for (const [k, v] of u) usage.set(k, v);
      }
      setReorder(buildReorderList(list, usage));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setReorderOpen(false);
    }
  }

  async function addStarterSet() {
    setSeeding(true);
    setError(null);
    try {
      await seedStarterPaints();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSeeding(false);
    }
  }

  const reload = useCallback(async () => {
    try {
      setBases(await listBasePaints());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Realtime: any change to base_paints reloads (covers Lab mixing
  // decrements landing here without a refresh).
  useEffect(() => {
    const channel = supabase
      .channel('stock')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'base_paints' },
        () => reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [reload]);

  const lowCount = (bases ?? []).filter(isLowStock).length;

  return (
    <div className="max-w-container-lg flex flex-col gap-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <span className="pl-label text-mustard-soft">Stock</span>
          <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">
            Base paints
          </h1>
          <p className="text-cream-200 mt-1 max-w-md">
            Every cartridge you stock. The level animates as you mix; top up to refill.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lowCount > 0 && (
            <Badge tone="terracotta">
              {lowCount} low · top up soon
            </Badge>
          )}
          <Button variant="ghost" onClick={openReorder} disabled={!bases}>
            Shopping list
          </Button>
          <Button variant="secondary" onClick={addStarterSet} loading={seeding}>
            + Starter set
          </Button>
          <Button onClick={() => setDialog({ kind: 'add' })}>+ Add base paint</Button>
        </div>
      </header>

      {error && (
        <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-3">
          {error}
        </div>
      )}

      {bases === null ? (
        <div className="min-h-[30vh] grid place-items-center">
          <Spinner size="lg" />
        </div>
      ) : bases.length === 0 ? (
        <EmptyState
          onAdd={() => setDialog({ kind: 'add' })}
          onSeed={addStarterSet}
          seeding={seeding}
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {bases.map((b) => (
            <StockCard
              key={b.id}
              base={b}
              onTopUp={() => setDialog({ kind: 'topup', base: b })}
              onEdit={() => setDialog({ kind: 'edit', base: b })}
              onDelete={async () => {
                if (!confirm(`Remove ${b.name} from stock?`)) return;
                try {
                  await deleteBasePaint(b.id);
                  reload();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
          ))}
        </div>
      )}

      {dialog.kind === 'add' && (
        <BasePaintFormDialog
          title="New base paint"
          initial={{
            name: '',
            rgb_hex: '#0d3d3a',
            container_capacity_ml: 500,
            current_level_ml: 500,
            reorder_threshold_ml: 100,
          }}
          onClose={() => setDialog({ kind: 'closed' })}
          onSubmit={async (input) => {
            await createBasePaint(input);
            await reload();
          }}
        />
      )}
      {dialog.kind === 'edit' && (
        <BasePaintFormDialog
          title={`Edit ${dialog.base.name}`}
          initial={{
            name: dialog.base.name,
            rgb_hex: dialog.base.rgb_hex,
            container_capacity_ml: dialog.base.container_capacity_ml,
            current_level_ml: dialog.base.current_level_ml,
            reorder_threshold_ml: dialog.base.reorder_threshold_ml,
          }}
          onClose={() => setDialog({ kind: 'closed' })}
          onSubmit={async (patch) => {
            await updateBasePaint(dialog.base.id, patch);
            await reload();
          }}
        />
      )}
      {dialog.kind === 'topup' && (
        <TopUpDialog
          base={dialog.base}
          onClose={() => setDialog({ kind: 'closed' })}
          onSubmit={async (ml) => {
            await topUpBasePaint(dialog.base.id, ml);
            await reload();
          }}
        />
      )}

      <Dialog
        open={reorderOpen}
        onClose={() => setReorderOpen(false)}
        title="Shopping list"
        description="Base paints to restock — anything low, plus what the current cart batch will run short on."
        footer={
          <>
            <Button variant="ghost" onClick={() => setReorderOpen(false)}>
              Close
            </Button>
            <Button
              onClick={() => reorder && printShoppingList(reorder)}
              disabled={!reorder || reorder.length === 0}
            >
              Print / Save PDF
            </Button>
          </>
        }
      >
        {reorder === null ? (
          <div className="py-8 grid place-items-center">
            <Spinner size="md" />
          </div>
        ) : reorder.length === 0 ? (
          <p className="text-text-on-light">Everything's stocked. Nothing to buy right now.</p>
        ) : (
          <ul className="flex flex-col gap-2 max-h-[50vh] overflow-auto">
            {reorder.map((it) => (
              <li
                key={it.base.id}
                className="flex items-center gap-3 border-thick border-ink-900 rounded-md bg-cream-50 p-2"
              >
                <span
                  className="h-7 w-7 rounded-md border border-ink-900 shrink-0"
                  style={{ background: it.base.rgb_hex }}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-text-on-light truncate">
                    {it.base.name}
                  </div>
                  <div className="pl-label text-text-on-light-muted">
                    have {Math.round(it.base.current_level_ml)} / {it.base.container_capacity_ml} ml
                    {it.cartNeedMl > 0 && ` · batch needs ${Math.ceil(it.cartNeedMl)} ml`}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="font-mono font-bold text-text-on-light whitespace-nowrap">
                    buy ~{it.buyMl} ml
                  </span>
                  <div className="flex gap-1">
                    {it.reasons.includes('low') && (
                      <span className="pl-label bg-mustard-soft text-ink-900 rounded-pill px-2 py-0.5">
                        low
                      </span>
                    )}
                    {it.reasons.includes('batch') && (
                      <span className="pl-label bg-terracotta text-cream-50 rounded-pill px-2 py-0.5">
                        batch
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}

// Escape text interpolated into the print HTML.
function escHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

// Printable shopping list → the browser print dialog ("Save as PDF").
function printShoppingList(items: ReorderItem[]) {
  const rows = items
    .map(
      (it) => `<tr>
        <td><span class="sw" style="background:${escHtml(it.base.rgb_hex)}"></span></td>
        <td>${escHtml(it.base.name)}</td>
        <td class="mono">${escHtml(it.base.rgb_hex).toUpperCase()}</td>
        <td class="mono r">${Math.round(it.base.current_level_ml)} / ${it.base.container_capacity_ml} ml</td>
        <td class="mono r"><strong>${it.buyMl} ml</strong></td>
      </tr>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>Painto's Lab — shopping list</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, serif; color: #14140f; margin: 32px; }
  h1 { font-size: 22px; margin: 0 0 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 2px solid #14140f; padding: 8px 10px; text-align: left; font-size: 13px; }
  th { background: #eae6db; font-family: ui-monospace, monospace; text-transform: uppercase; letter-spacing: 1px; font-size: 11px; }
  .sw { display: inline-block; width: 30px; height: 20px; border: 2px solid #14140f; border-radius: 3px; }
  .mono { font-family: ui-monospace, monospace; }
  .r { text-align: right; }
  @media print { body { margin: 12mm; } }
</style></head><body>
  <h1>Painto's Lab — base paint shopping list</h1>
  <table>
    <thead><tr><th></th><th>Paint</th><th>Hex</th><th>In stock</th><th>Buy</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 150); };</script>
</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(html);
  w.document.close();
}

function StockCard({
  base,
  onTopUp,
  onEdit,
  onDelete,
}: {
  base: BasePaint;
  onTopUp: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pct = Math.max(
    0,
    Math.min(100, (base.current_level_ml / Math.max(1, base.container_capacity_ml)) * 100),
  );
  const low = isLowStock(base);
  return (
    <Card paper sticker className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardEyebrow>{base.rgb_hex.toUpperCase()}</CardEyebrow>
          <div className="font-display font-bold text-text-on-light text-h2 truncate">
            {base.name}
          </div>
        </div>
        {low && <Badge tone="terracotta">low stock</Badge>}
      </div>

      <div className="flex justify-center">
        {/* LiquidContainer's level transition uses --ease-drip, so any
            change to currentMl (top-up, mix decrement) animates. */}
        <LiquidContainer
          color={base.rgb_hex}
          label={base.name}
          capacityMl={base.container_capacity_ml}
          currentMl={base.current_level_ml}
          width={180}
        />
      </div>

      <div className="font-mono text-sm text-text-on-light flex justify-between">
        <span>
          {Math.round(base.current_level_ml)} / {Math.round(base.container_capacity_ml)} ml
        </span>
        <span className="text-text-on-light-muted">{pct.toFixed(0)}%</span>
      </div>
      <div className="pl-label text-text-on-light-muted">
        reorder at ≤ {Math.round(base.reorder_threshold_ml)} ml
      </div>

      <div className="flex gap-2 mt-1">
        <Button size="sm" onClick={onTopUp} className="flex-1">
          Top up
        </Button>
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <IconButton
          label={`Delete ${base.name}`}
          size="sm"
          variant="tertiary"
          onClick={onDelete}
        >
          ×
        </IconButton>
      </div>
    </Card>
  );
}

// ----- Dialogs ------------------------------------------------

function BasePaintFormDialog({
  title,
  initial,
  onClose,
  onSubmit,
}: {
  title: string;
  initial: BasePaintInput;
  onClose: () => void;
  onSubmit: (input: BasePaintInput) => Promise<void>;
}) {
  const [draft, setDraft] = useState<BasePaintInput>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!/^#[0-9a-f]{6}$/i.test(draft.rgb_hex)) {
      setError('Color must be a #rrggbb hex.');
      return;
    }
    if (draft.container_capacity_ml <= 0) {
      setError('Capacity must be > 0.');
      return;
    }
    if (draft.current_level_ml > draft.container_capacity_ml) {
      setError('Current level cannot exceed capacity.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        ...draft,
        name: draft.name.trim(),
        rgb_hex: draft.rgb_hex.toLowerCase(),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Name"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="Mustard"
        />
        <div className="flex flex-col gap-2">
          <span className="pl-label text-text-on-light-muted">Color</span>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={draft.rgb_hex}
              onChange={(e) =>
                setDraft((d) => ({ ...d, rgb_hex: e.target.value.toLowerCase() }))
              }
              className="h-12 w-16 rounded-md border-thick border-ink-900 bg-cream-50"
              aria-label="Color picker"
            />
            <Input
              value={draft.rgb_hex}
              onChange={(e) => setDraft((d) => ({ ...d, rgb_hex: e.target.value }))}
              className="font-mono"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Capacity"
            type="number"
            min={1}
            value={draft.container_capacity_ml}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                container_capacity_ml: Number(e.target.value) || 0,
              }))
            }
            trailingAddon="ml"
          />
          <Input
            label="Current level"
            type="number"
            min={0}
            value={draft.current_level_ml}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                current_level_ml: Math.max(0, Number(e.target.value) || 0),
              }))
            }
            trailingAddon="ml"
          />
        </div>
        <Input
          label="Reorder threshold"
          type="number"
          min={0}
          value={draft.reorder_threshold_ml}
          onChange={(e) =>
            setDraft((d) => ({
              ...d,
              reorder_threshold_ml: Math.max(0, Number(e.target.value) || 0),
            }))
          }
          trailingAddon="ml"
          hint="The cartridge flags low stock at or below this level."
        />
        {error && (
          <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-2 text-sm">
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

function TopUpDialog({
  base,
  onClose,
  onSubmit,
}: {
  base: BasePaint;
  onClose: () => void;
  onSubmit: (ml: number) => Promise<void>;
}) {
  const headroom = Math.max(0, base.container_capacity_ml - base.current_level_ml);
  const [ml, setMl] = useState<number>(Math.max(1, Math.round(headroom)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (ml <= 0) {
      setError('Top-up must be > 0 ml.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit(ml);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Top up ${base.name}`}
      description={`Headroom: ${headroom.toFixed(1)} ml (cap ${base.container_capacity_ml} ml).`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Add to cartridge
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input
          label="Add"
          type="number"
          min={1}
          value={ml}
          onChange={(e) => setMl(Math.max(0, Number(e.target.value) || 0))}
          trailingAddon="ml"
          hint="Anything over the headroom is clamped to capacity."
        />
        {error && (
          <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-2 text-sm">
            {error}
          </div>
        )}
      </form>
    </Dialog>
  );
}

function EmptyState({
  onAdd,
  onSeed,
  seeding,
}: {
  onAdd: () => void;
  onSeed: () => void;
  seeding: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardEyebrow>No base paints yet</CardEyebrow>
        <CardTitle>Stock the shelf</CardTitle>
      </CardHeader>
      <p className="text-text-on-light">
        Drop in the basic acrylic starter set to get going, or add your own. Recipes get sharper as
        you save more verified mixes.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <Button onClick={onSeed} loading={seeding}>
          + Add starter set
        </Button>
        <Button variant="ghost" onClick={onAdd}>
          Add one manually
        </Button>
      </div>
    </Card>
  );
}
