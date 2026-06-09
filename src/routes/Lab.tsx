import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import ColorChip from '../components/ui/ColorChip';
import { Tab, TabList, TabPanel, Tabs } from '../components/ui/Tabs';
import Spinner from '../components/ui/Spinner';
import LiquidContainer from '../components/ui/LiquidContainer';
import {
  BasePaint,
  MixTask,
  ResolvedRecipe,
  buildRecipeDisplay,
  completeMixTask,
  fetchBasePaints,
  fetchMixTasks,
  reopenMixTask,
  resolveRecipes,
  upsertRecipe,
} from '../lib/recipes';
import type { RecipeStep } from '../types/db';
import { supabase } from '../lib/supabase';
import type { Tables } from '../types/db';

type Cart = Tables<'carts'>;

export default function Lab() {
  const { cartId } = useParams<{ cartId: string }>();
  const [cart, setCart] = useState<Cart | null>(null);
  const [tasks, setTasks] = useState<MixTask[] | null>(null);
  const [recipes, setRecipes] = useState<Map<string, ResolvedRecipe>>(new Map());
  const [bases, setBases] = useState<BasePaint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!cartId) return;
    try {
      const [{ data: c, error: cErr }, ts, bs] = await Promise.all([
        supabase.from('carts').select('*').eq('id', cartId).maybeSingle(),
        fetchMixTasks(cartId),
        fetchBasePaints(),
      ]);
      if (cErr) throw cErr;
      setCart(c);
      setTasks(ts);
      setBases(bs);
      const hexes = ts.map((t) => t.target_rgb_hex);
      setRecipes(await resolveRecipes(hexes, bs));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [cartId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Realtime: any mix_tasks or base_paints change refreshes the lab.
  useEffect(() => {
    if (!cartId) return;
    const channel = supabase
      .channel(`lab:${cartId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mix_tasks', filter: `cart_id=eq.${cartId}` },
        () => reload(),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'base_paints' },
        () => reload(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [cartId, reload]);

  async function complete(taskId: string) {
    setBusyId(taskId);
    try {
      await completeMixTask(taskId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  async function reopen(taskId: string) {
    setBusyId(taskId);
    try {
      await reopenMixTask(taskId);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const summary = useMemo(() => {
    if (!tasks) return null;
    const total = tasks.length;
    const done = tasks.filter((t) => t.status === 'done').length;
    const ml = tasks.reduce((a, t) => a + t.target_volume_ml, 0);
    return { total, done, ml };
  }, [tasks]);

  if (!cartId) return <ErrorCard title="No cart" body="Open the lab from a checked-out cart." />;
  if (tasks === null || !cart) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="max-w-container-lg flex flex-col gap-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <span className="pl-label text-mustard-soft">The Lab</span>
          <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">
            {cart.name}
          </h1>
          <p className="text-cream-200 mt-1">
            {summary?.total ?? 0} colors · {summary?.done ?? 0} mixed ·{' '}
            {Math.ceil(summary?.ml ?? 0)} ml total
          </p>
        </div>
        <Link to="/app/cart" className="pl-label text-mustard-soft hover:underline">
          ← cart
        </Link>
      </header>

      {error && (
        <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-3">
          {error}
        </div>
      )}

      <Tabs defaultValue="sheet">
        <TabList>
          <Tab value="sheet">Color sheet</Tab>
          <Tab value="mixing">Mixing mode</Tab>
          <Tab value="stock">Stock impact</Tab>
        </TabList>

        <TabPanel value="sheet">
          <ColorSheet tasks={tasks} recipes={recipes} bases={bases} />
        </TabPanel>

        <TabPanel value="mixing">
          <MixingList
            tasks={tasks}
            recipes={recipes}
            bases={bases}
            busyId={busyId}
            onComplete={complete}
            onReopen={reopen}
            onReload={reload}
          />
        </TabPanel>

        <TabPanel value="stock">
          <StockImpact tasks={tasks} recipes={recipes} bases={bases} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

// ----- Color sheet view ---------------------------------------

function ColorSheet({
  tasks,
  recipes,
  bases,
}: {
  tasks: MixTask[];
  recipes: Map<string, ResolvedRecipe>;
  bases: BasePaint[];
}) {
  if (tasks.length === 0) {
    return (
      <Card>
        <CardEyebrow>Empty batch</CardEyebrow>
        <p className="text-text-on-light mt-2">No mix tasks for this cart.</p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardEyebrow>Full batch palette</CardEyebrow>
        <CardTitle>Every color across every piece</CardTitle>
      </CardHeader>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
        {tasks.map((t) => {
          const resolved = recipes.get(t.target_rgb_hex) ?? null;
          const display = resolved
            ? buildRecipeDisplay(resolved.steps, t.target_volume_ml, bases, {
                kind: resolved.kind,
                row: resolved.row,
                matchedHex: resolved.matchedHex,
              })
            : null;
          return (
            <div key={t.id} className="flex flex-col items-center gap-1">
              <ColorChip
                hex={t.target_rgb_hex}
                totalMl={t.target_volume_ml}
                size="lg"
                recipe={display}
                recipeRow={resolved?.row ?? null}
                bases={bases}
              />
              {t.status === 'done' && (
                <span className="pl-label bg-teal text-cream-50 rounded-pill px-2 py-0.5">
                  mixed
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ----- Mixing mode --------------------------------------------

function MixingList({
  tasks,
  recipes,
  bases,
  busyId,
  onComplete,
  onReopen,
  onReload,
}: {
  tasks: MixTask[];
  recipes: Map<string, ResolvedRecipe>;
  bases: BasePaint[];
  busyId: string | null;
  onComplete: (taskId: string) => void;
  onReopen: (taskId: string) => void;
  onReload: () => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3">
      {tasks.map((t) => {
        const resolved = recipes.get(t.target_rgb_hex) ?? null;
        const display = resolved
          ? buildRecipeDisplay(resolved.steps, t.target_volume_ml, bases, {
              kind: resolved.kind,
              row: resolved.row,
              matchedHex: resolved.matchedHex,
            })
          : null;
        return (
          <MixTaskRow
            key={t.id}
            task={t}
            resolved={resolved}
            display={display}
            bases={bases}
            busy={busyId === t.id}
            onComplete={() => onComplete(t.id)}
            onReopen={() => onReopen(t.id)}
            onReload={onReload}
          />
        );
      })}
    </div>
  );
}

function MixTaskRow({
  task,
  resolved,
  display,
  bases,
  busy,
  onComplete,
  onReopen,
  onReload,
}: {
  task: MixTask;
  resolved: ResolvedRecipe | null;
  display: ReturnType<typeof buildRecipeDisplay> | null;
  bases: BasePaint[];
  busy: boolean;
  onComplete: () => void;
  onReopen: () => void;
  onReload: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const done = task.status === 'done';
  const kindLine = resolved
    ? resolved.kind === 'verified-exact'
      ? 'verified'
      : resolved.kind === 'verified-near'
        ? `near match (${resolved.matchedHex?.toUpperCase()})`
        : resolved.kind === 'unverified-exact'
          ? 'saved, not yet verified'
          : 'estimate · adjust by eye'
    : 'no recipe yet';

  return (
    <Card paper sticker className={done ? 'opacity-80' : ''}>
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-pressed={done}
          aria-label={done ? 'Reopen task' : 'Mark mixed'}
          onClick={done ? onReopen : onComplete}
          disabled={busy}
          className={`h-12 w-12 shrink-0 rounded-md border-thick border-ink-900 grid place-items-center font-display font-bold text-h3 transition-all duration-fast ease-squish ${
            done ? 'bg-teal text-cream-50' : 'bg-cream-50 text-text-on-light'
          } hover:shadow-sticker-press hover:translate-x-[2px] hover:translate-y-[2px]`}
        >
          {done ? '✓' : ''}
        </button>
        <div
          className="h-12 w-12 shrink-0 rounded-md border-thick border-ink-900"
          style={{ background: task.target_rgb_hex }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-display font-bold text-text-on-light text-h3">
            {task.target_rgb_hex.toUpperCase()}
          </div>
          <div className="pl-label text-text-on-light-muted mt-0.5">
            target {Math.ceil(task.target_volume_ml)} ml · {kindLine}
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Recipe'}
        </Button>
      </div>

      {open && (
        <div className="mt-4 border-t border-cream-300 pt-4">
          <RecipeEditor
            targetHex={task.target_rgb_hex}
            targetMl={task.target_volume_ml}
            display={display}
            bases={bases}
            onSaved={async () => {
              setOpen(false);
              await onReload();
            }}
          />
        </div>
      )}
    </Card>
  );
}

// ----- RecipeEditor (PRD §8 verified-recipe loop) -------------

interface DraftStep {
  key: string;
  base_paint_id: string;
  ml: number;
}

function RecipeEditor({
  targetHex,
  display,
  bases,
  onSaved,
}: {
  targetHex: string;
  /** Target ml the editor is sized against; informational, ratios are saved as parts. */
  targetMl: number;
  display: ReturnType<typeof buildRecipeDisplay> | null;
  bases: BasePaint[];
  onSaved: () => Promise<void> | void;
}) {
  const [draft, setDraft] = useState<DraftStep[]>(() =>
    (display?.steps ?? []).map((s) => ({
      key: crypto.randomUUID(),
      base_paint_id: s.base_paint_id,
      ml: Math.round(s.ml * 100) / 100,
    })),
  );
  const [notes, setNotes] = useState<string>(display?.row?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep the editor in sync if the resolved recipe shifts (e.g. realtime).
  useEffect(() => {
    setDraft(
      (display?.steps ?? []).map((s) => ({
        key: crypto.randomUUID(),
        base_paint_id: s.base_paint_id,
        ml: Math.round(s.ml * 100) / 100,
      })),
    );
    setNotes(display?.row?.notes ?? '');
  }, [display]);

  function addStep() {
    if (bases.length === 0) return;
    // Default to the first base not already in the draft.
    const used = new Set(draft.map((s) => s.base_paint_id));
    const next = bases.find((b) => !used.has(b.id)) ?? bases[0];
    setDraft((d) => [
      ...d,
      { key: crypto.randomUUID(), base_paint_id: next.id, ml: 0 },
    ]);
  }
  function removeStep(key: string) {
    setDraft((d) => d.filter((s) => s.key !== key));
  }
  function update(key: string, patch: Partial<DraftStep>) {
    setDraft((d) => d.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  const totalMl = draft.reduce((a, s) => a + (Number.isFinite(s.ml) ? s.ml : 0), 0);

  async function saveVerified() {
    if (draft.length === 0 || totalMl <= 0) {
      setError('Add at least one base with a non-zero amount.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Store as parts so the recipe scales for any future target volume.
      const steps: RecipeStep[] = draft.map((s) => ({
        base_paint_id: s.base_paint_id,
        parts: s.ml / totalMl,
      }));
      await upsertRecipe({
        targetRgbHex: targetHex,
        steps,
        isVerified: true,
        notes: notes.trim() || undefined,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="pl-label text-text-on-light-muted">
        Adjust by eye. Save when the mix looks right and we'll reuse this recipe whenever {targetHex.toUpperCase()} comes up again.
      </div>

      <ul className="flex flex-col gap-2">
        {draft.map((step) => {
          const base = bases.find((b) => b.id === step.base_paint_id);
          return (
            <li key={step.key} className="flex items-center gap-2">
              <span
                className="h-5 w-5 rounded-full border border-ink-900 shrink-0"
                style={{ background: base?.rgb_hex ?? '#888' }}
              />
              <select
                value={step.base_paint_id}
                onChange={(e) => update(step.key, { base_paint_id: e.target.value })}
                className="flex-1 bg-cream-50 border-thin border-ink-900 rounded-md px-2 py-1 font-body text-text-on-light"
              >
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                step={0.1}
                value={step.ml}
                onChange={(e) => update(step.key, { ml: Number(e.target.value) || 0 })}
                className="w-20 bg-cream-50 border-thin border-ink-900 rounded-md px-2 py-1 font-mono text-text-on-light text-right"
              />
              <span className="font-mono text-xs text-text-on-light-muted">ml</span>
              <button
                type="button"
                aria-label="Remove base"
                onClick={() => removeStep(step.key)}
                className="h-7 w-7 rounded-full border-thin border-ink-900 bg-terracotta text-cream-50 grid place-items-center"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={addStep}
          disabled={bases.length === 0}
        >
          + Add base
        </Button>
        <span className="font-mono text-sm text-text-on-light-muted">
          mix totals {totalMl.toFixed(2)} ml
        </span>
      </div>

      <label className="flex flex-col gap-1">
        <span className="pl-label text-text-on-light-muted">Notes (optional)</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="e.g. needed a hair more terracotta to pull it warm"
          className="bg-cream-50 border-thin border-ink-900 rounded-md px-2 py-1 font-body text-text-on-light"
        />
      </label>

      {error && (
        <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-2 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3 items-center">
        <Button onClick={saveVerified} loading={saving}>
          Save as verified
        </Button>
        <span className="text-text-on-light text-sm">
          Locks this in for future batches.
        </span>
      </div>
    </div>
  );
}

// ----- Stock impact -------------------------------------------

function StockImpact({
  tasks,
  recipes,
  bases,
}: {
  tasks: MixTask[];
  recipes: Map<string, ResolvedRecipe>;
  bases: BasePaint[];
}) {
  // Sum required ml across all *todo* tasks per base paint, then compare
  // against current_level_ml to flag shortfalls. Done tasks already
  // decremented their share.
  const required = useMemo(() => {
    const total = new Map<string, number>();
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const resolved = recipes.get(t.target_rgb_hex);
      if (!resolved) continue;
      const display = buildRecipeDisplay(resolved.steps, t.target_volume_ml, bases);
      for (const s of display.steps) {
        total.set(s.base_paint_id, (total.get(s.base_paint_id) ?? 0) + s.ml);
      }
    }
    return total;
  }, [tasks, recipes, bases]);

  return (
    <Card>
      <CardHeader>
        <CardEyebrow>Stock impact</CardEyebrow>
        <CardTitle>What this batch will consume</CardTitle>
      </CardHeader>
      {bases.length === 0 ? (
        <p className="text-text-on-light">
          No base paints in stock yet. Add some in the Stock screen to plan mixes.
        </p>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {bases.map((b) => {
            const need = required.get(b.id) ?? 0;
            const pct = Math.max(
              0,
              Math.min(100, (b.current_level_ml / Math.max(1, b.container_capacity_ml)) * 100),
            );
            const short = need > b.current_level_ml;
            return (
              <div key={b.id} className="flex items-center gap-3">
                <LiquidContainer
                  label={b.name}
                  color={b.rgb_hex}
                  fillPct={pct}
                  capacityMl={b.container_capacity_ml}
                  currentMl={b.current_level_ml}
                  width={96}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-display font-bold text-cream-50 truncate">{b.name}</div>
                  <div className="pl-label text-text-on-dark-muted mt-1">
                    needs {need.toFixed(1)} ml
                  </div>
                  {short && (
                    <div className="mt-2 pl-label bg-terracotta text-cream-50 rounded-pill px-2 py-0.5 inline-block">
                      short by {(need - b.current_level_ml).toFixed(1)} ml
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <Card>
      <CardHeader>
        <CardEyebrow>{title}</CardEyebrow>
        <CardTitle>{body}</CardTitle>
      </CardHeader>
      <Link to="/app/cart" className="pl-label text-mustard-soft hover:underline">
        ← back to the cart
      </Link>
    </Card>
  );
}
