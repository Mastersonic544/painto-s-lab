import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import ComparisonSlider, { ComparisonSliderHandle } from '../components/ui/ComparisonSlider';
import { tierFromCount } from '../lib/complexity';
import Pill from '../components/ui/Pill';
import Spinner from '../components/ui/Spinner';
import { usePieceStatus } from '../hooks/usePieceStatus';
import { estimateVolumeMl } from '../lib/paintMath';
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
    <div className="w-full flex flex-col gap-6">
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

      {piece.status === 'queued' && !piece.preview_svg_path && <ProgressPanel />}
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

      {((piece.status === 'queued' && Boolean(piece.preview_svg_path)) ||
        (piece.status === 'error' && Boolean(piece.preview_svg_path)) ||
        piece.status === 'ready' ||
        piece.status === 'approved' ||
        piece.status === 'archived') && (
        <ReviewArea
          key={piece.id}
          settings={piece.studio_settings}
          sourceImageId={piece.source_image_id}
          colorCount={piece.color_count}
          pieceId={piece.id}
          title={piece.title}
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
  sourceImageId: string;
  settings?: { detail: number; brightness: number; contrast: number; saturation: number };
  colorCount: number;
  title: string;
  status: 'error' | 'queued' | 'ready' | 'approved' | 'archived';
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
  const [requeueCount, setRequeueCount] = useState(props.colorCount);
  const [strokeWidth, setStrokeWidth] = useState(1.0);
  const [numberSize, setNumberSize] = useState(18);
  const [detail, setDetail] = useState(props.settings?.detail ?? 50);
  const [brightness, setBrightness] = useState(props.settings?.brightness ?? 1);
  const [contrast, setContrast] = useState(props.settings?.contrast ?? 1);
  const [saturation, setSaturation] = useState(props.settings?.saturation ?? 1);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [layout, setLayout] = useState<'split' | 'side-by-side'>('side-by-side');
  const [zoom, setZoom] = useState(1);
  const [showSource, setShowSource] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const busy = saving !== 'idle' || props.status === 'queued';
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from('source_images')
        .select('*')
        .eq('id', props.sourceImageId)
        .maybeSingle();
      if (data) {
        const url = await signedUrl('source-images', data.storage_path);
        if (!cancelled) setSourceUrl(url);
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [props.sourceImageId]);
  const [reloadKey, setReloadKey] = useState(0);
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
        if (!loaded) {
          const doc = new DOMParser().parseFromString(oText, 'image/svg+xml');
          const width = parseFloat(
            doc
              .querySelector('path[data-facetId]')
              ?.getAttribute('style')
              ?.match(/stroke-width:\s*([\d.]+)/)?.[1] ?? '1',
          );
          const size = Math.max(
            6,
            Math.min(48, Number(doc.querySelector('text')?.getAttribute('font-size') ?? 18)),
          );
          setStrokeWidth(width);
          setNumberSize(size);
          setLoaded(true);
        }
        setFilledSvg(fText);
        setOutlineSvg(oText);
      } catch (err) {
        if (!cancelled) setFeedback(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.previewPath, props.outlinePath, reloadKey]);

  // After the slider mounts both SVGs, label `<g>`s get tagged with the
  // matching data-facetId so nudge/merge edits can target them.
  useEffect(() => {
    if (!filledSvg || !outlineSvg) return;
    const id = window.setTimeout(() => {
      indexOutlineLabelsByFacetId(sliderRef.current?.getOutlineRoot() ?? null);
    }, 0);
    return () => window.clearTimeout(id);
  }, [filledSvg, outlineSvg]);

  useEffect(() => {
    if (!filledSvg || !outlineSvg) return;
    const timer = window.setTimeout(() => {
      const outline = sliderRef.current?.getOutlineRoot();
      const filled = sliderRef.current?.getFilledRoot();
      outline?.querySelectorAll<SVGPathElement>('path[data-facetId]').forEach((p) => {
        p.style.strokeWidth = `${strokeWidth}px`;
        p.style.strokeLinejoin = 'round';
      });
      for (const root of [filled, outline])
        root?.querySelectorAll<SVGTextElement>('g.label text').forEach((text) => {
          text.setAttribute('font-size', String(numberSize));
          text.setAttribute('stroke', 'white');
          text.setAttribute('stroke-width', String(Math.max(2, numberSize * 0.22)));
          text.setAttribute('paint-order', 'stroke fill');
          text.setAttribute('stroke-linejoin', 'round');
        });
      filled?.querySelectorAll<SVGPathElement>('path[data-facetId]').forEach((p) => {
        if (p.style.fill !== 'none') {
          p.style.strokeWidth = '0.5px';
          p.style.strokeLinejoin = 'round';
        } else p.style.strokeWidth = `${strokeWidth}px`;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [strokeWidth, numberSize, filledSvg, outlineSvg]);

  // Selected-facet highlight: walk the SVG roots and stamp a CSS marker
  // on the currently-selected path / label.
  useEffect(() => {
    const filled = sliderRef.current?.getFilledRoot();
    const outline = sliderRef.current?.getOutlineRoot();
    filled
      ?.querySelectorAll('[data-pl-selected]')
      .forEach((el) => el.removeAttribute('data-pl-selected'));
    outline
      ?.querySelectorAll('[data-pl-selected]')
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
    if (busy || editMode !== 'nudge' || selectedLabel == null) return;
    const NUDGE = 15;
    const handler = (e: KeyboardEvent) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
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
  }, [editMode, selectedLabel, busy]);

  function onFacetClick(facetId: number) {
    if (busy) return;
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
          setFeedback("Merge failed. Couldn't find one of those facets.");
        }
        setMergeFrom(null);
      }
    }
  }

  function onLabelClick(facetId: number) {
    if (busy) return;
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
    if (busy) return;
    setSaving('requeue');
    setFeedback(null);
    const newCount = Math.max(2, Math.min(64, Math.round(requeueCount)));
    const { error } = await supabase
      .from('pieces')
      .update({
        status: 'queued',
        color_count: newCount,
        complexity: tierFromCount(newCount),
        stroke_width: strokeWidth,
        studio_settings: { detail, brightness, contrast, saturation },
        error_message: null,
      })
      .eq('id', props.pieceId);
    if (error) {
      setSaving('idle');
      setFeedback(error.message);
      return;
    }
    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('Missing session token');
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          pieceId: props.pieceId,
          detail,
          brightness,
          contrast,
          saturation,
          fontSize: numberSize,
          strokeWidth,
        }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? `Generation failed (HTTP ${response.status}).`);
      const fresh = await supabase.from('pieces').select('*').eq('id', props.pieceId).single();
      if (fresh.error) throw fresh.error;
      if (fresh.data?.palette_json) setPalette(fresh.data.palette_json);
      setReloadKey((k) => k + 1);
      setEditCount(0);
      clearSelection();
      setFeedback('New version ready. Keep tweaking, or save and approve.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from('pieces')
        .update({ status: 'error', error_message: message })
        .eq('id', props.pieceId);
      setFeedback(message);
    }
    setSaving('idle');
  }

  const aspect = useMemo(() => {
    if (!filledSvg) return 16 / 9;
    const w = Number(filledSvg.match(/<svg[^>]*width="([0-9.]+)"/)?.[1] ?? '16');
    const h = Number(filledSvg.match(/<svg[^>]*height="([0-9.]+)"/)?.[1] ?? '9');
    return w / h;
  }, [filledSvg]);

  // ----- Downloads: export the live (edited) SVGs in three modes ----------
  const ready = Boolean(filledSvg && outlineSvg);
  const slug =
    (props.title || 'piece').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'piece';

  function svgOf(root: HTMLDivElement | null): SVGSVGElement | null {
    return (root?.querySelector('svg') as SVGSVGElement | null) ?? null;
  }
  function save(filename: string, svgText: string) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const root = doc.documentElement;
    const box = root.getAttribute('viewBox')!.split(/\s+/).map(Number);
    const w = props.canvasW,
      h = props.canvasH;
    const scale = Math.min((w - 5) / box[2], (h - 5) / box[3]);
    const g = doc.createElementNS(root.namespaceURI, 'g');
    while (root.firstChild) g.appendChild(root.firstChild);
    g.setAttribute(
      'transform',
      `translate(${(w - box[2] * scale) / 2},${(h - box[3] * scale) / 2}) scale(${scale})`,
    );
    root.setAttribute('width', `${w}cm`);
    root.setAttribute('height', `${h}cm`);
    root.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const bg = doc.createElementNS(root.namespaceURI, 'rect');
    bg.setAttribute('width', String(w));
    bg.setAttribute('height', String(h));
    bg.setAttribute('fill', 'white');
    root.append(bg, g);
    const blob = new Blob([new XMLSerializer().serializeToString(root)], {
      type: 'image/svg+xml;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  // 1. Colors only — the finished piece (no borders, no numbers).
  function downloadColorsOnly() {
    const el = svgOf(sliderRef.current?.getFilledRoot() ?? null);
    if (!el) return setFeedback('Preview still loading.');
    save(`${slug}-colors.svg`, new XMLSerializer().serializeToString(el));
  }
  // 2. B&W template — black outline + numbers, no fills (the printable).
  function downloadTemplate() {
    const el = svgOf(sliderRef.current?.getOutlineRoot() ?? null);
    if (!el) return setFeedback('Preview still loading.');
    save(`${slug}-template.svg`, new XMLSerializer().serializeToString(el));
  }
  // 3. Colors + numbers — faint color guide (30%) under the black outline +
  //    numbers, matching the printed templates you get at the store.
  function downloadColorsNumbers() {
    const filled = svgOf(sliderRef.current?.getFilledRoot() ?? null);
    const outline = svgOf(sliderRef.current?.getOutlineRoot() ?? null);
    if (!filled || !outline) return setFeedback('Preview still loading.');
    const composite = filled.cloneNode(true) as SVGSVGElement;
    // Wrap the color paths in a 30%-opacity group so they read as a tint.
    const ns = 'http://www.w3.org/2000/svg';
    const tint = document.createElementNS(ns, 'g');
    tint.setAttribute('opacity', '0.3');
    while (composite.firstChild) tint.appendChild(composite.firstChild);
    composite.appendChild(tint);
    // Overlay the borders + numbers at full strength.
    outline.childNodes.forEach((n) => composite.appendChild(n.cloneNode(true)));
    save(`${slug}-colors-numbers.svg`, new XMLSerializer().serializeToString(composite));
  }
  // 4. Color code sheet — the number→color key as a printable PDF. Opens a
  // styled page and the print dialog so the operator "Save as PDF".
  function downloadColorSheet() {
    if (palette.length === 0) return setFeedback('No palette to print yet.');
    const rows = palette
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((p) => {
        const ml = estimateVolumeMl({
          areaPercentage: p.areaPercentage,
          canvasWidthCm: props.canvasW,
          canvasHeightCm: props.canvasH,
          coats: props.coats,
        });
        return `<tr>
          <td class="num">${p.index}</td>
          <td><span class="sw" style="background:${esc(p.color)}"></span></td>
          <td class="mono">${esc(p.color).toUpperCase()}</td>
          <td class="mono r">${(p.areaPercentage * 100).toFixed(1)}%</td>
          <td class="mono r">${Math.ceil(ml)} ml</td>
        </tr>`;
      })
      .join('');
    const html = `<!doctype html><html><head><meta charset="utf-8" />
<title>${esc(props.title)} — color code sheet</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #14140f; margin: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .meta { font-family: ui-monospace, monospace; font-size: 12px; color: #5c5a4e; margin-bottom: 20px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 2px solid #14140f; padding: 8px 10px; text-align: left; font-size: 13px; }
  th { background: #eae6db; font-family: ui-monospace, monospace; text-transform: uppercase; letter-spacing: 1px; font-size: 11px; }
  .num { font-weight: 700; width: 48px; text-align: center; font-size: 16px; }
  .sw { display: inline-block; width: 34px; height: 22px; border: 2px solid #14140f; border-radius: 3px; vertical-align: middle; }
  .mono { font-family: ui-monospace, monospace; }
  .r { text-align: right; }
  @media print { body { margin: 12mm; } }
</style></head><body>
  <h1>${esc(props.title)} — color code sheet</h1>
  <div class="meta">${props.canvasW}×${props.canvasH} cm · ${props.coats} coats · ${palette.length} colors · ml estimated at this size</div>
  <table>
    <thead><tr><th>#</th><th>Color</th><th>Hex</th><th>Area</th><th>Paint</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload = function(){ setTimeout(function(){ window.print(); }, 150); };</script>
</body></html>`;
    const w = window.open('', '_blank');
    if (!w) return setFeedback('Allow pop-ups to export the color sheet.');
    w.document.write(html);
    w.document.close();
  }

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
      <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6">
        {/* Selection / merge CSS — tagged via setAttribute on the live DOM. */}
        <style>{styleSheet}</style>

        <div className="flex flex-wrap items-center gap-2">
          <span className="pl-label text-cream-200 mr-auto">
            Your artwork studio · colors / painting template
          </span>
          <Pill active={layout === 'side-by-side'} onClick={() => setLayout('side-by-side')}>
            Side by side
          </Pill>
          <Pill active={layout === 'split'} onClick={() => setLayout('split')}>
            Compare
          </Pill>
          <Pill active={showSource} onClick={() => setShowSource((v) => !v)}>
            Source photo
          </Pill>
        </div>
        {showSource && sourceUrl && (
          <div className="rounded-md border-thick border-ink-900 bg-cream-50 p-3">
            <img
              src={sourceUrl}
              alt="Source photo with pending image adjustments"
              className="max-h-72 mx-auto"
              style={{
                filter: `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`,
              }}
            />
          </div>
        )}
        <label className="flex gap-3 items-center text-cream-200 text-sm">
          Zoom {zoom.toFixed(1)}×
          <input
            aria-label="Artwork zoom"
            className="accent-mustard flex-1"
            type="range"
            min="1"
            max="3"
            step="0.1"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          />
        </label>
        <div className="overflow-auto max-h-[75vh] rounded-md" aria-busy={busy}>
          <div style={{ width: `${zoom * 100}%` }}>
            {filledSvg && outlineSvg ? (
              <ComparisonSlider
                layout={layout}
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
          </div>
        </div>
        {busy && (
          <p role="status" className="text-mustard-soft">
            Updating artwork… Your previous version stays visible.
          </p>
        )}
        <fieldset disabled={busy} className="min-w-0">
          <Card>
            <CardHeader>
              <CardEyebrow>Light edits</CardEyebrow>
              <CardTitle>Paint it your way</CardTitle>
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
        </fieldset>
        {feedback && (
          <div
            role="status"
            className="border-thick border-cream-200 rounded-md bg-swamp-600 text-cream-50 p-3 font-body"
          >
            {feedback}
          </div>
        )}
      </div>

      <aside className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardEyebrow>Fine tune</CardEyebrow>
            <CardTitle>Make it yours</CardTitle>
          </CardHeader>
          <fieldset disabled={busy || !ready} className="flex flex-col gap-5 min-w-0">
            <StudioRange
              label="Line thickness"
              value={strokeWidth}
              min={0.1}
              max={5}
              step={0.1}
              display={`${strokeWidth.toFixed(1)} px`}
              onChange={(v) => {
                setStrokeWidth(v);
                setEditCount((n) => n + 1);
              }}
            />
            <StudioRange
              label="Number size"
              value={numberSize}
              min={6}
              max={48}
              display={`${Math.round(numberSize)} px`}
              onChange={(v) => {
                setNumberSize(v);
                setEditCount((n) => n + 1);
              }}
            />
            <p className="text-sm text-text-on-light-muted">
              Lines and numbers update instantly, with a white halo around every number.
            </p>
            <div className="border-t-2 border-ink-900 pt-4 flex flex-col gap-5">
              <StudioRange
                label="Colors"
                value={requeueCount}
                min={4}
                max={32}
                display={`${requeueCount} paints`}
                onChange={setRequeueCount}
              />
              <StudioRange
                label="Detail"
                value={detail}
                min={0}
                max={100}
                display={detail < 34 ? 'Simple' : detail < 67 ? 'Balanced' : 'Detailed'}
                onChange={setDetail}
              />
              <p className="text-sm text-text-on-light-muted">
                Less detail merges small areas into larger shapes. More colors preserves more tones.
              </p>
              <details>
                <summary className="cursor-pointer font-bold text-sm">
                  Adjust the source photo
                </summary>
                <div className="flex flex-col gap-4 mt-4">
                  <StudioRange
                    label="Brightness"
                    value={brightness}
                    min={0.5}
                    max={1.5}
                    step={0.05}
                    display={`${Math.round(brightness * 100)}%`}
                    onChange={(v) => {
                      setBrightness(v);
                      setShowSource(true);
                    }}
                  />
                  <StudioRange
                    label="Contrast"
                    value={contrast}
                    min={0.5}
                    max={1.5}
                    step={0.05}
                    display={`${Math.round(contrast * 100)}%`}
                    onChange={(v) => {
                      setContrast(v);
                      setShowSource(true);
                    }}
                  />
                  <StudioRange
                    label="Saturation"
                    value={saturation}
                    min={0}
                    max={2}
                    step={0.05}
                    display={`${Math.round(saturation * 100)}%`}
                    onChange={(v) => {
                      setSaturation(v);
                      setShowSource(true);
                    }}
                  />
                </div>
              </details>
              <p className="text-xs text-text-on-light-muted">
                Updating rebuilds regions and replaces manual edits. Download or approve your
                current version first if you want to keep it.
              </p>
              <Button onClick={requeue}>Update artwork</Button>
            </div>
          </fieldset>
        </Card>
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
            <CardEyebrow>Download</CardEyebrow>
            <CardTitle>Export this piece</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={downloadTemplate} disabled={!ready || busy}>
              Outline + numbers (B&amp;W)
            </Button>
            <Button variant="secondary" onClick={downloadColorsNumbers} disabled={!ready || busy}>
              Colors + numbers
            </Button>
            <Button variant="secondary" onClick={downloadColorsOnly} disabled={!ready || busy}>
              Colors only (final)
            </Button>
            <Button variant="tertiary" onClick={downloadColorSheet} disabled={palette.length === 0}>
              Color code sheet (PDF)
            </Button>
          </div>
          <p className="pl-label text-text-on-light-muted mt-3">
            SVGs are vector and reflect your edits. The code sheet opens a print dialog — choose
            "Save as PDF".
          </p>
        </Card>

        <Card>
          <CardHeader>
            <CardEyebrow>Approve</CardEyebrow>
            <CardTitle>Send to the Hub</CardTitle>
          </CardHeader>
          <Button
            onClick={approve}
            loading={saving === 'approve'}
            disabled={busy || !ready}
            className="w-full"
          >
            Approve
            {editCount > 0 && ` (save ${editCount} edit${editCount === 1 ? '' : 's'})`}
          </Button>
        </Card>

        <Card>
          <CardHeader>
            <CardEyebrow>Reject</CardEyebrow>
            <CardTitle>Archive this piece</CardTitle>
          </CardHeader>
          <div className="flex flex-col gap-3">
            <Button
              variant="tertiary"
              onClick={discardPiece}
              loading={saving === 'reject'}
              disabled={busy}
            >
              Discard
            </Button>
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
  if (mode === 'view')
    text =
      'Compare the colors and template. Zoom in to inspect small areas, or choose an editing tool.';
  if (mode === 'recolor')
    text =
      selectedFacet == null
        ? 'Click a region to recolor it. Choose a replacement paint for this region.'
        : `Picked region. Choose a new color below.`;
  if (mode === 'merge')
    text =
      mergeFrom == null
        ? 'Click the region you want to absorb.'
        : `Absorbing #${mergeFrom}. Click the region it should join.`;
  if (mode === 'nudge')
    text =
      selectedLabel == null
        ? 'Click a number to select it, then use arrow keys (shift = jump).'
        : `Number ${selectedLabel} selected. Arrow keys move it.`;
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
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <Card>
      <div className="flex items-center gap-6">
        <Spinner size="lg" />
        <div className="flex-1 flex flex-col gap-3">
          <CardEyebrow>Generating</CardEyebrow>
          <CardTitle>Building colors, borders, and labels…</CardTitle>
          <p className="text-text-on-light">
            Elapsed: {Math.floor(seconds / 60)}m {seconds % 60}s. This usually takes a minute or
            two.
          </p>
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
// Escape text interpolated into the color-sheet print HTML.
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}

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

function StudioRange({
  label,
  value,
  min,
  max,
  step = 1,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex flex-col gap-2 text-sm text-text-on-light">
      <span className="flex justify-between gap-2 font-bold">
        {label}
        <span className="font-mono text-text-on-light-muted">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-6 accent-swamp-600 cursor-pointer focus-visible:outline-2 focus-visible:outline-swamp-600"
      />
    </label>
  );
}
