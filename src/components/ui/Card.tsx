import { HTMLAttributes, ReactNode, forwardRef } from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Use the cream paper grain. Default true. */
  paper?: boolean;
  /** Apply the hard ink-offset sticker shadow. Default true. */
  sticker?: boolean;
  /** Rotation in degrees, e.g. -2 for a casually tilted card. */
  tilt?: number;
  children?: ReactNode;
}

// Cream paper card with ink outline + sticker shadow. The .pl-paper helper
// supplies the dot-grain texture; .pl-sticker supplies outline + shadow.
const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { paper = true, sticker = true, tilt, className, style, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        paper && 'pl-paper',
        sticker && 'pl-sticker',
        'text-text-on-light p-6',
        className,
      )}
      style={tilt ? { transform: `rotate(${tilt}deg)`, ...style } : style}
      {...rest}
    >
      {children}
    </div>
  );
});

export default Card;

export function CardHeader({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-1 mb-4', className)} {...rest}>
      {children}
    </div>
  );
}

export function CardEyebrow({ className, children, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('pl-label text-text-on-light-muted', className)} {...rest}>
      {children}
    </span>
  );
}

export function CardTitle({ className, children, ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={cn('font-display font-bold text-h2 text-text-on-light', className)} {...rest}>
      {children}
    </h3>
  );
}
