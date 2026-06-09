import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card, { CardEyebrow } from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import { BatchHistoryEntry, listCheckoutHistory } from '../lib/cart';
import { signedUrl } from '../lib/pieces';

export default function History() {
  const [entries, setEntries] = useState<BatchHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        setEntries(await listCheckoutHistory());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  const signBatch = useCallback(
    async (entry: BatchHistoryEntry) => {
      const paths = entry.items
        .map((i) => i.piece.preview_svg_path)
        .filter((p): p is string => Boolean(p) && !thumbs[p as string]);
      if (!paths.length) return;
      const next: Record<string, string> = {};
      await Promise.all(
        paths.map(async (p) => {
          try {
            next[p] = await signedUrl('piece-previews', p);
          } catch {
            // skip — falls back to a placeholder
          }
        }),
      );
      if (Object.keys(next).length) setThumbs((t) => ({ ...t, ...next }));
    },
    [thumbs],
  );

  function toggle(entry: BatchHistoryEntry) {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(entry.cart.id)) {
        n.delete(entry.cart.id);
      } else {
        n.add(entry.cart.id);
        void signBatch(entry);
      }
      return n;
    });
  }

  return (
    <div className="max-w-container-lg flex flex-col gap-6">
      <header>
        <span className="pl-label text-mustard-soft">History</span>
        <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">
          Batches you've made
        </h1>
        <p className="text-cream-200 mt-1 max-w-lg">
          Every checked-out batch, newest first. Expand one to see its pieces, or open it to tweak
          and save mix recipes.
        </p>
      </header>

      {error && (
        <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-3">
          {error}
        </div>
      )}

      {entries === null ? (
        <div className="min-h-[30vh] grid place-items-center">
          <Spinner size="lg" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <CardEyebrow>Nothing yet</CardEyebrow>
          <p className="text-text-on-light mt-2">
            Check out a batch from the Lab Cart and it'll show up here.
          </p>
          <div className="mt-4">
            <Link to="/app/cart">
              <Button>Open the Lab Cart</Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {entries.map((e) => {
            const open = expanded.has(e.cart.id);
            return (
              <Card key={e.cart.id} paper sticker>
                <button
                  type="button"
                  onClick={() => toggle(e)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-4 text-left"
                >
                  <span className="font-display font-bold text-h3 text-text-on-light">
                    {fmtDate(e.cart.checked_out_at)}
                  </span>
                  <span className="pl-label text-text-on-light-muted">
                    {e.items.length} piece{e.items.length === 1 ? '' : 's'} · {e.colorCount} color
                    {e.colorCount === 1 ? '' : 's'} · {e.totalMl} ml
                  </span>
                  <span className="ml-auto font-mono text-text-on-light-muted">
                    {open ? '▲' : '▼'}
                  </span>
                </button>

                {open && (
                  <div className="mt-4 border-t border-cream-300 pt-4 flex flex-col gap-4">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                      {e.items.map((it) => {
                        const path = it.piece.preview_svg_path;
                        const thumb = path ? thumbs[path] : undefined;
                        return (
                          <Link
                            key={it.id}
                            to={`/app/piece/${it.piece.id}`}
                            className="flex flex-col gap-1"
                          >
                            <div className="aspect-square rounded-md overflow-hidden border-thick border-ink-900 bg-cream-50 grid place-items-center">
                              {thumb ? (
                                <img
                                  src={thumb}
                                  alt={it.piece.title}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Spinner size="sm" />
                              )}
                            </div>
                            <span className="font-display font-bold text-text-on-light text-sm truncate">
                              {it.piece.title}
                            </span>
                            <span className="pl-label text-text-on-light-muted">
                              ×{it.quantity} · {it.piece.color_count} colors
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                    <div>
                      <Link to={`/app/lab/${e.cart.id}`}>
                        <Button variant="secondary" size="sm">
                          Open mix recipes →
                        </Button>
                      </Link>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Unknown date';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
