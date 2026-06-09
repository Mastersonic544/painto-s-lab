import { InputHTMLAttributes, forwardRef, ReactNode, useId } from 'react';
import { cn } from '../../lib/cn';

export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  hint?: string;
}

const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, hint, id, className, disabled, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'inline-flex items-start gap-3 cursor-pointer select-none',
        disabled && 'opacity-60 cursor-not-allowed',
      )}
    >
      <span className="relative inline-flex h-7 w-12 shrink-0 mt-0.5">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          role="switch"
          disabled={disabled}
          className={cn(
            'peer absolute inset-0 appearance-none rounded-pill border-thick border-ink-900',
            'bg-cream-300 cursor-pointer disabled:cursor-not-allowed',
            'checked:bg-teal',
            'focus-visible:outline-none focus-visible:shadow-focus transition-all duration-fast',
            className,
          )}
          {...rest}
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-0.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full',
            'bg-cream-50 border-thin border-ink-900',
            'transition-transform duration-fast ease-squish',
            'peer-checked:translate-x-[20px]',
          )}
        />
      </span>
      {label && (
        <span className="flex flex-col gap-1">
          <span className="font-body text-base text-cream-100">{label}</span>
          {hint && <span className="pl-label text-text-on-dark-muted">{hint}</span>}
        </span>
      )}
    </label>
  );
});

export default Switch;
