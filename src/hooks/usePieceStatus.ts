import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Tables } from '../types/db';

export type PieceRow = Tables<'pieces'>;

interface UsePieceStatus {
  piece: PieceRow | null;
  loading: boolean;
  error: string | null;
}

/**
 * Subscribes to a single piece by id. Uses Supabase Realtime for live
 * updates and falls back to a 3s poll if the channel doesn't connect
 * (e.g. Realtime is not enabled on the project, or a flaky network).
 */
export function usePieceStatus(pieceId: string | undefined): UsePieceStatus {
  const [piece, setPiece] = useState<PieceRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const realtimeConnected = useRef(false);

  useEffect(() => {
    if (!pieceId) return;
    let cancelled = false;

    async function load(): Promise<PieceRow | null> {
      const { data, error: err } = await supabase
        .from('pieces')
        .select('*')
        .eq('id', pieceId as string)
        .maybeSingle();
      if (cancelled) return null;
      if (err) {
        setError(err.message);
        setLoading(false);
        return null;
      }
      setPiece(data ?? null);
      setLoading(false);
      return data ?? null;
    }

    load();

    const channel = supabase
      .channel(`piece:${pieceId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pieces', filter: `id=eq.${pieceId}` },
        (payload) => {
          if (cancelled) return;
          const next = (payload.new ?? null) as PieceRow | null;
          if (next) setPiece(next);
        },
      )
      .subscribe((status) => {
        realtimeConnected.current = status === 'SUBSCRIBED';
      });

    // Polling fallback. Cheap to leave running; bails as soon as the row
    // reaches a terminal status, or stops if realtime took over.
    const poll = setInterval(async () => {
      if (cancelled) return;
      const fresh = await load();
      if (!fresh) return;
      if (fresh.status === 'ready' || fresh.status === 'error' || fresh.status === 'approved') {
        clearInterval(poll);
      }
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [pieceId]);

  return { piece, loading, error };
}
