import { cn } from '../../lib/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg';

const sizes: Record<SpinnerSize, number> = { sm: 18, md: 28, lg: 44 };

// Paint-drip spinner: an ink-outlined droplet that orbits a mustard core.
export default function Spinner({
  size = 'md',
  className,
  label = 'Loading',
}: {
  size?: SpinnerSize;
  className?: string;
  label?: string;
}) {
  const px = sizes[size];
  return (
    <span
      role="status"
      aria-label={label}
      className={cn('inline-flex pl-spinner', className)}
      style={{ width: px, height: px }}
    >
      <svg viewBox="0 0 44 44" width={px} height={px} aria-hidden>
        <defs>
          <path
            id="pl-drip"
            d="M22 4c4 6 9 11 9 17a9 9 0 1 1-18 0c0-6 5-11 9-17z"
          />
        </defs>
        <circle cx="22" cy="22" r="6" fill="var(--mustard)" stroke="var(--ink-900)" strokeWidth="2" />
        <g className="pl-spinner-rot" style={{ transformOrigin: '22px 22px' }}>
          <use href="#pl-drip" fill="var(--teal)" stroke="var(--ink-900)" strokeWidth="2.5" />
        </g>
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
