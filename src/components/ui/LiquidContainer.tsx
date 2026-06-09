import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

export interface LiquidContainerProps {
  /** Fill level 0–100 (overrides currentMl/capacityMl if both passed). */
  fillPct?: number;
  /** Paint hex / CSS color used for the liquid. */
  color: string;
  /** Container label, eg. "Mustard". */
  label?: string;
  capacityMl?: number;
  currentMl?: number;
  className?: string;
  /** Width of the cartridge in CSS px. Height scales 1.4×. */
  width?: number;
}

const VBW = 200;
const VBH = 280;

// iOS-style permission interface. Other browsers expose no requestPermission.
type IOSOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>;
};

function needsPermission(): boolean {
  const E = (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent as
    | IOSOrientationEvent
    | undefined;
  return typeof E?.requestPermission === 'function';
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Paint cartridge: thick ink outline, transparent window, animated wave,
// device-tilt sloshing on touch devices. Falls back to a static angled fill
// under reduced motion or without sensor access.
export default function LiquidContainer({
  fillPct,
  color,
  label,
  capacityMl,
  currentMl,
  className,
  width = 200,
}: LiquidContainerProps) {
  const computedPct =
    fillPct ?? (capacityMl && currentMl != null ? (currentMl / capacityMl) * 100 : 50);
  const pct = Math.max(0, Math.min(100, computedPct));

  // Tilt in degrees (-15..15) driven by deviceorientation gamma. Damped so it
  // settles like real liquid rather than jittering on every motion frame.
  const tiltRef = useRef(0);
  const velRef = useRef(0);
  const [tilt, setTilt] = useState(0);
  const [permState, setPermState] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'unavailable'>(
    needsPermission() ? 'idle' : 'granted',
  );
  const targetRef = useRef(0);

  const reduced = useMemo(() => prefersReducedMotion(), []);

  useEffect(() => {
    if (permState !== 'granted' || reduced) return;
    const onOrient = (ev: DeviceOrientationEvent) => {
      const gamma = ev.gamma ?? 0; // left/right tilt, -90..90
      // Clamp & scale to a believable sway range.
      targetRef.current = Math.max(-15, Math.min(15, gamma / 3));
    };
    window.addEventListener('deviceorientation', onOrient);
    let raf = 0;
    const tick = () => {
      // Spring-damp toward target: k = stiffness, c = damping.
      const k = 0.08;
      const c = 0.78;
      const force = (targetRef.current - tiltRef.current) * k;
      velRef.current = (velRef.current + force) * c;
      tiltRef.current += velRef.current;
      setTilt(tiltRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      cancelAnimationFrame(raf);
    };
  }, [permState, reduced]);

  async function requestSensor() {
    const E = (globalThis as { DeviceOrientationEvent?: unknown }).DeviceOrientationEvent as
      | IOSOrientationEvent
      | undefined;
    if (!E?.requestPermission) {
      setPermState('unavailable');
      return;
    }
    setPermState('requesting');
    try {
      const result = await E.requestPermission();
      setPermState(result === 'granted' ? 'granted' : 'denied');
    } catch {
      setPermState('denied');
    }
  }

  // Layout: outer cartridge body, inner window rect, then SVG liquid.
  const windowPad = 18;
  const windowX = windowPad;
  const windowY = 56;
  const windowW = VBW - windowPad * 2;
  const windowH = VBH - windowY - 32;

  // Liquid surface Y inside the window (top of liquid).
  const surfaceY = windowY + windowH - (windowH * pct) / 100;

  // Neck/label pill sized to the ACTUAL rendered label width (measured from
  // the DOM) so long names ("PAINTO'S LAB") can never overflow the pill,
  // regardless of which font ends up loaded.
  const labelText = (label ?? '').toUpperCase();
  const labelLong = labelText.length > 14;
  const labelFontSize = labelLong ? 11 : 13;
  const labelSpacing = labelLong ? 1 : 2;
  // First-paint estimate; replaced by the measured width on layout.
  const estTextW = labelText.length * (labelFontSize * 0.62 + labelSpacing);
  const labelRef = useRef<SVGTextElement>(null);
  const [measuredW, setMeasuredW] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (labelRef.current) setMeasuredW(labelRef.current.getComputedTextLength());
  }, [labelText, labelFontSize, labelSpacing]);
  const textW = measuredW ?? estTextW;
  const neckW = Math.max(88, Math.min(VBW - 16, textW + 28));
  const neckX = (VBW - neckW) / 2;
  // If the text is wider than the widest possible pill, compress it to fit.
  const constrainText = textW > neckW - 16;

  return (
    <div
      className={cn('inline-flex flex-col items-stretch gap-2', className)}
      style={{ width }}
    >
      <svg
        viewBox={`0 0 ${VBW} ${VBH}`}
        width={width}
        height={width * 1.4}
        role="img"
        aria-label={`${label ?? 'Paint container'} at ${Math.round(pct)} percent full`}
      >
        {/* Cartridge body */}
        <defs>
          <clipPath id="pl-window-clip">
            <rect
              x={windowX}
              y={windowY}
              width={windowW}
              height={windowH}
              rx="14"
              ry="14"
            />
          </clipPath>
          {/* Glossy sheen: light highlight up top, shadow pooling at the
              bottom, so the flat fill reads as a 3D body of liquid. */}
          <linearGradient id="pl-liquid-sheen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.30)" />
            <stop offset="42%" stopColor="rgba(255,255,255,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.32)" />
          </linearGradient>
        </defs>

        {/* Outer shell */}
        <rect
          x="6"
          y="6"
          width={VBW - 12}
          height={VBH - 12}
          rx="22"
          ry="22"
          fill="var(--cream-200)"
          stroke="var(--ink-900)"
          strokeWidth="4"
        />
        {/* Top neck — width tracks the label so it never overflows */}
        <rect
          x={neckX}
          y="14"
          width={neckW}
          height="34"
          rx="10"
          ry="10"
          fill="var(--cream-100)"
          stroke="var(--ink-900)"
          strokeWidth="3"
        />
        {/* Label band */}
        {label && (
          <text
            ref={labelRef}
            x={VBW / 2}
            y="40"
            textAnchor="middle"
            fontFamily="var(--font-mono)"
            fontSize={labelFontSize}
            fontWeight="700"
            letterSpacing={labelSpacing}
            fill="var(--ink-900)"
            {...(constrainText
              ? { textLength: neckW - 16, lengthAdjust: 'spacingAndGlyphs' as const }
              : {})}
          >
            {labelText}
          </text>
        )}
        {/* Transparent window (back well) */}
        <rect
          x={windowX}
          y={windowY}
          width={windowW}
          height={windowH}
          rx="14"
          ry="14"
          fill="var(--swamp-900)"
        />
        {/* Liquid + wave, clipped to window */}
        <g clipPath="url(#pl-window-clip)">
          <g
            style={{
              transform: `rotate(${tilt}deg)`,
              transformOrigin: `${VBW / 2}px ${surfaceY}px`,
              transition: 'transform var(--dur-fast) var(--ease-drip)',
            }}
          >
            {/* Solid body of liquid */}
            <rect
              x={windowX - 20}
              y={surfaceY}
              width={windowW + 40}
              height={windowH + 80}
              fill={color}
              style={{ transition: 'y var(--dur-bloom) var(--ease-drip)' }}
            />
            {/* Wavy surface — two cycles, animated horizontally */}
            <g
              className={reduced ? undefined : 'pl-wave'}
              style={{ transform: `translateY(${surfaceY}px)` }}
            >
              <path
                d={`M -${windowW} 0
                    Q -${windowW * 0.75} -8 -${windowW / 2} 0
                    T 0 0
                    T ${windowW / 2} 0
                    T ${windowW} 0
                    T ${windowW * 1.5} 0
                    T ${windowW * 2} 0
                    L ${windowW * 2} 40 L -${windowW} 40 Z`}
                fill={color}
                opacity="0.95"
              />
            </g>
            {/* Sheen overlay — gives the liquid volume without color math */}
            <rect
              x={windowX - 20}
              y={surfaceY}
              width={windowW + 40}
              height={windowH + 80}
              fill="url(#pl-liquid-sheen)"
              style={{ transition: 'y var(--dur-bloom) var(--ease-drip)' }}
            />
          </g>
        </g>
        {/* Window outline on top (so liquid sits behind the ink line) */}
        <rect
          x={windowX}
          y={windowY}
          width={windowW}
          height={windowH}
          rx="14"
          ry="14"
          fill="none"
          stroke="var(--ink-900)"
          strokeWidth="4"
        />
        {/* Bottom feet */}
        <rect
          x="28"
          y={VBH - 22}
          width="36"
          height="10"
          rx="3"
          fill="var(--ink-900)"
        />
        <rect
          x={VBW - 64}
          y={VBH - 22}
          width="36"
          height="10"
          rx="3"
          fill="var(--ink-900)"
        />
      </svg>

      <div className="flex items-baseline justify-between">
        <span className="pl-label text-cream-200">{label ?? 'Paint'}</span>
        <span className="font-mono text-sm text-cream-200">
          {currentMl != null && capacityMl != null
            ? `${Math.round(currentMl)} / ${capacityMl} ml`
            : `${Math.round(pct)}%`}
        </span>
      </div>

      {permState === 'idle' && (
        <button
          type="button"
          onClick={requestSensor}
          className="font-display font-bold text-sm text-ink-900 bg-mustard border-thick border-ink-900 rounded-pill px-3 py-1 shadow-sticker-xs hover:shadow-sticker-press hover:translate-x-[2px] hover:translate-y-[2px] transition-all duration-fast ease-squish"
        >
          Enable tilt
        </button>
      )}
      {permState === 'denied' && (
        <span className="pl-label text-terracotta-soft">Tilt access denied</span>
      )}
    </div>
  );
}
