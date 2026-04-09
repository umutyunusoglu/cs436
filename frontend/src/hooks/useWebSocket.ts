import { useEffect, useRef, useCallback } from 'react';
import type { LivePriceUpdate, Metal } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL ?? '';
const RECONNECT_DELAY_MS = 5_000;

export function useWebSocket(
  metal: Metal,
  onUpdate: (bar: NonNullable<LivePriceUpdate['XAU']> & { timestamp: string }) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (!WS_URL || unmounted.current) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onmessage = (evt) => {
      try {
        const msg: LivePriceUpdate = JSON.parse(evt.data);
        if (msg.event !== 'price_update') return;
        const barData = metal === 'XAU' ? msg.XAU : msg.XAG;
        if (barData) {
          onUpdate({ ...barData, timestamp: msg.timestamp });
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!unmounted.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => ws.close();
  }, [metal, onUpdate]);

  useEffect(() => {
    unmounted.current = false;
    connect();

    return () => {
      unmounted.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
