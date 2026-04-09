import { useState, useEffect, useCallback } from 'react';
import { fetchPrediction } from '../api/client';
import type { Metal, Prediction } from '../types';

const POLL_INTERVAL_MS = 5 * 60_000; // Re-fetch prediction every 5 minutes

interface UsePredictionState {
  prediction: Prediction | null;
  loading: boolean;
  error: string | null;
}

export function usePrediction(metal: Metal): UsePredictionState & { refetch: () => void } {
  const [state, setState] = useState<UsePredictionState>({
    prediction: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const prediction = await fetchPrediction(metal);
      setState({ prediction, loading: false, error: null });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Prediction unavailable',
      }));
    }
  }, [metal]);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  return { ...state, refetch: load };
}
