import { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface PillProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children?: ReactNode;
}

// Toggleable pill for segmented filters (Simple / Normal / Complex etc.).
export default function Pill({
  active = false,
  className,
  type = 'button',
  children,
  ...rest
}: PillProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center rounded-pill border-thick border-ink-900 px-4 py-1.5',
        'font-display font-bold text-sm transition-all duration-fast ease-squish',
        'focus-visible:outline-none focus-visible:shadow-focus',
        'active:scale-[0.96] active:translate-x-[2px] active:translate-y-[2px] active:shadow-sticker-press',
        active
          ? 'bg-mustard text-ink-900 shadow-sticker-sm'
          : 'bg-cream-100 text-text-on-light hover:bg-cream-200',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
