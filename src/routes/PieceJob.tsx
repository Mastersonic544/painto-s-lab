import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import ComparisonSlider, {
  ComparisonSliderHandle,
} from '../components/ui/ComparisonSlider';
import Input from '../components/ui/Input';
import LiquidContainer from '../components/ui/LiquidContainer';
import Pill from '../components/ui/Pill';
import ProgressBar from '../components/ui/ProgressBar';
import Spinner from '../components/ui/Spinner';
import { usePieceStatus } from '../hooks/usePieceStatus';
import { signedUrl } from '../lib/pieces';
import { supabase } from '../lib/supabase';
import {
  indexOutlineLabelsByFacetId,
  mergeRegions,
  nudgeLabel,
  recolorRegion,
  rgbStrToHex,
  saveEditedPiece,
  updatePaletteHex,
} from '../lib/svgEdits';
import type { PaletteEntry } from '../types/db';

type EditMode = 'view' | 'recolor' | 'merge' | 'nudge';

export default function PieceJob() {
  const { id } = useParams<{ id: string }>();
  const { piece, loading, error } = usePieceStatus(id);

  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (error) return <ErrorCard title="Couldn't load piece" body={error} />;
  if (!piece) return <ErrorCard title="Not found" body="That piece doesn't exist." />;

  return (
    <div className="max-w-container-lg flex flex-col gap-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <span className="pl-label text-mustard-soft">Piece · {piece.status}</span>
          <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">
            {piece.title}
          </h1>
          <p className="text-cream-200 mt-1">
            {piece.complexity} · {piece.color_count} colors · {piece.canvas_width_cm}×
            {piece.canvas_height_cm} cm · {piece.coats} coats
          </p>
        </div>
        <Link to="/app/intake" className="pl-label text-mustard-soft hover:underline">
          + new piece
        </Link>
      </header>

      {piece.status === 'queued' && <ProgressPanel />}
      {piece.status === 'error' && (
        <Card>
          <CardHeader>
            <CardEyebrow>Generation failed</CardEyebrow>
            <CardTitle>The converter coughed.</CardTitle>
          </CardHeader>
          <pre className="text-text-on-light text-sm whitespace-pre-wrap font-mono bg-cream-100 border-thick border-ink-900 rounded-md p-3">
            {piece.error_message ?? 'Unknown error.'}
          </pre>
          <div className="mt-4">
            <Link to="/app/intake">
              <Button>Try a different piece</Button>
            </Link>
          </div>
        </Card>
      )}

      {(piece.status === 'ready' ||
        piece.status === 'approved' ||
        piece.status === 'archived') && (
        <ReviewArea
          pieceId={piece.id}
          status={piece.status}
          previewPath={piece.preview_svg_path ?? ''}
          outlinePath={piece.outline_svg_path ?? ''}
          paletteJson={(piece.palette_json ?? []) as PaletteEntry[]}
          canvasW={piece.canvas_width_cm}
          canvasH={piece.canvas_height_cm}
          coats={piece.coats}
        />
      )}
    </div>
  );
}

// =============================================================
// Review area: slider + edit modes + approve / reject
// =============================================================

