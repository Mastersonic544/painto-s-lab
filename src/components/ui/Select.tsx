import { SelectHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '../../lib/cn';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  label?: string;
  hint?: string;
  error?: string;
  options: SelectOption[];
  placeholder?: string;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, placeholder, id, className, disabled, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label htmlFor={inputId} className="pl-label text-cream-200">
          {label}
        </label>
      )}
      <div
        className={cn(
          'relative rounded-md border-thick border-ink-900 bg-cream-100 shadow-inset',
          'focus-within:shadow-focus transition-shadow duration-fast',
          disabled && 'opacity-60 cursor-not-allowed',
          error && 'border-terracotta-deep',
        )}
      >
        <select
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          className={cn(
            'appearance-none w-full bg-transparent outline-none px-3 py-2.5 pr-9',
            'text-text-on-light font-body text-base',
            'disabled:cursor-not-allowed',
            className,
          )}
          {...rest}
        >
          {placeholder && (
            <option value="" disabled hidden>
              {placeholder}
            </option>
          )}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-on-light font-mono"
        >
          ▼
        </span>
      </div>
      {(hint || error) && (
        <span className={cn('pl-label', error ? 'text-terracotta-soft' : 'text-text-on-dark-muted')}>
          {error ?? hint}
        </span>
      )}
    </div>
  );
});

export default Select;
