import { ReactNode, createContext, useContext, useId, useState } from 'react';
import { cn } from '../../lib/cn';

interface TabsContextValue {
  value: string;
  setValue: (v: string) => void;
  baseId: string;
}
const TabsContext = createContext<TabsContextValue | null>(null);
function useTabsCtx() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error('Tabs subcomponents must be used inside <Tabs>');
  return ctx;
}

export interface TabsProps {
  defaultValue: string;
  value?: string;
  onValueChange?: (v: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ defaultValue, value, onValueChange, children, className }: TabsProps) {
  const baseId = useId();
  const [internal, setInternal] = useState(defaultValue);
  const current = value ?? internal;
  const setValue = (v: string) => {
    if (value === undefined) setInternal(v);
    onValueChange?.(v);
  };
  return (
    <TabsContext.Provider value={{ value: current, setValue, baseId }}>
      <div className={cn('flex flex-col gap-4', className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      role="tablist"
      className={cn(
        'inline-flex items-center gap-1 p-1 rounded-pill border-thick border-ink-900 bg-swamp-800',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Tab({ value, children }: { value: string; children: ReactNode }) {
  const { value: current, setValue, baseId } = useTabsCtx();
  const active = current === value;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`${baseId}-panel-${value}`}
      id={`${baseId}-tab-${value}`}
      onClick={() => setValue(value)}
      className={cn(
        'font-display font-bold text-sm px-4 py-1.5 rounded-pill transition-all duration-fast ease-squish',
        'focus-visible:outline-none focus-visible:shadow-focus',
        active
          ? 'bg-mustard text-ink-900 shadow-sticker-xs'
          : 'text-cream-200 hover:text-cream-50',
      )}
    >
      {children}
    </button>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  const { value: current, baseId } = useTabsCtx();
  if (current !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className="outline-none"
    >
      {children}
    </div>
  );
}
