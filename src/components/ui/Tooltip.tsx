import { ReactNode, cloneElement, isValidElement, useId, useState } from 'react';
import { cn } from '../../lib/cn';

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom';
  className?: string;
}

// Lightweight CSS-positioned tooltip. Visible on hover + focus.
export default function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = isValidElement(children)
    ? cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        'aria-describedby': id,
        onMouseEnter: () => setOpen(true),
        onMouseLeave: () => setOpen(false),
        onFocus: () => setOpen(true),
        onBlur: () => setOpen(false),
      })
    : children;
  return (
    <span className="relative inline-flex">
      {trigger}
      <span
        id={id}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute left-1/2 -translate-x-1/2 z-50',
          'whitespace-nowrap rounded-md border-thick border-ink-900 bg-cream-100 text-text-on-light',
          'px-3 py-1.5 font-body text-sm shadow-sticker-xs',
          'transition-opacity duration-fast',
          open ? 'opacity-100' : 'opacity-0',
          side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          className,
        )}
      >
        {content}
      </span>
    </span>
  );
}
