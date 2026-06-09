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
  ColorRecipe,
  MixTask,
  buildRecipeDisplay,
  completeMixTask,
  fetchBasePaints,
  fetchMixTasks,
  fetchRecipesByHex,
  reopenMixTask,
} from '../lib/recipes';
import { supabase } from '../lib/supabase';
import type { Tables } from '../types/db';

type Cart = Tables<'carts'>;

export default function Lab() {
  const { cartId } = useParams<{ cartId: string }>();
  const [cart, setCart] = useState<Cart | null>(null);
  const [tasks, setTasks] = useState<MixTask[] | null>(null);
  const [recipes, setRecipes] = useState<Map<string, ColorRecipe>>(new Map());
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
      setRecipes(await fetchRecipesByHex(hexes));
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
  recipes: Map<string, ColorRecipe>;
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
          const recipe = recipes.get(t.target_rgb_hex) ?? null;
          const display = recipe
            ? buildRecipeDisplay(recipe.recipe_json, t.target_volume_ml, bases)
            : null;
          return (
            <div key={t.id} className="flex flex-col items-center gap-1">
              <ColorChip
                hex={t.target_rgb_hex}
                totalMl={t.target_volume_ml}
                size="lg"
                recipe={display}
                recipeRow={recipe}
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
}: {
  tasks: MixTask[];
  recipes: Map<string, ColorRecipe>;
  bases: BasePaint[];
  busyId: string | null;
  onComplete: (taskId: string) => void;
  onReopen: (taskId: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {tasks.map((t) => {
        const recipe = recipes.get(t.target_rgb_hex) ?? null;
        const display = recipe
          ? buildRecipeDisplay(recipe.recipe_json, t.target_volume_ml, bases)
          : null;
        return (
          <MixTaskRow
            key={t.id}
            task={t}
            recipe={recipe}
            display={display}
            busy={busyId === t.id}
            onComplete={() => onComplete(t.id)}
            onReopen={() => onReopen(t.id)}
          />
        );
      })}
    </div>
  );
}

function MixTaskRow({
  task,
  recipe,
  display,
  busy,
  onComplete,
  onReopen,
}: {
  task: MixTask;
  recipe: ColorRecipe | null;
  display: ReturnType<typeof buildRecipeDisplay> | null;
  busy: boolean;
  onComplete: () => void;
  onReopen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const done = task.status === 'done';
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
            target {Math.ceil(task.target_volume_ml)} ml ·{' '}
            {recipe
              ? `${(recipe.recipe_json ?? []).length} base${(recipe.recipe_json ?? []).length === 1 ? '' : 's'}${
                  recipe.is_verified ? ' · verified' : ''
                }`
              : 'no recipe yet'}
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
          {display && display.steps.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {display.steps.map((s) => (
                <li
                  key={s.base_paint_id}
                  className="flex items-center gap-3 font-body text-text-on-light"
                >
                  <span
                    className="h-5 w-5 rounded-full border border-ink-900 shrink-0"
                    style={{ background: s.base?.rgb_hex ?? '#888' }}
                  />
                  <span className="flex-1 truncate">{s.base?.name ?? 'Unknown base paint'}</span>
                  <span className="font-mono">{s.ml.toFixed(2)} ml</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-text-on-light text-sm">
              No verified recipe yet. PRD §8: mix it once by eye, then save the recipe so the next
              time this color appears it lands instantly.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ----- Stock impact -------------------------------------------

function StockImpact({
  tasks,
  recipes,
  bases,
}: {
  tasks: MixTask[];
  recipes: Map<string, ColorRecipe>;
  bases: BasePaint[];
}) {
  // Sum required ml across all *todo* tasks per base paint, then compare
  // against current_level_ml to flag shortfalls. Done tasks already
  // decremented their share.
  const required = useMemo(() => {
    const total = new Map<string, number>();
    for (const t of tasks) {
      if (t.status === 'done') continue;
      const recipe = recipes.get(t.target_rgb_hex);
      if (!recipe) continue;
      const display = buildRecipeDisplay(recipe.recipe_json, t.target_volume_ml, bases);
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
