import { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';
import Card, { CardEyebrow, CardTitle } from '../components/ui/Card';
import ColorChip from '../components/ui/ColorChip';
import ComparisonSlider from '../components/ui/ComparisonSlider';
import LiquidContainer from '../components/ui/LiquidContainer';
import Pill from '../components/ui/Pill';
import Blob from '../components/decorative/Blob';
import Splat from '../components/decorative/Splat';
import { useInView } from '../hooks/useInView';
import { DEMO_ASPECT, DEMO_FILLED_SVG, DEMO_OUTLINE_SVG } from '../lib/demoSvgs';

type Enter = 'splash' | 'drip' | 'bloom';

function Section({
  enter = 'bloom',
  className,
  children,
}: {
  enter?: Enter;
  className?: string;
  children: ReactNode;
}) {
  const { ref, inView } = useInView<HTMLElement>();
  return (
    <section
      ref={ref}
      data-pl-enter={enter}
      data-in-view={inView ? 'true' : undefined}
      className={className}
    >
      {children}
    </section>
  );
}

export default function Landing() {
  return (
    <>
      <Hero />
      <SliderSection />
      <MixingSection />
      <CartSection />
      <StockSection />
      <FinalCTA />
    </>
  );
}

// ----- Hero ---------------------------------------------------

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Decorative paint accents anchored to the hero. Pointer-events off
          so they never block clicks on the CTA. */}
      <div className="pointer-events-none absolute inset-0">
        <Blob
          shape={1}
          color="olive"
          size={260}
          className="absolute -left-20 top-10 opacity-40"
        />
        <Blob
          shape={2}
          color="terracotta"
          size={180}
          className="absolute right-[12%] top-[8%] opacity-70 rotate-12"
          outlined
        />
        <Splat
          color="mustard"
          size={140}
          className="absolute bottom-8 left-[10%] -rotate-12 opacity-90"
        />
        <Splat
          color="teal"
          size={120}
          className="absolute -right-6 bottom-24 rotate-6 opacity-80"
        />
      </div>

      <div className="relative max-w-container-lg mx-auto px-6 py-20 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center">
        <div className="flex flex-col gap-6">
          <span className="pl-label text-mustard-soft">A paint by numbers lab</span>
          <h1 className="font-display font-black text-display-lg leading-none text-cream-50 tracking-display">
            Brew a kit from any photo.
          </h1>
          <p className="text-cream-100 text-lg max-w-md">
            Painto's Lab flattens an image into clean numbered regions, decides how many colors it
            needs, and mixes every shade from a tiny shelf of base paints. Tactile, playful, honest
            about the messy bits.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <Link to="/login">
              <Button size="lg">Step into the lab</Button>
            </Link>
            <a
              href="#how"
              className="font-display font-bold text-cream-100 hover:text-mustard-soft transition-colors duration-fast"
            >
              See how it works ↓
            </a>
          </div>
          <div className="flex flex-wrap gap-2 mt-2">
            <Pill active>Simple · 8</Pill>
            <Pill>Normal · 16</Pill>
            <Pill>Complex · 32</Pill>
          </div>
        </div>

        <div className="flex justify-center">
          <div className="relative">
            <LiquidContainer
              color="var(--mustard)"
              label="Painto's Lab"
              capacityMl={500}
              currentMl={385}
              width={260}
            />
            <Splat
              color="teal"
              size={120}
              className="pointer-events-none absolute -bottom-8 -right-12 rotate-12 opacity-90"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

// ----- Slider section -----------------------------------------

function SliderSection() {
  return (
    <Section enter="splash" className="relative">
      <div id="how" className="max-w-container-lg mx-auto px-6 py-20 grid lg:grid-cols-[1fr_1fr] gap-10 items-center">
        <div className="flex flex-col gap-4">
          <span className="pl-label text-mustard-soft">01 · the approval slider</span>
          <h2 className="font-display font-bold text-display-md text-cream-50">
            Drag to compare the finished piece with the numbers.
          </h2>
          <p className="text-cream-100 max-w-md">
            Every generation lands as two SVGs. One filled with the palette, one outlined and
            numbered. Drag the chunky knob to flip between them, edit by eye if a region wants a
            nudge, then approve into the Hub.
          </p>
          <div className="flex flex-wrap gap-2">
            <Pill active>Recolor</Pill>
            <Pill>Merge</Pill>
            <Pill>Nudge label</Pill>
          </div>
        </div>
        <div className="relative">
          <ComparisonSlider
            filledSvg={DEMO_FILLED_SVG}
            outlineSvg={DEMO_OUTLINE_SVG}
            aspectRatio={DEMO_ASPECT}
            initialSplit={0.55}
          />
          <Blob
            shape={3}
            color="mustard"
            size={120}
            className="pointer-events-none absolute -top-8 -right-8 opacity-90"
            outlined
          />
        </div>
      </div>
    </Section>
  );
}

// ----- Mixing section -----------------------------------------