function ReviewArea(props: {
  pieceId: string;
  status: 'ready' | 'approved' | 'archived';
  previewPath: string;
  outlinePath: string;
  paletteJson: PaletteEntry[];
  canvasW: number;
  canvasH: number;
  coats: number;
}) {
  const navigate = useNavigate();
  const sliderRef = useRef<ComparisonSliderHandle | null>(null);
  const [filledSvg, setFilledSvg] = useState<string | null>(null);
  const [outlineSvg, setOutlineSvg] = useState<string | null>(null);
  const [palette, setPalette] = useState<PaletteEntry[]>(props.paletteJson);
  const [editMode, setEditMode] = useState<EditMode>('view');
  const [selectedFacet, setSelectedFacet] = useState<number | null>(null);
  const [mergeFrom, setMergeFrom] = useState<number | null>(null);
  const [selectedLabel, setSelectedLabel] = useState<number | null>(null);
  const [editCount, setEditCount] = useState(0);
  const [saving, setSaving] = useState<'idle' | 'approve' | 'reject' | 'requeue'>('idle');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [requeueCount, setRequeueCount] = useState(props.paletteJson.length || 16);

  // Load SVGs from storage on mount (fresh signed URLs).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!props.previewPath || !props.outlinePath) return;
        const [fUrl, oUrl] = await Promise.all([
          signedUrl('piece-previews', props.previewPath),
          signedUrl('piece-outlines', props.outlinePath),
        ]);
        const [fText, oText] = await Promise.all([
          fetch(fUrl).then((r) => r.text()),
          fetch(oUrl).then((r) => r.text()),
        ]);
        if (cancelled) return;
        setFilledSvg(fText);
        setOutlineSvg(oText);
      } catch (err) {
        if (!cancelled) setFeedback(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.previewPath, props.outlinePath]);

  // After the slider mounts both SVGs, label `<g>`s get tagged with the
  // matching data-facetId so nudge/merge edits can target them.
  useEffect(() => {
    if (!filledSvg || !outlineSvg) return;
    const id = window.setTimeout(() => {
      indexOutlineLabelsByFacetId(sliderRef.current?.getOutlineRoot() ?? null);
    }, 0);
    return () => window.clearTimeout(id);
  }, [filledSvg, outlineSvg]);

  // Selected-facet highlight: walk the SVG roots and stamp a CSS marker
  // on the currently-selected path / label.
  useEffect(() => {
    const filled = sliderRef.current?.getFilledRoot();
    const outline = sliderRef.current?.getOutlineRoot();
    filled?.querySelectorAll('[data-pl-selected]')
      .forEach((el) => el.removeAttribute('data-pl-selected'));
    outline?.querySelectorAll('[data-pl-selected]')
      .forEach((el) => el.removeAttribute('data-pl-selected'));
    if (selectedFacet != null) {
      filled
        ?.querySelector(`path[data-facetId="${selectedFacet}"]`)
        ?.setAttribute('data-pl-selected', 'true');
    }
    if (mergeFrom != null) {
      filled
        ?.querySelector(`path[data-facetId="${mergeFrom}"]`)
        ?.setAttribute('data-pl-selected', 'pending');
    }
    if (selectedLabel != null) {
      outline
        ?.querySelector(`g.label[data-facetId="${selectedLabel}"]`)
        ?.setAttribute('data-pl-selected', 'true');
    }
  }, [selectedFacet, mergeFrom, selectedLabel, filledSvg, outlineSvg]);

  // Arrow keys nudge the selected label by 15 user units (~5 display px
  // at the engine's default 3× size multiplier).
  useEffect(() => {
    if (editMode !== 'nudge' || selectedLabel == null) return;
    const NUDGE = 15;
    const handler = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const step = e.shiftKey ? NUDGE * 3 : NUDGE;
      let dx = 0;
      let dy = 0;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      const ok = nudgeLabel(sliderRef.current?.getOutlineRoot() ?? null, selectedLabel, dx, dy);
      if (ok) setEditCount((n) => n + 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editMode, selectedLabel]);

  function onFacetClick(facetId: number) {
    if (editMode === 'recolor') {
      setSelectedFacet(facetId);
    } else if (editMode === 'merge') {
      if (mergeFrom == null) {
        setMergeFrom(facetId);
      } else if (mergeFrom !== facetId) {
        const ok = mergeRegions(
          sliderRef.current?.getFilledRoot() ?? null,
          sliderRef.current?.getOutlineRoot() ?? null,
          mergeFrom,
          facetId,
        );
        if (ok) {
          setEditCount((n) => n + 1);
          setFeedback(`Merged facet ${mergeFrom} into ${facetId}.`);
        } else {
          setFeedback('Merge failed — couldn\'t find one of those facets.');
        }
        setMergeFrom(null);
      }
    }
  }

  function onLabelClick(facetId: number) {
    if (editMode === 'nudge') {
      setSelectedLabel(facetId);
    }
  }

  function applyRecolor(hex: string) {
    if (selectedFacet == null) return;
    const filledRoot = sliderRef.current?.getFilledRoot() ?? null;
    const ok = recolorRegion(filledRoot, selectedFacet, hex);
    if (!ok) {
      setFeedback('Recolor failed.');
      return;
    }
    // Resolve the palette index from the facet's previous color: read its
    // *current* fill (we just changed it) backwards — easier to update via
    // the index we tracked in palette. We map palette by old color, so when
    // recoloring we just mutate the matching palette entry's hex.
    // We don't track which palette index a facet belongs to in the SVG,
    // so fall back to: replace this hex's palette entry if a previous one
    // matches the facet's pre-edit fill. The simplest, most predictable
    // behaviour is: mutate every palette entry whose hex matches the path's
    // PREVIOUS hex. Since we already mutated the path, we read it from
    // the corresponding outline label number instead.
    const labelNum = readFacetLabelNumber(
      sliderRef.current?.getOutlineRoot() ?? null,
      selectedFacet,
    );
    if (labelNum != null) {
      setPalette((prev) => updatePaletteHex(prev, labelNum, hex));
    }
    setEditCount((n) => n + 1);
    setSelectedFacet(null);
    setFeedback(`Recolored region #${labelNum ?? selectedFacet} → ${hex}.`);
  }

  function clearSelection() {
    setSelectedFacet(null);
    setMergeFrom(null);
    setSelectedLabel(null);
  }

  async function approve() {
    setSaving('approve');
    setFeedback(null);
    try {
      await saveEditedPiece({
        pieceId: props.pieceId,
        filledRoot: sliderRef.current?.getFilledRoot() ?? null,
        outlineRoot: sliderRef.current?.getOutlineRoot() ?? null,
        previewPath: props.previewPath,
        outlinePath: props.outlinePath,
        paletteJson: palette,
        canvasWidthCm: props.canvasW,
        canvasHeightCm: props.canvasH,
        coats: props.coats,
      });
      setFeedback('Approved. Find it in the Hub.');
      setSaving('idle');
      setEditCount(0);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : String(err));
      setSaving('idle');
    }
  }

  async function discardPiece() {
    setSaving('reject');
    const { error } = await supabase
      .from('pieces')
      .update({ status: 'archived' })
      .eq('id', props.pieceId);
    setSaving('idle');
    if (error) {
      setFeedback(error.message);
      return;
    }
    navigate('/app');
  }

  async function requeue() {
    setSaving('requeue');
    setFeedback(null);
    const newCount = Math.max(2, Math.min(64, Math.round(requeueCount)));
    const { error } = await supabase
      .from('pieces')
      .update({
        status: 'queued',
        color_count: newCount,
        preview_svg_path: null,
        outline_svg_path: null,
        palette_json: null,
        error_message: null,
      })
      .eq('id', props.pieceId);
    if (error) {
      setSaving('idle');
      setFeedback(error.message);
      return;
    }
    // Kick the converter again.
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (token) {
      await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pieceId: props.pieceId }),
      }).catch(() => undefined);
    }
    setSaving('idle');
    await supabase.from('piece_colors').delete().eq('piece_id', props.pieceId);
  }

  const aspect = useMemo(() => {
    if (!filledSvg) return 16 / 9;
    const w = Number(filledSvg.match(/<svg[^>]*width="([0-9.]+)"/)?.[1] ?? '16');
    const h = Number(filledSvg.match(/<svg[^>]*height="([0-9.]+)"/)?.[1] ?? '9');
    return w / h;
  }, [filledSvg]);

  return (
    <div className="grid lg:grid-cols-[1fr_280px] gap-6">
      <div className="flex flex-col gap-4">
        {/* Selection / merge CSS — tagged via setAttribute on the live DOM. */}
        <style>{styleSheet}</style>

        {filledSvg && outlineSvg ? (
          <ComparisonSlider
            ref={sliderRef}
            filledSvg={filledSvg}
            outlineSvg={outlineSvg}
            aspectRatio={aspect}
            initialSplit={0.5}
            onFacetClick={onFacetClick}
            onLabelClick={onLabelClick}
          />
        ) : (
          <div className="aspect-video grid place-items-center border-thick border-ink-900 rounded-md bg-cream-50">
            <Spinner size="lg" />
          </div>
        )}

        <Card>
          <CardHeader>
            <CardEyebrow>Light edits</CardEyebrow>
            <CardTitle>Make it sellable before approving</CardTitle>
          </CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            {(['view', 'recolor', 'merge', 'nudge'] as EditMode[]).map((m) => (
              <Pill
                key={m}
                active={editMode === m}
                onClick={() => {
                  setEditMode(m);
                  clearSelection();
                }}
              >
                {m}
              </Pill>
            ))}
            <span className="pl-label text-text-on-light-muted ml-auto">
              {editCount} edit{editCount === 1 ? '' : 's'} pending
            </span>
          </div>
          <EditHint
            mode={editMode}
            selectedFacet={selectedFacet}
            mergeFrom={mergeFrom}
            selectedLabel={selectedLabel}
          />

          {editMode === 'recolor' && selectedFacet != null && (
            <ColorPicker palette={palette} onPick={applyRecolor} />
          )}
        </Card>

        {feedback && (
          <div className="border-thick border-cream-200 rounded-md bg-swamp-600 text-cream-50 p-3 font-body">
            {feedback}
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardEyebrow>Status</CardEyebrow>
            <CardTitle>{props.status}</CardTitle>
          </CardHeader>
          <p className="text-text-on-light text-sm">
            {props.status === 'approved'
              ? 'Lives in the Hub. Edits below will overwrite the stored copy.'
              : props.status === 'archived'
                ? 'Archived. Re-queue to bring it back.'
                : 'Ready for review. Approve to push to the Hub, or reject to discard.'}
          </p>
        </Card>

        <Card>
          <CardHeader>
            <CardEyebrow>Palette</CardEyebrow>
            <CardTitle>{palette.length} colors</CardTitle>
          </CardHeader>
          <div className="grid grid-cols-6 gap-1">
            {palette.map((p) => (
              <div
                key={p.index}
                title={`${p.color} · ${(p.areaPercentage * 100).toFixed(1)}%`}
                className="aspect-square rounded-sm border border-ink-900"
                style={{ background: p.color }}
              />
            ))}
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardEyebrow>Approve</CardEyebrow>
            <CardTitle>Send to the Hub</CardTitle>
          </CardHeader>
          <Button onClick={approve} loading={saving === 'approve'} className="w-full">
            Approve
            {editCount > 0 && ` (save ${editCount} edit${editCount === 1 ? '' : 's'})`}
          </Button>
        </Card>

        <Card>
          <CardHeader>
            <CardEyebrow>Reject</CardEyebrow>
            <CardTitle>Discard or re-queue</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-3">
            <Button variant="tertiary" onClick={discardPiece} loading={saving === 'reject'}>
              Discard
            </Button>
            <div className="flex flex-col gap-2">
              <Input
                label="Re-queue with"
                type="number"
                min={2}
                max={64}
                value={requeueCount}
                onChange={(e) => setRequeueCount(Number(e.target.value) || 16)}
                trailingAddon="colors"
              />
              <Button variant="secondary" onClick={requeue} loading={saving === 'requeue'}>
                Send back to the converter
              </Button>
            </div>
          </div>
        </Card>
      </aside>
    </div>
  );
}

function EditHint({
  mode,
  selectedFacet,
  mergeFrom,
  selectedLabel,
}: {
  mode: EditMode;
  selectedFacet: number | null;
  mergeFrom: number | null;
  selectedLabel: number | null;
}) {
  let text = '';
  if (mode === 'view') text = 'Drag the knob to reveal more of either side.';
  if (mode === 'recolor')
    text =
      selectedFacet == null
        ? 'Click a region to recolor it. The whole color group repaints.'
        : `Picked region — choose a new color below.`;
  if (mode === 'merge')
    text =
      mergeFrom == null
        ? 'Click the region you want to absorb.'
        : `Absorbing #${mergeFrom} — click the region it should join.`;
  if (mode === 'nudge')
    text =
      selectedLabel == null
        ? 'Click a number to select it, then use arrow keys (shift = jump).'
        : `Number ${selectedLabel} selected — arrow keys move it.`;
  return <p className="text-text-on-light text-sm mt-3">{text}</p>;
}

function ColorPicker({
  palette,
  onPick,
}: {
  palette: PaletteEntry[];
  onPick: (hex: string) => void;
}) {
  const [custom, setCustom] = useState('#0d3d3a');
  // De-dupe palette swatches so the picker isn't dense with the same hex.
  const seen = new Set<string>();
  const swatches = palette
    .map((p) => p.color)
    .filter((h) => {
      if (seen.has(h)) return false;
      seen.add(h);
      return true;
    });
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="pl-label text-text-on-light-muted">Pick a color</div>
      <div className="flex flex-wrap gap-2">
        {swatches.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => onPick(hex)}
            title={hex}
            className="h-9 w-9 rounded-md border-thick border-ink-900 hover:shadow-sticker-press hover:translate-x-[2px] hover:translate-y-[2px] transition-all duration-fast ease-squish"
            style={{ background: hex }}
            aria-label={`Recolor to ${hex}`}
          />
        ))}
      </div>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          className="h-10 w-12 rounded-md border-thick border-ink-900 bg-cream-50"
          aria-label="Custom color"
        />
        <Button onClick={() => onPick(custom)}>Use {custom}</Button>
      </div>
    </div>
  );
}

