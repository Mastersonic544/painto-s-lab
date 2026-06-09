import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  durationMs: number;
}

interface ToastContextValue {
  toast: (t: Omit<ToastItem, 'id' | 'durationMs'> & { durationMs?: number }) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

const toneClasses: Record<ToastTone, string> = {
  info: 'bg-cream-100 text-text-on-light',
  success: 'bg-teal text-cream-50',
  warning: 'bg-mustard text-ink-900',
  danger: 'bg-terracotta text-cream-50',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback<ToastContextValue['toast']>((t) => {
    const id = nextId.current++;
    const item: ToastItem = { id, durationMs: 4000, ...t };
    setItems((prev) => [...prev, item]);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 max-w-sm">
          {items.map((t) => (
            <ToastBubble key={t.id} item={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

function ToastBubble({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const id = setTimeout(onDismiss, item.durationMs);
    return () => clearTimeout(id);
  }, [item.durationMs, onDismiss]);
  return (
    <div
      role="status"
      className={cn(
        'pl-toast-bloom rounded-lg border-thick border-ink-900 shadow-sticker px-4 py-3',
        'flex items-start gap-3',
        toneClasses[item.tone],
      )}
    >
      <div className="flex-1">
        <div className="font-display font-bold text-base">{item.title}</div>
        {item.description && <div className="text-sm mt-0.5">{item.description}</div>}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-mr-1 -mt-1 h-7 w-7 rounded-full grid place-items-center hover:bg-ink-900/10 transition-colors duration-fast"
      >
        ×
      </button>
    </div>
  );
}
