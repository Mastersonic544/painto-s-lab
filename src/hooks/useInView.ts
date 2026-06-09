import { useEffect, useRef, useState } from 'react';

export interface UseInViewOptions {
  /** Fraction of the element that must be visible to count as in-view. */
  threshold?: number;
  /** Margin around the root for triggering. CSS-like string. */
  rootMargin?: string;
  /** Stay "in" after first trigger so the entrance animation only plays once. */
  once?: boolean;
}

/**
 * Light wrapper over IntersectionObserver that flips a boolean when the
 * target enters the viewport. Pairs with the [data-pl-enter] / [data-in-view]
 * CSS hooks in src/design-system/animations.css.
 */
export function useInView<T extends Element>(opts: UseInViewOptions = {}) {
  const { threshold = 0.2, rootMargin = '0px 0px -10% 0px', once = true } = opts;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) obs.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [threshold, rootMargin, once]);

  return { ref, inView } as const;
}