function ProgressPanel() {
  const [pct, setPct] = useState(8);
  useEffect(() => {
    const id = setInterval(() => {
      setPct((p) => (p < 92 ? p + Math.max(0.5, (92 - p) * 0.04) : p));
    }, 600);
    return () => clearInterval(id);
  }, []);
  return (
    <Card>
      <div className="flex items-center gap-6">
        <LiquidContainer label="brewing" color="var(--teal)" fillPct={pct} width={120} />
        <div className="flex-1 flex flex-col gap-3">
          <CardEyebrow>Brewing in the lab</CardEyebrow>
          <CardTitle>k-means, facets, borders, labels…</CardTitle>
          <ProgressBar value={pct} tone="teal" label="Converter" />
        </div>
      </div>
    </Card>
  );
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-container-md">
      <Card>
        <CardHeader>
          <CardEyebrow>{title}</CardEyebrow>
          <CardTitle>{body}</CardTitle>
        </CardHeader>
        <Link to="/app" className="pl-label text-mustard-soft hover:underline">
          ← back to the lab
        </Link>
      </Card>
    </div>
  );
}

// Read the digit a label `<text>` shows for a given facetId. We use this
// to map a facet back to its palette index after a recolor.
function readFacetLabelNumber(outlineRoot: HTMLDivElement | null, facetId: number): number | null {
  if (!outlineRoot) return null;
  const g = outlineRoot.querySelector(`g.label[data-facetId="${facetId}"]`);
  if (!g) return null;
  const t = g.querySelector('text');
  if (!t) return null;
  const n = Number(t.textContent ?? '');
  return Number.isFinite(n) ? n : null;
}

// Highlight styles applied via setAttribute on the live SVG DOM.
const styleSheet = `
[data-pl-selected="true"] {
  filter: drop-shadow(0 0 0 var(--mustard)) drop-shadow(0 0 0 var(--mustard));
  stroke: var(--mustard) !important;
  stroke-width: 4px !important;
}
[data-pl-selected="pending"] {
  stroke: var(--teal) !important;
  stroke-width: 4px !important;
  stroke-dasharray: 8 4;
}
g.label[data-pl-selected="true"] text {
  fill: var(--mustard) !important;
  stroke: var(--ink-900);
  stroke-width: 1px;
  paint-order: stroke fill;
}
` as const;

// Tells the rgbStrToHex helper to be referenced so the import stays alive
// for the future PR that adds palette growth.
void rgbStrToHex;
