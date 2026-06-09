import { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export type BlobShape = 1 | 2 | 3 | 'soft';
export type BlobColor =
  | 'mustard'
  | 'teal'
  | 'terracotta'
  | 'olive'
  | 'plum'
  | 'clay-pink'
  | 'cream';

const colorClasses: Record<BlobColor, string> = {
  mustard: 'bg-mustard',
  teal: 'bg-teal',
  terracotta: 'bg-terracotta',
  olive: 'bg-olive',
  plum: 'bg-plum',
  'clay-pink': 'bg-clay-pink',
  cream: 'bg-cream-200',
};

export interface BlobProps extends HTMLAttributes<HTMLDivElement> {
  shape?: BlobShape;
  color?: BlobColor;
  size?: number;
  outlined?: boolean;
}

// Irregular paint-blob shape using the design-system --blob-* radii. Purely
// decorative — accepts pointer-events:none from callers when used as backdrop.
export default function Blob({
  shape = 1,
  color = 'olive',
  size = 160,
  outlined = false,
  className,
  style,
  ...rest
}: BlobProps) {
  return (
    <div
      aria-hidden
      className={cn(colorClasses[color], outlined && 'border-thick border-ink-900', className)}
      style={{
        width: size,
        height: size,
        borderRadius: `var(--blob-${shape})`,
        ...style,
      }}
      {...rest}
    />
  );
}
