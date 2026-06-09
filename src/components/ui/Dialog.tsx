import { ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

// Modal sheet that blooms in on the swamp ground. Backdrop dims with a deep
// swamp wash; the card uses cream paper + sticker shadow + bloom easing.
export default function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center px-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-swamp-950/70 backdrop-blur-sm pl-dialog-backdrop"
        onClick={onClose}
      />
      <div
        className={cn(
          'pl-paper pl-sticker relative max-w-container-sm w-full p-6',
          'pl-dialog-bloom',
          className,
        )}
      >
        {title && (
          <h2 className="font-display font-bold text-h1 text-text-on-light mb-2">{title}</h2>
        )}
        {description && (
          <p className="text-text-on-light mb-4">{description}</p>
        )}
        {children}
        {footer && <div className="mt-6 flex justify-end gap-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
