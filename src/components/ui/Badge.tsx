import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type BadgeTone = 'mustard' | 'teal' | 'terracotta' | 'olive' | 'plum' | 'cream' | 'swamp';

const toneClasses: Record<BadgeTone, string> = {
  mustard: 'bg-mustard text-ink-900',
  teal: 'bg-teal text-cream-50',
  terracotta: 'bg-terracotta text-cream-50',
  olive: 'bg-olive text-ink-900',
  plum: 'bg-plum text-cream-50',
  cream: 'bg-cream-200 text-ink-900',
  swamp: 'bg-swamp-600 text-cream-100',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  children?: ReactNode;
}

// Tiny mono-label pill. For status counts / inline tags.
export default function Badge({ tone = 'mustard', className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-pill border-thin border-ink-900',
        'pl-label px-2 py-0.5',
        toneClasses[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}