function MixingSection() {
  const tasks = [
    { id: 't1', hex: '#0d3d3a', label: 'Swamp green', ml: 42, done: true },
    { id: 't2', hex: '#e8b23c', label: 'Mustard', ml: 18, done: true },
    { id: 't3', hex: '#c8593a', label: 'Terracotta', ml: 9, done: false },
    { id: 't4', hex: '#2fa39b', label: 'Teal', ml: 14, done: false },
    { id: 't5', hex: '#8a9a47', label: 'Olive', ml: 6, done: false },
  ];
  return (
    <Section enter="drip" className="relative">
      <div className="relative max-w-container-lg mx-auto px-6 py-20 grid lg:grid-cols-[1fr_1.1fr] gap-10 items-center">
        <Splat
          color="terracotta"
          size={140}
          className="pointer-events-none absolute -left-10 top-6 -rotate-12 opacity-70"
        />
        <div className="relative">
          <Card>
            <CardEyebrow>02 · the Lab · mixing mode</CardEyebrow>
            <CardTitle>Mix the batch, check it off</CardTitle>
            <ul className="mt-4 flex flex-col gap-2">
              {tasks.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-3 bg-cream-50 border-thick border-ink-900 rounded-md p-3"
                >
                  <span
                    className={
                      'h-9 w-9 rounded-md border-thick border-ink-900 grid place-items-center font-display font-bold ' +
                      (t.done ? 'bg-teal text-cream-50' : 'bg-cream-100 text-text-on-light')
                    }
                  >
                    {t.done ? '✓' : ''}
                  </span>
                  <span
                    className="h-9 w-9 rounded-md border-thick border-ink-900"
                    style={{ background: t.hex }}
                  />
                  <span className="flex-1 font-display font-bold text-text-on-light">
                    {t.label}
                  </span>
                  <span className="font-mono text-text-on-light-muted">{t.ml} ml</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="flex flex-col gap-4">
          <span className="pl-label text-mustard-soft">02 · the lab</span>
          <h2 className="font-display font-bold text-display-md text-cream-50">
            One mix at a time, the platform getting smarter every time.
          </h2>
          <p className="text-cream-100 max-w-md">
            Each color has a recipe of base paints. Mix it once by eye, save the corrected formula,
            and the next time that color appears the recipe lands instantly. Verified shades stay
            yours.
          </p>
        </div>
      </div>
    </Section>
  );
}

// ----- Cart section -------------------------------------------

function CartSection() {
  const palette = [
    { hex: '#0d3d3a', ml: 42 },
    { hex: '#e8b23c', ml: 18 },
    { hex: '#c8593a', ml: 9 },
    { hex: '#2fa39b', ml: 14 },
    { hex: '#8a9a47', ml: 6 },
    { hex: '#EAE6DB', ml: 24 },
    { hex: '#7C4A63', ml: 4 },
    { hex: '#D98A8A', ml: 3 },
  ];
  return (
    <Section enter="bloom" className="relative">
      <div className="relative max-w-container-lg mx-auto px-6 py-20 grid lg:grid-cols-[1fr_1fr] gap-10 items-center">
        <div className="flex flex-col gap-4">
          <span className="pl-label text-mustard-soft">03 · the lab cart</span>
          <h2 className="font-display font-bold text-display-md text-cream-50">
            Batch a few pieces, see the full paint plan.
          </h2>
          <p className="text-cream-100 max-w-md">
            The cart is a production plan. Drop in the pieces you want to make. Painto's Lab rolls
            up the colors needed across every piece, rounds up so nobody runs out mid-stroke, and
            warns when a base paint is short.
          </p>
        </div>
        <div className="relative">
          <Card>
            <CardEyebrow>Batch palette</CardEyebrow>
            <CardTitle>8 colors · 120 ml total</CardTitle>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {palette.map((p) => (
                <ColorChip key={p.hex} hex={p.hex} totalMl={p.ml} size="md" />
              ))}
            </div>
          </Card>
          <Blob
            shape="soft"
            color="clay-pink"
            size={140}
            className="pointer-events-none absolute -bottom-8 -left-8 opacity-80"
            outlined
          />
        </div>
      </div>
    </Section>
  );
}

// ----- Stock section ------------------------------------------

function StockSection() {
  const bases = [
    { hex: '#e8b23c', name: 'Mustard', cur: 420, cap: 500 },
    { hex: '#2fa39b', name: 'Teal', cur: 280, cap: 500 },
    { hex: '#c8593a', name: 'Terracotta', cur: 90, cap: 500 },
    { hex: '#0d3d3a', name: 'Swamp green', cur: 380, cap: 500 },
  ];
  return (
    <Section enter="drip" className="relative">
      <div className="relative max-w-container-lg mx-auto px-6 py-20 flex flex-col gap-10">
        <div className="flex flex-col gap-3 max-w-2xl">
          <span className="pl-label text-mustard-soft">04 · stock</span>
          <h2 className="font-display font-bold text-display-md text-cream-50">
            Every base paint is a cartridge.
          </h2>
          <p className="text-cream-100">
            The signature container. Liquid sloshes with your phone, drips down when you mix, fills
            up when you top off. Low stock waves a flag before the batch even starts.
          </p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {bases.map((b) => (
            <div
              key={b.name}
              className="flex flex-col items-center gap-2 bg-swamp-600 border-thick border-ink-900 rounded-lg p-4"
            >
              <LiquidContainer
                color={b.hex}
                label={b.name}
                capacityMl={b.cap}
                currentMl={b.cur}
                width={140}
              />
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}

// ----- Final CTA ----------------------------------------------

function FinalCTA() {
  return (
    <Section enter="splash" className="relative">
      <div className="relative max-w-container-md mx-auto px-6 py-20 text-center flex flex-col gap-6 items-center">
        <Splat
          color="mustard"
          size={200}
          className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 opacity-30"
        />
        <h2 className="relative font-display font-black text-display-lg text-cream-50 tracking-display leading-none">
          One operator, one lab, every kit.
        </h2>
        <p className="relative text-cream-100 max-w-md">
          No accounts. No payments. Just step into the greenhouse and start brewing.
        </p>
        <Link to="/login" className="relative">
          <Button size="lg">Open the lab</Button>
        </Link>
      </div>
    </Section>
  );
}
