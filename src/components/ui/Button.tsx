import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import Spinner from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

// Press behavior is shared across variants: squish to scale(0.96) and settle
// 3px into the sticker shadow using --ease-squish.
const pressClasses =
  'active:scale-[0.96] active:translate-x-[3px] active:translate-y-[3px] active:shadow-sticker-press';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-mustard text-ink-900 border-thick border-ink-900 shadow-sticker hover:bg-mustard-soft',
  secondary: 'bg-teal text-cream-50 border-thick border-ink-900 shadow-sticker hover:bg-teal-soft',
  tertiary:
    'bg-terracotta text-cream-50 border-thick border-ink-900 shadow-sticker hover:bg-terracotta-soft',
  ghost:
    'bg-transparent text-cream-200 border-thick border-cream-200 shadow-none hover:bg-swamp-600',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm gap-2',
  md: 'h-11 px-5 text-base gap-2',
  lg: 'h-14 px-7 text-lg gap-3',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    disabled,
    leftIcon,
    rightIcon,
    className,
    children,
    type = 'button',
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      aria-busy={loading || undefined}
      disabled={isDisabled}
      className={cn(
        'inline-flex items-center justify-center font-display font-bold rounded-pill select-none',
        'transition-all duration-fast ease-squish',
        'focus-visible:outline-none focus-visible:shadow-focus',
        variantClasses[variant],
        sizeClasses[size],
        pressClasses,
        isDisabled && 'opacity-60 cursor-not-allowed active:translate-x-0 active:translate-y-0 active:scale-100',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={size === 'lg' ? 'md' : 'sm'} />
      ) : (
        leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
    </button>
  );
});

export default Button;
