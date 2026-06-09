import { InputHTMLAttributes, forwardRef, ReactNode, useId } from 'react';
import { cn } from '../../lib/cn';

// `prefix` collides with HTMLAttributes.prefix (a string). Rename to
// leadingAddon / trailingAddon so the JSX prop accepts ReactNode cleanly.
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  hint?: string;
  error?: string;
  leadingAddon?: ReactNode;
  trailingAddon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, leadingAddon, trailingAddon, id, className, disabled, ...rest },
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
          'flex items-center gap-2 rounded-md border-thick border-ink-900 bg-cream-100',
          'shadow-inset focus-within:shadow-focus transition-shadow duration-fast',
          disabled && 'opacity-60 cursor-not-allowed',
          error && 'border-terracotta-deep',
        )}
      >
        {leadingAddon && (
          <span className="pl-3 text-text-on-light-muted font-mono text-sm shrink-0">
            {leadingAddon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          disabled={disabled}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={hint || error ? `${inputId}-msg` : undefined}
          className={cn(
            'flex-1 bg-transparent outline-none px-3 py-2.5 text-text-on-light font-body text-base',
            'placeholder:text-text-on-light-muted disabled:cursor-not-allowed',
            className,
          )}
          {...rest}
        />
        {trailingAddon && (
          <span className="pr-3 text-text-on-light-muted font-mono text-sm shrink-0">
            {trailingAddon}
          </span>
        )}
      </div>
      {(hint || error) && (
        <span
          id={`${inputId}-msg`}
          className={cn(
            'pl-label',
            error ? 'text-terracotta-soft' : 'text-text-on-dark-muted',
          )}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
});

export default Input;
