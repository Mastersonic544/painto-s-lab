import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { supabase } from '../lib/supabase';
import { addPieceToCart, getOpenCartCount } from '../lib/cart';

interface CartContextValue {
  count: number;
  cartId: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  add: (pieceId: string) => Promise<void>;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState(0);
  const [cartId, setCartId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const cartIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { count: c, cartId: id } = await getOpenCartCount();
      setCount(c);
      setCartId(id);
      cartIdRef.current = id;
    } catch (err) {
      console.warn('[cart] refresh failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Realtime: any change to cart_items refreshes. Filtering by cart_id
    // would be nicer but we don't know it until refresh completes.
    const channel = supabase
      .channel('cart_items_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cart_items' },
        () => {
          refresh();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  const add = useCallback(
    async (pieceId: string) => {
      await addPieceToCart(pieceId);
      // Realtime usually catches this, but refresh now so the badge updates
      // before the broadcast round trip lands.
      await refresh();
    },
    [refresh],
  );

  return (
    <CartContext.Provider value={{ count, cartId, loading, refresh, add }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>');
  return ctx;
}
