import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge, { BadgeTone } from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card, { CardEyebrow } from '../components/ui/Card';
import Input from '../components/ui/Input';
import Pill from '../components/ui/Pill';
import Spinner from '../components/ui/Spinner';
import Blob from '../components/decorative/Blob';
import Splat from '../components/decorative/Splat';
import { supabase } from '../lib/supabase';
import { useCart } from '../hooks/useCart';
import type { PieceComplexity, Tables } from '../types/db';

type ApprovedPiece = Tables<'pieces'>;
type TierFilter = 'all' | PieceComplexity;

const TIER_TONE: Record<PieceComplexity, BadgeTone> = {
  simple: 'teal',
  normal: 'mustard',
  complex: 'terracotta',
};
const TIER_LABEL: Record<PieceComplexity, string> = {
  simple: 'Simple',
  normal: 'Normal',
  complex: 'Complex',
};

// Predefined card tilts so the grid never reads as a sterile table — repeats
// across larger lists, but the loop length is prime-ish so adjacency rarely
// matches. PRD §9.5: "lively, not a sterile grid".
const TILTS = [-2.2, 1.4, -0.9, 2.1, -1.6, 0.7, -2.5, 1.9];

export default function Hub() {
  const [pieces, setPieces] = useState<ApprovedPiece[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [tier, setTier] = useState<TierFilter>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('pieces')
        .select('*')
        .eq('status', 'approved')
        .order('approved_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (err) {
        setError(err.message);
        return;
      }
      setPieces(data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Batch-sign thumbnail URLs once the piece list lands.
  useEffect(() => {
    if (!pieces || pieces.length === 0) return;
    let cancelled = false;
    (async () => {
      const paths = pieces
        .map((p) => p.preview_svg_path)
        .filter((p): p is string => Boolean(p));
      if (!paths.length) return;
      const { data, error: err } = await supabase.storage
        .from('piece-previews')
        .createSignedUrls(paths, 3600);
      if (cancelled || err || !data) return;
      const next: Record<string, string> = {};
      for (let i = 0; i < paths.length; i++) {
        const signed = data[i]?.signedUrl;
        if (signed) next[paths[i]] = signed;
      }
      setThumbs(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [pieces]);

  const filtered = useMemo(() => {
    if (!pieces) return null;
    const q = query.trim().toLowerCase();
    return pieces.filter((p) => {
      if (tier !== 'all' && p.complexity !== tier) return false;
      if (q && !p.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [pieces, tier, query]);

  return (
    <div className="max-w-container-lg flex flex-col gap-6">
      <header className="flex items-end justify-between flex-wrap gap-4">
        <div>
          <span className="pl-label text-mustard-soft">The Hub</span>
          <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">
            Approved pieces
          </h1>
          <p className="text-cream-200 mt-1 max-w-md">
            Production catalog. Browse what's ready, add the ones you want to make to the Lab Cart.
          </p>
        </div>
        <Link to="/app/intake" className="pl-label text-mustard-soft hover:underline">
          + new piece
        </Link>
      </header>

      <Card paper sticker>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-2">
            <span className="pl-label text-text-on-light-muted">Tier</span>
            <div className="flex flex-wrap gap-2">
              {(['all', 'simple', 'normal', 'complex'] as TierFilter[]).map((t) => (
                <Pill key={t} active={tier === t} onClick={() => setTier(t)}>
                  {t === 'all' ? 'All' : TIER_LABEL[t as PieceComplexity]}
                </Pill>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-[220px]">
            <Input
              label="Search by title"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="mossy heron…"
            />
          </div>
          <div className="pl-label text-text-on-light-muted">
            {filtered ? `${filtered.length} of ${pieces?.length ?? 0}` : 'loading…'} · newest first
          </div>
        </div>
      </Card>

      {error && (
        <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-3">
          {error}
        </div>
      )}

      {!filtered && (
        <div className="min-h-[30vh] grid place-items-center">
          <Spinner size="lg" />
        </div>
      )}

      {filtered && filtered.length === 0 && <EmptyState anyExist={(pieces?.length ?? 0) > 0} />}

      {filtered && filtered.length > 0 && (
        <Gallery
          pieces={filtered}
          thumbs={thumbs}
        />
      )}
    </div>
  );
}

function Gallery({
  pieces,
  thumbs,
}: {
  pieces: ApprovedPiece[];
  thumbs: Record<string, string>;
}) {
  // Interleave decorative blobs/splats between groups of 6 cards so the
  // gallery reads as a hand-pinned wall, not a regular grid.
  const groups: ApprovedPiece[][] = [];
  for (let i = 0; i < pieces.length; i += 6) groups.push(pieces.slice(i, i + 6));

  return (
    <div className="flex flex-col gap-12">
      {groups.map((group, gi) => (
        <section key={gi} className="relative">
          {gi > 0 && <RowDivider index={gi} />}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-4">
            {group.map((piece, i) => {
              const tilt = TILTS[(gi * 7 + i) % TILTS.length];
              const thumb = piece.preview_svg_path ? thumbs[piece.preview_svg_path] : null;
              return <PieceCard key={piece.id} piece={piece} thumbUrl={thumb} tilt={tilt} />;
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function RowDivider({ index }: { index: number }) {
  // Alternate decorations per row so they read as the brand's paint splats.
  const which = index % 3;
  return (
    <div
      aria-hidden
      className="relative h-12 -mt-4 mb-2 pointer-events-none"
    >
      {which === 0 && (
        <Splat color="mustard" size={140} className="absolute -top-4 left-[8%] -rotate-6 opacity-90" />
      )}
      {which === 1 && (
        <Blob
          shape={2}
          color="olive"
          outlined
          size={110}
          className="absolute -top-6 right-[12%] rotate-12 opacity-90"
        />
      )}
      {which === 2 && (
        <Splat color="teal" size={120} className="absolute top-0 left-1/2 -translate-x-1/2 rotate-12 opacity-90" />
      )}
    </div>
  );
}

function PieceCard({
  piece,
  thumbUrl,
  tilt,
}: {
  piece: ApprovedPiece;
  thumbUrl: string | null;
  tilt: number;
}) {
  const { add } = useCart();
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const tone = TIER_TONE[piece.complexity];

  async function onAdd() {
    if (adding) return;
    setAdding(true);
    try {
      await add(piece.id);
      setAdded(true);
      window.setTimeout(() => setAdded(false), 1800);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Card paper sticker tilt={tilt} className="flex flex-col gap-3 transition-transform duration-fast ease-squish hover:rotate-0">
      <Link to={`/app/piece/${piece.id}`} className="block group">
        <div className="rounded-md overflow-hidden border-thick border-ink-900 bg-cream-50 aspect-[4/3]">
          {thumbUrl ? (
            <img
              src={thumbUrl}
              alt={piece.title}
              loading="lazy"
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-fast ease-squish"
            />
          ) : (
            <div className="w-full h-full grid place-items-center">
              <Spinner size="md" />
            </div>
          )}
        </div>
      </Link>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <CardEyebrow>{piece.color_count} colors</CardEyebrow>
          <div className="font-display font-bold text-text-on-light text-h3 truncate mt-0.5">
            {piece.title}
          </div>
        </div>
        <Badge tone={tone}>{TIER_LABEL[piece.complexity]}</Badge>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="pl-label text-text-on-light-muted">
          {piece.canvas_width_cm}×{piece.canvas_height_cm} cm
        </span>
        <Button
          size="sm"
          variant={added ? 'secondary' : 'primary'}
          onClick={onAdd}
          loading={adding}
        >
          {added ? 'In cart' : '+ Lab cart'}
        </Button>
      </div>
    </Card>
  );
}

function EmptyState({ anyExist }: { anyExist: boolean }) {
  return (
    <Card>
      <CardEyebrow>{anyExist ? 'No matches' : 'No approved pieces yet'}</CardEyebrow>
      <p className="text-text-on-light mt-2">
        {anyExist
          ? 'Loosen the filters or try a different search.'
          : "Approve a piece from intake and it'll land here."}
      </p>
      <div className="mt-4">
        <Link to="/app/intake">
          <Button>Start a new piece</Button>
        </Link>
      </div>
    </Card>
  );
}
