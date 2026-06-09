import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import type { CropRect } from '../../lib/image';

interface Props {
  /** Object URL of the image to crop. */
  src: string;
  /** Fires with the normalized crop on every change (and once on load). */
  onChange?: (crop: CropRect) => void;
  className?: string;
}

type Corner = 'nw' | 'ne' | 'sw' | 'se';
type Drag =
  | { kind: 'move'; startX: number; startY: number; orig: CropRect }
  | { kind: 'resize'; corner: Corner; orig: CropRect }
  | null;

const MIN = 0.08; // minimum crop size as a fraction of each dimension

function clampRect(r: CropRect): CropRect {
  let { x, y, w, h } = r;
  w = Math.min(Math.max(w, MIN), 1);
  h = Math.min(Math.max(h, MIN), 1);
  x = Math.min(Math.max(x, 0), 1 - w);
  y = Math.min(Math.max(y, 0), 1 - h);
  return { x, y, w, h };
}

// Crop tool that defaults to the full image (the whole frame is the border).
// Drag the box to move it, drag a corner to resize. Coordinates are kept
// normalized (0..1) so they're resolution-independent.
export default function ImageCropper({ src, onChange, className }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag>(null);
  const [crop, setCrop] = useState<CropRect>({ x: 0, y: 0, w: 1, h: 1 });

  // Reset to full frame whenever the image changes.
  useEffect(() => {
    const full: CropRect = { x: 0, y: 0, w: 1, h: 1 };
    setCrop(full);
    onChange?.(full);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  function toNorm(e: ReactPointerEvent) {
    const el = wrapRef.current;
    if (!el) return { nx: 0, ny: 0 };
    const r = el.getBoundingClientRect();
    return { nx: (e.clientX - r.left) / r.width, ny: (e.clientY - r.top) / r.height };
  }

  function commit(next: CropRect) {
    const c = clampRect(next);
    setCrop(c);
    onChange?.(c);
  }

  function onMove(e: ReactPointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const { nx, ny } = toNorm(e);
    if (d.kind === 'move') {
      commit({ ...d.orig, x: d.orig.x + (nx - d.startX), y: d.orig.y + (ny - d.startY) });
      return;
    }
    let { x, y, w, h } = d.orig;
    const right = x + w;
    const bottom = y + h;
    if (d.corner === 'nw') {
      x = Math.min(nx, right - MIN);
      y = Math.min(ny, bottom - MIN);
      w = right - x;
      h = bottom - y;
    } else if (d.corner === 'ne') {
      y = Math.min(ny, bottom - MIN);
      w = Math.max(nx - x, MIN);
      h = bottom - y;
    } else if (d.corner === 'sw') {
      x = Math.min(nx, right - MIN);
      w = right - x;
      h = Math.max(ny - y, MIN);
    } else {
      w = Math.max(nx - x, MIN);
      h = Math.max(ny - y, MIN);
    }
    commit({ x, y, w, h });
  }

  function endDrag(e: ReactPointerEvent) {
    dragRef.current = null;
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  }

  function startMove(e: ReactPointerEvent) {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const { nx, ny } = toNorm(e);
    dragRef.current = { kind: 'move', startX: nx, startY: ny, orig: crop };
  }

  const startResize = (corner: Corner) => (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { kind: 'resize', corner, orig: crop };
  };

  const cornerPos: Record<Corner, string> = {
    nw: '-left-2 -top-2 cursor-nwse-resize',
    ne: '-right-2 -top-2 cursor-nesw-resize',
    sw: '-left-2 -bottom-2 cursor-nesw-resize',
    se: '-right-2 -bottom-2 cursor-nwse-resize',
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        ref={wrapRef}
        className="relative w-full select-none touch-none"
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <img
          src={src}
          alt="Crop the source"
          draggable={false}
          className="block w-full rounded-md border-thick border-ink-900 pointer-events-none"
        />
        {/* The crop window. The big box-shadow dims everything outside it. */}
        <div
          onPointerDown={startMove}
          className="absolute border-2 border-cream-50 cursor-move"
          style={{
            left: `${crop.x * 100}%`,
            top: `${crop.y * 100}%`,
            width: `${crop.w * 100}%`,
            height: `${crop.h * 100}%`,
            boxShadow: '0 0 0 9999px rgba(8, 40, 38, 0.55)',
          }}
        >
          {(['nw', 'ne', 'sw', 'se'] as Corner[]).map((c) => (
            <span
              key={c}
              onPointerDown={startResize(c)}
              className={cn(
                'absolute h-4 w-4 rounded-sm bg-mustard border-2 border-ink-900',
                cornerPos[c],
              )}
            />
          ))}
        </div>
      </div>
      <p className="pl-label text-text-on-light-muted">
        Drag the frame to move it, drag a corner to resize. Defaults to the whole photo.
      </p>
    </div>
  );
}
