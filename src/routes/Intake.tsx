import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import Dropzone from '../components/ui/Dropzone';
import ImageCropper from '../components/ui/ImageCropper';
import Input from '../components/ui/Input';
import Pill from '../components/ui/Pill';
import Radio from '../components/ui/Radio';
import Spinner from '../components/ui/Spinner';
import { CropRect, FULL_CROP, cropImageFile, pxToCanvasCm } from '../lib/image';
import {
  AlgorithmicScore,
  ComplexityDecision,
  TIER_TO_COLOR_COUNT,
  Tier,
  clampCustomCount,
  combineDecision,
  computeAlgorithmicScore,
} from '../lib/complexity';
import {
  createPieceAndQueue,
  fetchModelDecision,
  uploadSourceImage,
} from '../lib/pieces';

type Mode = 'auto' | 'manual';
type Step = 'compose' | 'review' | 'submitting';

const TIER_LABEL: Record<Tier, string> = {
  simple: 'Simple · 8',
  normal: 'Normal · 16',
  complex: 'Complex · 32',
};

export default function Intake() {
  const navigate = useNavigate();

  // Compose state
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<Mode>('auto');
  // Canvas size is derived automatically from the (cropped) photo, not picked.
  const [canvasW, setCanvasW] = useState<number>(40);
  const [canvasH, setCanvasH] = useState<number>(50);
  const [coats, setCoats] = useState<number>(2);
  const [crop, setCrop] = useState<CropRect>(FULL_CROP);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [composing, setComposing] = useState(false);
  // Object URL of the cropped image, shown on the review screen.
  const [reviewPreview, setReviewPreview] = useState<string | null>(null);
  const [manualTier, setManualTier] = useState<Tier>('normal');
  const [manualCustom, setManualCustom] = useState<number | null>(null);

  // Review state
  const [step, setStep] = useState<Step>('compose');
  const [sourceImageId, setSourceImageId] = useState<string | null>(null);
  const [algorithmic, setAlgorithmic] = useState<AlgorithmicScore | null>(null);
  const [decision, setDecision] = useState<ComplexityDecision | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [overrideTier, setOverrideTier] = useState<Tier | null>(null);
  const [overrideCount, setOverrideCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Revoke the cropped preview URL when it's replaced or on unmount.
  useEffect(() => {
    return () => {
      if (reviewPreview) URL.revokeObjectURL(reviewPreview);
    };
  }, [reviewPreview]);

  // Read the photo's natural pixel size so we can derive the canvas size.
  useEffect(() => {
    if (!previewUrl) {
      setNatural(null);
      return;
    }
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.src = previewUrl;
  }, [previewUrl]);

  // Canvas size in cm, derived from the cropped pixel dimensions at 300 DPI.
  const derivedCm = useMemo(() => {
    if (!natural) return null;
    return pxToCanvasCm(natural.w * crop.w, natural.h * crop.h);
  }, [natural, crop]);

  function onFile(next: File) {
    setFile(next);
    setCrop(FULL_CROP);
    if (!title) setTitle(next.name.replace(/\.[^.]+$/, ''));
  }

  async function onCompose(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Pick an image first.');
      return;
    }
    setError(null);
    setComposing(true);

    try {
      // Re-cut the photo to the crop, then lock the canvas size to the
      // cropped pixels (300 DPI). Everything downstream sees the crop only.
      const { file: cropped, widthPx, heightPx } = await cropImageFile(file, crop);
      const size = pxToCanvasCm(widthPx, heightPx);
      setCanvasW(size.w);
      setCanvasH(size.h);
      setReviewPreview((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(cropped);
      });

      // Start the cheap local work immediately so the operator never
      // stares at a blank screen waiting on the upload.
      const algoPromise = computeAlgorithmicScore(cropped);

      const uploaded = await uploadSourceImage(cropped);
      setSourceImageId(uploaded.sourceImageId);

      const algo = await algoPromise;
      setAlgorithmic(algo);
      setComposing(false);
      setStep('review');

      if (mode === 'auto') {
        setModelLoading(true);
        const { model, error: modelErr } = await fetchModelDecision(uploaded.sourceImageId);
        setModelLoading(false);
        const combined = combineDecision(algo, model, modelErr);
        setDecision(combined);
        setOverrideTier(combined.finalTier);
        setOverrideCount(combined.finalCount);
      } else {
        // Manual: skip the model call, but still show algorithmic info.
        const combined = combineDecision(algo, null, null);
        setDecision(combined);
        const tier = manualTier;
        const count = manualCustom ?? TIER_TO_COLOR_COUNT[tier];
        setOverrideTier(tier);
        setOverrideCount(count);
      }
    } catch (err) {
      setComposing(false);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function setTier(tier: Tier) {
    setOverrideTier(tier);
    // Reset count to tier default whenever the tier changes, but only if
    // the operator hasn't typed a custom override since.
    setOverrideCount(TIER_TO_COLOR_COUNT[tier]);
  }

  function setCount(raw: number) {
    setOverrideCount(clampCustomCount(raw));
  }

  async function onGenerate() {
    if (!sourceImageId || !overrideTier || overrideCount == null || !file) return;
    setStep('submitting');
    setError(null);
    try {
      const { pieceId } = await createPieceAndQueue({
        sourceImageId,
        title: title || file.name,
        colorCount: overrideCount,
        canvasWidthCm: canvasW,
        canvasHeightCm: canvasH,
        coats,
        mode,
        complexity: overrideTier,
      });
      navigate(`/app/piece/${pieceId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep('review');
    }
  }

  return (
    <div className="max-w-container-lg flex flex-col gap-6">
      <header>
        <span className="pl-label text-mustard-soft">Intake</span>
        <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">
          Drop in a new piece
        </h1>
        <p className="text-cream-200 mt-2 max-w-lg">
          Drop a photo, crop it to taste, and let the lab figure out a color count. The canvas size
          follows the crop. Round up, never down.
        </p>
      </header>

      {step === 'compose' && (
        <form onSubmit={onCompose} className="grid md:grid-cols-2 gap-6">
          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardEyebrow>1 · Image</CardEyebrow>
                <CardTitle>Source photo or painting</CardTitle>
              </CardHeader>
              {file && previewUrl ? (
                <div className="flex flex-col gap-3">
                  <ImageCropper src={previewUrl} onChange={setCrop} />
                  <button
                    type="button"
                    onClick={() => {
                      setFile(null);
                      setCrop(FULL_CROP);
                    }}
                    className="pl-label text-mustard-deep hover:underline self-start"
                  >
                    ← choose a different image
                  </button>
                </div>
              ) : (
                <Dropzone onFile={onFile} selected={file} previewUrl={previewUrl} />
              )}
            </Card>

            <Card>
              <CardHeader>
                <CardEyebrow>2 · Title</CardEyebrow>
                <CardTitle>Name this piece</CardTitle>
              </CardHeader>
              <Input
                label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Mossy heron"
              />
            </Card>
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardEyebrow>3 · Canvas</CardEyebrow>
                <CardTitle>Size follows your crop</CardTitle>
              </CardHeader>
              <div className="flex items-baseline gap-3">
                <span className="font-display font-black text-display-sm text-text-on-light">
                  {derivedCm ? `${derivedCm.w} × ${derivedCm.h}` : '— × —'}
                </span>
                <span className="pl-label text-text-on-light-muted">cm</span>
              </div>
              <p className="text-text-on-light-muted text-sm mt-1">
                {file
                  ? 'Auto-set from the cropped photo at 300 DPI. Resize the crop frame to change it.'
                  : 'Drop a photo to see its canvas size.'}
              </p>
              <div className="mt-4">
                <Input
                  label="Coats"
                  type="number"
                  min={1}
                  max={5}
                  value={coats}
                  onChange={(e) => setCoats(Math.max(1, Number(e.target.value) || 1))}
                  hint="2 is the acrylic default."
                />
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardEyebrow>4 · Mode</CardEyebrow>
                <CardTitle>Auto or Manual?</CardTitle>
              </CardHeader>
              <div className="flex flex-col gap-3">
                <Radio
                  name="mode"
                  label="Auto: the lab recommends a tier"
                  hint="Vision model + algorithmic check. You confirm before generation."
                  checked={mode === 'auto'}
                  onChange={() => setMode('auto')}
                />
                <Radio
                  name="mode"
                  label="Manual: I'll set it"
                  hint="Pick a tier or a custom color count."
                  checked={mode === 'manual'}
                  onChange={() => setMode('manual')}
                />
              </div>
              {mode === 'manual' && (
                <div className="mt-4 flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {(['simple', 'normal', 'complex'] as Tier[]).map((t) => (
                      <Pill
                        key={t}
                        active={manualTier === t && manualCustom === null}
                        onClick={() => {
                          setManualTier(t);
                          setManualCustom(null);
                        }}
                      >
                        {TIER_LABEL[t]}
                      </Pill>
                    ))}
                  </div>
                  <Input
                    label="Custom count (override)"
                    type="number"
                    min={2}
                    max={64}
                    value={manualCustom ?? ''}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setManualCustom(Number.isFinite(v) && v > 0 ? clampCustomCount(v) : null);
                    }}
                    hint="Lands between tiers? Round up, never down."
                  />
                </div>
              )}
            </Card>

            {error && <ErrorBox message={error} />}

            <Button type="submit" size="lg" disabled={!file} loading={composing}>
              {composing ? 'Cropping & uploading…' : 'Next: review recommendation'}
            </Button>
          </div>
        </form>
      )}

      {step !== 'compose' && (
        <div className="grid md:grid-cols-[300px_1fr] gap-6">
          <Card>
            <CardHeader>
              <CardEyebrow>Source</CardEyebrow>
              <CardTitle>{title || file?.name}</CardTitle>
            </CardHeader>
            {(reviewPreview ?? previewUrl) && (
              <img
                src={reviewPreview ?? previewUrl ?? ''}
                alt={title}
                className="w-full rounded-md border-thick border-ink-900"
              />
            )}
            <div className="pl-label text-text-on-light-muted mt-3">
              {canvasW}×{canvasH} cm · {coats} coats · {mode === 'auto' ? 'Auto' : 'Manual'}
            </div>
            <button
              type="button"
              onClick={() => setStep('compose')}
              className="pl-label text-mustard-deep hover:underline mt-2"
            >
              ← edit
            </button>
          </Card>

          <div className="flex flex-col gap-4">
            <RecommendationCard
              decision={decision}
              algorithmic={algorithmic}
              modelLoading={modelLoading}
              mode={mode}
            />

            <Card>
              <CardHeader>
                <CardEyebrow>Confirm or override</CardEyebrow>
                <CardTitle>Color count for this piece</CardTitle>
              </CardHeader>
              <div className="flex flex-wrap gap-2">
                {(['simple', 'normal', 'complex'] as Tier[]).map((t) => (
                  <Pill key={t} active={overrideTier === t} onClick={() => setTier(t)}>
                    {TIER_LABEL[t]}
                  </Pill>
                ))}
              </div>
              <div className="mt-4">
                <Input
                  label="Color count"
                  type="number"
                  min={2}
                  max={64}
                  value={overrideCount ?? ''}
                  onChange={(e) => setCount(Number(e.target.value))}
                  hint="A manual number overrides the tier. Round up, never down."
                />
              </div>

              {error && (
                <div className="mt-3">
                  <ErrorBox message={error} />
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  size="lg"
                  onClick={onGenerate}
                  loading={step === 'submitting'}
                  disabled={!overrideCount || !sourceImageId}
                >
                  Send to the converter
                </Button>
                <Link to="/app">
                  <Button variant="ghost" size="lg">
                    Cancel
                  </Button>
                </Link>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

function RecommendationCard({
  decision,
  algorithmic,
  modelLoading,
  mode,
}: {
  decision: ComplexityDecision | null;
  algorithmic: AlgorithmicScore | null;
  modelLoading: boolean;
  mode: Mode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardEyebrow>Recommendation</CardEyebrow>
        <CardTitle>
          {decision
            ? `${TIER_LABEL[decision.finalTier]} colors`
            : 'Working it out…'}
        </CardTitle>
      </CardHeader>

      {decision && (
        <p className="text-text-on-light mb-4">
          {decision.source === 'model+algorithmic'
            ? 'Vision model and algorithmic check agree on this, with the round-up rule applied.'
            : 'Algorithmic fallback only. The model was unavailable. Round-up still applies on the next reseed.'}
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-3">
        <SubCard title="Vision model" tone="mustard">
          {mode === 'manual' ? (
            <span className="text-text-on-light">Skipped. Manual mode.</span>
          ) : modelLoading ? (
            <div className="flex items-center gap-3">
              <Spinner size="sm" />
              <span className="text-text-on-light">Asking OpenRouter…</span>
            </div>
          ) : decision?.model ? (
            <div className="flex flex-col gap-1">
              <div className="font-display font-bold text-text-on-light">
                {TIER_LABEL[decision.model.tier]} · suggested {decision.model.suggestedCount}
              </div>
              {decision.model.reason && (
                <div className="text-text-on-light-muted text-sm">{decision.model.reason}</div>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="font-display font-bold text-text-on-light">Unavailable</div>
              <div className="text-text-on-light-muted text-sm">
                {decision?.modelError ?? 'No response. Using the algorithmic fallback.'}
              </div>
            </div>
          )}
        </SubCard>

        <SubCard title="Algorithmic check" tone="teal">
          {algorithmic ? (
            <div className="flex flex-col gap-1">
              <div className="font-display font-bold text-text-on-light">
                {TIER_LABEL[algorithmic.tier]}
              </div>
              <ul className="font-mono text-xs text-text-on-light-muted leading-snug">
                <li>distinct colors: {algorithmic.distinctColors}</li>
                <li>edge density: {(algorithmic.edgeDensity * 100).toFixed(1)}%</li>
                <li>regions: {algorithmic.regionCount}</li>
                <li>color variance: {algorithmic.colorVariance.toFixed(3)}</li>
                <li>score: {algorithmic.score.toFixed(3)}</li>
              </ul>
            </div>
          ) : (
            <Spinner size="sm" />
          )}
        </SubCard>
      </div>
    </Card>
  );
}

function SubCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone: 'mustard' | 'teal';
  children: React.ReactNode;
}) {
  const accent = tone === 'mustard' ? 'border-l-mustard' : 'border-l-teal';
  return (
    <div className={`border-thick border-ink-900 border-l-[8px] ${accent} rounded-md bg-cream-50 p-4`}>
      <div className="pl-label text-text-on-light-muted mb-2">{title}</div>
      {children}
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="border-thick border-terracotta-deep rounded-md bg-terracotta-soft text-ink-900 p-3">
      {message}
    </div>
  );
}
