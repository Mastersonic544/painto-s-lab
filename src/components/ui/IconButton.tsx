import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type IconButtonSize = 'sm' | 'md' | 'lg';
export type IconButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'ghost';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize;
  variant?: IconButtonVariant;
  label: string;
  children: ReactNode;
}

const sizes: Record<IconButtonSize, string> = {
  sm: 'h-9 w-9',
  md: 'h-11 w-11',
  lg: 'h-14 w-14',
};

const variants: Record<IconButtonVariant, string> = {
  primary: 'bg-mustard text-ink-900 border-thick border-ink-900 shadow-sticker-sm',
  secondary: 'bg-teal text-cream-50 border-thick border-ink-900 shadow-sticker-sm',
  tertiary: 'bg-terracotta text-cream-50 border-thick border-ink-900 shadow-sticker-sm',
  ghost: 'bg-transparent text-cream-200 border-thick border-cream-200',
};

const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { size = 'md', variant = 'primary', label, className, disabled, type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center rounded-md transition-all duration-fast ease-squish',
        'focus-visible:outline-none focus-visible:shadow-focus',
        'active:scale-[0.96] active:translate-x-[2px] active:translate-y-[2px] active:shadow-sticker-press',
        sizes[size],
        variants[variant],
        disabled && 'opacity-60 cursor-not-allowed',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

export default IconButton;
