import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import { DashboardStats, loadDashboardStats } from '../lib/stats';
import type { PieceStatus } from '../types/db';

const STATUS_ORDER: PieceStatus[] = ['queued', 'ready', 'approved', 'archived', 'error'];
const STATUS_COLOR: Record<PieceStatus, string> = {
  queued: 'var(--mustard)',
  ready: 'var(--teal)',
  approved: 'var(--olive)',
  archived: 'var(--swamp-400)',
  error: 'var(--terracotta)',
};

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setStats(await loadDashboardStats());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, []);

  return (
    <div className="flex flex-col gap-6 max-w-container-lg">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <span className="pl-label text-mustard-soft">Operator console</span>
          <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">Dashboard</h1>
        </div>
        <Link to="/app/intake">
          <Button>+ New piece</Button>
        </Link>
      </header>

      {error && (
        <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-3">
          {error}
        </div>
      )}

      {!stats ? (
        <div className="min-h-[40vh] grid place-items-center">
          <Spinner size="lg" />
        </div>
      ) : (
        <Loaded stats={stats} />
      )}
    </div>
  );
}

function Loaded({ stats }: { stats: DashboardStats }) {
  const ready = (stats.statusCounts.ready ?? 0) + (stats.statusCounts.approved ?? 0);
  const stockPct =
    stats.stock.totalCapacityMl > 0
      ? Math.round((stats.stock.totalCurrentMl / stats.stock.totalCapacityMl) * 100)
      : 0;

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Pieces" value={stats.totalPieces} hint="all time" />
        <Kpi label="Ready / approved" value={ready} hint="sittable in the Hub" />
        <Kpi label="Batches made" value={stats.batches} hint="checked-out productions" />
        <Kpi label="Paint planned" value={`${stats.totalPaintMl} ml`} hint="across all batches" />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Pieces by status */}
        <Card>
          <CardHeader>
            <CardEyebrow>Pipeline</CardEyebrow>
            <CardTitle>Pieces by status</CardTitle>
          </CardHeader>
          {stats.totalPieces === 0 ? (
            <Empty>No pieces yet. Start one from intake.</Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {STATUS_ORDER.filter((s) => stats.statusCounts[s]).map((s) => (
                <BarRow
                  key={s}
                  label={s}
                  value={stats.statusCounts[s] ?? 0}
                  max={stats.totalPieces}
                  color={STATUS_COLOR[s]}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Most popular pieces */}
        <Card>
          <CardHeader>
            <CardEyebrow>Demand</CardEyebrow>
            <CardTitle>Most produced pieces</CardTitle>
          </CardHeader>
          {stats.topPieces.length === 0 ? (
            <Empty>Check out a batch and your top sellers show up here.</Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {stats.topPieces.map((p) => (
                <BarRow
                  key={p.id}
                  label={p.title}
                  value={p.qty}
                  suffix="×"
                  max={stats.topPieces[0].qty}
                  color="var(--mustard)"
                  to={`/app/piece/${p.id}`}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Paint consumed by base */}
        <Card>
          <CardHeader>
            <CardEyebrow>Consumption</CardEyebrow>
            <CardTitle>Paint used by base</CardTitle>
          </CardHeader>
          {stats.paintByBase.length === 0 ? (
            <Empty>No batch history yet — paint usage appears after checkouts.</Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {stats.paintByBase.map((b) => (
                <BarRow
                  key={b.name}
                  label={b.name}
                  value={b.ml}
                  suffix=" ml"
                  max={stats.paintByBase[0].ml}
                  color={b.rgb_hex}
                  swatch={b.rgb_hex}
                />
              ))}
            </div>
          )}
        </Card>

        {/* Most used colors */}
        <Card>
          <CardHeader>
            <CardEyebrow>Palette</CardEyebrow>
            <CardTitle>Most demanded colors</CardTitle>
          </CardHeader>
          {stats.topColors.length === 0 ? (
            <Empty>Your busiest target colors will land here.</Empty>
          ) : (
            <div className="flex flex-col gap-2">
              {stats.topColors.map((c) => (
                <BarRow
                  key={c.hex}
                  label={c.hex.toUpperCase()}
                  mono
                  value={c.ml}
                  suffix=" ml"
                  max={stats.topColors[0].ml}
                  color={c.hex}
                  swatch={c.hex}
                />
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Stock summary */}
      <Card>
        <CardHeader>
          <CardEyebrow>Stock</CardEyebrow>
          <CardTitle>Shelf overview</CardTitle>
        </CardHeader>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <MiniStat label="Base paints" value={`${stats.stock.bases}`} />
          <MiniStat label="In stock" value={`${stats.stock.totalCurrentMl} ml`} />
          <MiniStat label="Shelf full" value={`${stockPct}%`} />
          <MiniStat
            label="Low / reorder"
            value={`${stats.stock.lowCount}`}
            tone={stats.stock.lowCount > 0 ? 'warn' : undefined}
          />
        </div>
        <div className="mt-4">
          <Link to="/app/stock" className="pl-label text-mustard-deep hover:underline">
            → manage stock & shopping list
          </Link>
        </div>
      </Card>
    </>
  );
}

function Kpi({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <article className="pl-paper pl-sticker p-5">
      <span className="pl-label text-text-on-light-muted">{label}</span>
      <div className="font-display font-black text-display-sm text-text-on-light mt-1 leading-none">
        {value}
      </div>
      {hint && <p className="pl-label text-text-on-light-muted mt-2">{hint}</p>}
    </article>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="pl-label text-text-on-light-muted">{label}</span>
      <span
        className={`font-display font-bold text-h2 ${
          tone === 'warn' ? 'text-terracotta-deep' : 'text-text-on-light'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function BarRow({
  label,
  value,
  max,
  color,
  suffix = '',
  swatch,
  mono,
  to,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  suffix?: string;
  swatch?: string;
  mono?: boolean;
  to?: string;
}) {
  const pct = max > 0 ? Math.max(4, Math.round((value / max) * 100)) : 0;
  const labelEl = (
    <span
      className={`w-28 shrink-0 truncate text-sm text-text-on-light ${mono ? 'font-mono' : ''}`}
      title={label}
    >
      {label}
    </span>
  );
  return (
    <div className="flex items-center gap-3">
      {swatch && (
        <span
          className="h-4 w-4 rounded-sm border border-ink-900 shrink-0"
          style={{ background: swatch }}
        />
      )}
      {to ? (
        <Link to={to} className="w-28 shrink-0 truncate text-sm text-text-on-light hover:underline" title={label}>
          {label}
        </Link>
      ) : (
        labelEl
      )}
      <div className="flex-1 h-4 rounded-pill bg-cream-300 border-thin border-ink-900 overflow-hidden">
        <div className="h-full rounded-pill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-20 text-right font-mono text-sm text-text-on-light shrink-0">
        {value}
        {suffix}
      </span>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-text-on-light-muted text-sm">{children}</p>;
}
