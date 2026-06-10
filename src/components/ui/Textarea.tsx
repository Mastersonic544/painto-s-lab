import { TextareaHTMLAttributes, forwardRef, useId } from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, id, className, disabled, rows = 4, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label htmlFor={inputId} className="pl-label text-text-on-light">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={inputId}
        rows={rows}
        disabled={disabled}
        aria-invalid={Boolean(error) || undefined}
        aria-describedby={hint || error ? `${inputId}-msg` : undefined}
        className={cn(
          'rounded-md border-thick border-ink-900 bg-cream-100 shadow-inset',
          'px-3 py-2.5 text-text-on-light font-body text-base placeholder:text-text-on-light-muted',
          'focus:outline-none focus:shadow-focus transition-shadow duration-fast resize-y',
          disabled && 'opacity-60 cursor-not-allowed',
          error && 'border-terracotta-deep',
          className,
        )}
        {...rest}
      />
      {(hint || error) && (
        <span
          id={`${inputId}-msg`}
          className={cn(
            'pl-label',
            error ? 'text-terracotta-deep' : 'text-text-on-light-muted',
          )}
        >
          {error ?? hint}
        </span>
      )}
    </div>
  );
});

export default Textarea;
