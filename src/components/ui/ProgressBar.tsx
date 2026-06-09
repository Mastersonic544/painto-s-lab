import { cn } from '../../lib/cn';

export interface ProgressBarProps {
  /** 0–100 */
  value: number;
  label?: string;
  tone?: 'mustard' | 'teal' | 'terracotta';
  className?: string;
}

const tones = {
  mustard: 'bg-mustard',
  teal: 'bg-teal',
  terracotta: 'bg-terracotta',
} as const;

export default function ProgressBar({
  value,
  label,
  tone = 'teal',
  className,
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {label && (
        <div className="flex items-baseline justify-between">
          <span className="pl-label text-cream-200">{label}</span>
          <span className="font-mono text-sm text-cream-200">{Math.round(clamped)}%</span>
        </div>
      )}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(clamped)}
        className="h-4 rounded-pill border-thick border-ink-900 bg-cream-100 overflow-hidden shadow-inset"
      >
        <div
          className={cn('h-full transition-all duration-bloom ease-drip', tones[tone])}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
