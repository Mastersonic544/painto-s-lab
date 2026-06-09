import { InputHTMLAttributes, forwardRef, ReactNode, useId } from 'react';
import { cn } from '../../lib/cn';

export interface RadioProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode;
  hint?: string;
}

const Radio = forwardRef<HTMLInputElement, RadioProps>(function Radio(
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
      <span className="relative inline-flex h-6 w-6 shrink-0 mt-0.5">
        <input
          ref={ref}
          id={inputId}
          type="radio"
          disabled={disabled}
          className={cn(
            'peer absolute inset-0 appearance-none rounded-full border-thick border-ink-900',
            'bg-cream-100 cursor-pointer disabled:cursor-not-allowed',
            'focus-visible:outline-none focus-visible:shadow-focus transition-shadow duration-fast',
            className,
          )}
          {...rest}
        />
        <span className="pointer-events-none absolute inset-0 m-1.5 rounded-full bg-mustard scale-0 peer-checked:scale-100 transition-transform duration-fast ease-squish" />
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

export default Radio;
