import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchPrices } from '../api/client';
import type { Metal, OHLCBar, RangeOption } from '../types';

const POLL_INTERVAL_MS = 30_000;

interface UsePricesState {
  data: OHLCBar[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

export function usePrices(metal: Metal, range: RangeOption): UsePricesState & { refetch: () => void } {
  const [state, setState] = useState<UsePricesState>({
    data: [],
    loading: true,
    error: null,
    lastUpdated: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetchPrices(metal, range);
      setState({ data: response.data, loading: false, error: null, lastUpdated: new Date() });
    } catch (err: unknown) {
      if ((err as { name?: string })?.name === 'CanceledError') return;
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch prices',
      }));
    }
  }, [metal, range]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      abortRef.current?.abort();
    };
  }, [load]);

  return { ...state, refetch: load };
}
