import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Pill from '../components/ui/Pill';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import { createPieceFromUpload } from '../lib/pieces';

const TIERS: Array<{ key: 'simple' | 'normal' | 'complex'; label: string; count: number }> = [
  { key: 'simple', label: 'Simple', count: 8 },
  { key: 'normal', label: 'Normal', count: 16 },
  { key: 'complex', label: 'Complex', count: 32 },
];

export default function Intake() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [tier, setTier] = useState<'simple' | 'normal' | 'complex'>('normal');
  const [colorCount, setColorCount] = useState<number>(16);
  const [canvasW, setCanvasW] = useState<number>(40);
  const [canvasH, setCanvasH] = useState<number>(50);
  const [coats, setCoats] = useState<number>(2);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  function pickTier(next: 'simple' | 'normal' | 'complex') {
    setTier(next);
    setColorCount(TIERS.find((t) => t.key === next)!.count);
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Pick an image first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { pieceId } = await createPieceFromUpload({
        file,
        title: title || file.name,
        colorCount,
        canvasWidthCm: canvasW,
        canvasHeightCm: canvasH,
        coats,
        complexity: tier,
        mode: 'manual',
      });
      navigate(`/app/piece/${pieceId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-container-md flex flex-col gap-6">
      <header>
        <span className="pl-label text-mustard-soft">Intake</span>
        <h1 className="font-display font-bold text-display-sm text-cream-50 mt-1">
          Drop in a new piece
        </h1>
        <p className="text-cream-200 mt-2 max-w-lg">
          Upload a source image, pick a tier, and we'll queue it for the converter. Round up, never
          down.
        </p>
      </header>

      <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-6">
        <div className="flex flex-col gap-4">
          <Card paper sticker>
            <CardHeader>
              <CardEyebrow>1 · Image</CardEyebrow>
              <CardTitle>Source photo or painting</CardTitle>
            </CardHeader>
            <label className="block">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onFile}
                className="block w-full text-text-on-light file:mr-3 file:font-display file:font-bold file:bg-mustard file:text-ink-900 file:border-thick file:border-ink-900 file:rounded-pill file:px-4 file:py-1.5 file:cursor-pointer cursor-pointer"
              />
            </label>
            {previewUrl && (
              <img
                src={previewUrl}
                alt="upload preview"
                className="mt-4 max-h-64 w-auto rounded-md border-thick border-ink-900"
              />
            )}
          </Card>

          <Card paper sticker>
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
          <Card paper sticker>
            <CardHeader>
              <CardEyebrow>3 · Complexity</CardEyebrow>
              <CardTitle>How many colors?</CardTitle>
            </CardHeader>
            <div className="flex flex-wrap gap-2">
              {TIERS.map((t) => (
                <Pill key={t.key} active={tier === t.key} onClick={() => pickTier(t.key)}>
                  {t.label} · {t.count}
                </Pill>
              ))}
            </div>
            <div className="mt-4">
              <Input
                label="Custom count (override)"
                type="number"
                min={2}
                max={64}
                value={colorCount}
                onChange={(e) => setColorCount(Math.max(2, Number(e.target.value) || 2))}
                hint="Lands between tiers? Round up — never down."
              />
            </div>
          </Card>

          <Card paper sticker>
            <CardHeader>
              <CardEyebrow>4 · Canvas & coats</CardEyebrow>
              <CardTitle>Paint math inputs</CardTitle>
            </CardHeader>
            <div className="grid grid-cols-2 gap-3">
              <Input
                label="Width"
                type="number"
                min={5}
                value={canvasW}
                onChange={(e) => setCanvasW(Number(e.target.value) || 0)}
                trailingAddon="cm"
              />
              <Input
                label="Height"
                type="number"
                min={5}
                value={canvasH}
                onChange={(e) => setCanvasH(Number(e.target.value) || 0)}
                trailingAddon="cm"
              />
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

          {error && (
            <div className="border-thick border-terracotta rounded-md bg-terracotta-soft text-ink-900 p-3">
              {error}
            </div>
          )}

          <Button type="submit" size="lg" loading={submitting} disabled={!file}>
            Send to the converter
          </Button>
          <p className="pl-label text-text-on-dark-muted">
            We'll upload the image, queue the piece, and watch the converter live.
          </p>
        </div>
      </form>
    </div>
  );
}
