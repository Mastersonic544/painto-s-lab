import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import LiquidContainer from '../components/ui/LiquidContainer';
import ProgressBar from '../components/ui/ProgressBar';
import Spinner from '../components/ui/Spinner';
import { usePieceStatus } from '../hooks/usePieceStatus';
import { signedUrl } from '../lib/pieces';

export default function PieceJob() {
  const { id } = useParams<{ id: string }>();
  const { piece, loading, error } = usePieceStatus(id);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [outlineUrl, setOutlineUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!piece) return;
    if (piece.status !== 'ready' && piece.status !== 'approved') {
      setPreviewUrl(null);
      setOutlineUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        if (piece.preview_svg_path) {
          const url = await signedUrl('piece-previews', piece.preview_svg_path);
          if (!cancelled) setPreviewUrl(url);
        }
        if (piece.outline_svg_path) {
          const url = await signedUrl('piece-outlines', piece.outline_svg_path);
          if (!cancelled) setOutlineUrl(url);
        }
      } catch (err) {
        console.error('signedUrl failed', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [piece]);

  if (loading) {
    return (
      <div className="min-h-[40vh] grid place-items-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-container-md">
        <Card>
          <CardHeader>
            <CardEyebrow>Couldn't load piece</CardEyebrow>
            <CardTitle>{error}</CardTitle>
          </CardHeader>
        </Card>
      </div>
    );
  }
  if (!piece) {
    return (
      <div className="max-w-container-md">
        <Card>
          <CardHeader>
            <CardEyebrow>Not found</CardEyebrow>
            <CardTitle>That piece doesn't exist.</CardTitle>
          </CardHeader>
          <Link to="/app/intake" className="pl-label text-mustard-soft">
            Back to intake
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-container-lg flex flex-col gap-6">
      <header className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <span className="pl-label text-mustard-soft">Job · {piece.status}</span>
          <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">
            {piece.title}
          </h1>
          <p className="text-cream-200 mt-1">
            {piece.color_count} colors · {piece.canvas_width_cm}×{piece.canvas_height_cm} cm ·{' '}
            {piece.coats} coats
          </p>
        </div>
        <Link to="/app/intake" className="pl-label text-mustard-soft hover:underline">
          + new piece
        </Link>
      </header>

      {piece.status === 'queued' && <ProgressPanel label="Brewing in the lab" />}
      {piece.status === 'error' && (
        <Card>
          <CardHeader>
            <CardEyebrow>Generation failed</CardEyebrow>
            <CardTitle>The converter coughed.</CardTitle>
          </CardHeader>
          <pre className="text-text-on-light text-sm whitespace-pre-wrap font-mono bg-cream-100 border-thick border-ink-900 rounded-md p-3">
            {piece.error_message ?? 'Unknown error.'}
          </pre>
          <div className="mt-4 flex gap-3">
            <Link to="/app/intake">
              <Button>Try a different piece</Button>
            </Link>
          </div>
        </Card>
      )}

      {(piece.status === 'ready' || piece.status === 'approved') && (
        <>
          <div className="grid md:grid-cols-2 gap-4">
            <SvgPanel title="Finished piece" url={previewUrl} eyebrow="Filled SVG" />
            <SvgPanel title="Numbered outline" url={outlineUrl} eyebrow="Outline + labels" />
          </div>
          <Card>
            <CardHeader>
              <CardEyebrow>Palette</CardEyebrow>
              <CardTitle>{piece.palette_json?.length ?? 0} colors</CardTitle>
            </CardHeader>
            <div className="flex flex-wrap gap-2">
              {(piece.palette_json ?? []).map((p) => (
                <div
                  key={p.index}
                  className="flex items-center gap-2 border-thin border-ink-900 rounded-pill bg-cream-100 px-2 py-1"
                  title={`${p.color} · ${(p.areaPercentage * 100).toFixed(1)}%`}
                >
                  <span
                    className="h-5 w-5 rounded-full border border-ink-900"
                    style={{ background: p.color }}
                  />
                  <span className="font-mono text-xs text-text-on-light">{p.index}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function ProgressPanel({ label }: { label: string }) {
  // Fake-progress sweep so the operator sees motion while the function runs.
  // The bar resets when the realtime row update flips status.
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
          <CardEyebrow>{label}</CardEyebrow>
          <CardTitle>k-means, facets, borders, labels…</CardTitle>
          <ProgressBar value={pct} tone="teal" label="Converter" />
          <p className="text-text-on-light text-sm">
            This page updates the moment the job finishes — no refresh needed.
          </p>
        </div>
      </div>
    </Card>
  );
}

function SvgPanel({
  title,
  url,
  eyebrow,
}: {
  title: string;
  url: string | null;
  eyebrow: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardEyebrow>{eyebrow}</CardEyebrow>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      {url ? (
        <img
          src={url}
          alt={title}
          className="w-full h-auto rounded-md border-thick border-ink-900 bg-cream-50"
        />
      ) : (
        <div className="h-64 grid place-items-center">
          <Spinner size="md" />
        </div>
      )}
    </Card>
  );
}
