import {
  PointerEvent as ReactPointerEvent,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/cn';

export interface ComparisonSliderHandle {
  /** The DOM node containing the filled SVG (left side). */
  getFilledRoot(): HTMLDivElement | null;
  /** The DOM node containing the outline SVG (right side). */
  getOutlineRoot(): HTMLDivElement | null;
}

export interface ComparisonSliderProps {
  filledSvg: string;
  outlineSvg: string;
  initialSplit?: number;
  aspectRatio?: number; // width/height, defaults to inferred
  /**
   * Click delegation. Fires on any click inside the SVGs that isn't on the
   * handle. Receives the path's data-facetId if the click landed on a facet
   * `<path>`, and the label group's data-facetId if it landed on a label.
   */
  onFacetClick?: (facetId: number, ev: MouseEvent) => void;
  onLabelClick?: (facetId: number, ev: MouseEvent) => void;
  className?: string;
}

/**
 * Vertical split slider. Drag left to reveal the filled preview, drag right
 * to reveal the numbered outline. Smooth on pointer + touch via Pointer
 * Events with pointer capture.
 */
const ComparisonSlider = forwardRef<ComparisonSliderHandle, ComparisonSliderProps>(
  function ComparisonSlider(
    {
      filledSvg,
      outlineSvg,
      initialSplit = 0.5,
      aspectRatio,
      onFacetClick,
      onLabelClick,
      className,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const filledRef = useRef<HTMLDivElement | null>(null);
    const outlineRef = useRef<HTMLDivElement | null>(null);
    const [split, setSplit] = useState(clamp01(initialSplit));
    const [dragging, setDragging] = useState(false);

    useImperativeHandle(ref, () => ({
      getFilledRoot: () => filledRef.current,
      getOutlineRoot: () => outlineRef.current,
    }));

    // Mount the SVG strings as innerHTML. We keep React out of the SVG
    // internals so the edit helpers can mutate paths/labels without
    // having to round-trip through component state.
    useEffect(() => {
      if (filledRef.current) filledRef.current.innerHTML = filledSvg;
      if (outlineRef.current) outlineRef.current.innerHTML = outlineSvg;
    }, [filledSvg, outlineSvg]);

    const moveTo = useCallback((clientX: number) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = clientX - rect.left;
      setSplit(clamp01(x / rect.width));
    }, []);

    const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(true);
      (e.target as Element).setPointerCapture?.(e.pointerId);
      moveTo(e.clientX);
    };
    const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      moveTo(e.clientX);
    };
    const stopDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
      setDragging(false);
      (e.target as Element).releasePointerCapture?.(e.pointerId);
    };

    // Click delegation for the edit modes. We attach a single listener on
    // the container and walk up to the nearest [data-facetId] node.
    useEffect(() => {
      if (!onFacetClick && !onLabelClick) return;
      const node = containerRef.current;
      if (!node) return;
      function findFacetTarget(el: Element | null): { type: 'facet' | 'label'; id: number } | null {
        let cur: Element | null = el;
        while (cur && cur !== node) {
          if (cur.classList?.contains('label')) {
            const id = Number(cur.getAttribute('data-facetId') ?? cur.querySelector('[data-facetId]')?.getAttribute('data-facetId') ?? NaN);
            if (Number.isFinite(id)) return { type: 'label', id };
          }
          const attr = cur.getAttribute('data-facetId');
          if (attr != null) {
            const id = Number(attr);
            if (Number.isFinite(id)) {
              return { type: cur.tagName.toLowerCase() === 'g' ? 'label' : 'facet', id };
            }
          }
          cur = cur.parentElement;
        }
        return null;
      }
      const handler = (e: MouseEvent) => {
        // Don't treat handle clicks as edits.
        if ((e.target as HTMLElement).closest('[data-slider-handle]')) return;
        const hit = findFacetTarget(e.target as Element | null);
        if (!hit) return;
        if (hit.type === 'label') onLabelClick?.(hit.id, e);
        else onFacetClick?.(hit.id, e);
      };
      node.addEventListener('click', handler);
      return () => node.removeEventListener('click', handler);
    }, [onFacetClick, onLabelClick]);

    const aspectStyle = aspectRatio
      ? { aspectRatio: String(aspectRatio) }
      : { aspectRatio: '16 / 9' };

    return (
      <div
        ref={containerRef}
        className={cn(
          'relative w-full overflow-hidden border-thick border-ink-900 rounded-md bg-cream-50 select-none',
          className,
        )}
        style={aspectStyle}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onPointerLeave={(e) => dragging && stopDrag(e)}
      >
        {/* Filled (left side). Always rendered full-size; the outline layer
            sits on top and clips its left edge to the split point. */}
        <div
          ref={filledRef}
          className="absolute inset-0 [&>svg]:block [&>svg]:w-full [&>svg]:h-full"
          aria-hidden="false"
        />
        {/* Outline (right side). clip-path inset hides everything left of the split. */}
        <div
          ref={outlineRef}
          className="absolute inset-0 [&>svg]:block [&>svg]:w-full [&>svg]:h-full"
          style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}
          aria-hidden="false"
        />

        {/* Divider rule */}
        <div
          className="absolute top-0 bottom-0 w-[3px] bg-ink-900 pointer-events-none"
          style={{ left: `calc(${split * 100}% - 1.5px)` }}
        />

        {/* Handle */}
        <div
          data-slider-handle
          role="slider"
          aria-label="Reveal more outline or more filled preview"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setSplit((s) => clamp01(s - 0.02));
            if (e.key === 'ArrowRight') setSplit((s) => clamp01(s + 0.02));
          }}
          onPointerDown={onPointerDown}
          className={cn(
            'absolute top-1/2 -translate-y-1/2 -translate-x-1/2',
            'h-14 w-14 rounded-full border-thick border-ink-900 bg-mustard',
            'grid place-items-center shadow-sticker',
            'cursor-grab active:cursor-grabbing touch-none',
            'transition-shadow duration-fast ease-squish',
            'focus-visible:outline-none focus-visible:shadow-focus',
            dragging && 'shadow-sticker-press translate-x-[calc(-50%+3px)] translate-y-[calc(-50%+3px)]',
          )}
          style={{ left: `${split * 100}%` }}
        >
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
            <path
              d="M9 6 L4 12 L9 18 M15 6 L20 12 L15 18"
              fill="none"
              stroke="var(--ink-900)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>
    );
  },
);

export default ComparisonSlider;

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}
