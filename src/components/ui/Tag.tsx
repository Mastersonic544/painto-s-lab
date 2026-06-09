import { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  onRemove?: () => void;
  children?: ReactNode;
}

// Cream chip with ink outline, optional remove. Used to mark colors / filters.
export default function Tag({ onRemove, className, children, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2 rounded-pill border-thin border-ink-900',
        'bg-cream-100 text-text-on-light font-body font-bold text-sm px-3 py-1',
        className,
      )}
      {...rest}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          aria-label="Remove"
          onClick={onRemove}
          className="-mr-1 h-5 w-5 rounded-full border-thin border-ink-900 bg-terracotta text-cream-50 grid place-items-center text-xs hover:bg-terracotta-deep transition-colors duration-fast"
        >
          ×
        </button>
      )}
    </span>
  );
}
