import { useEffect, useRef, useCallback } from 'react';
import type { LivePriceUpdate, Metal } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL ?? '';
const RECONNECT_DELAY_MS = 5_000;
const PING_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes, as AWS API Gateway has a strict, non-adjustable rule: it will forcibly close any WebSocket connection that remains completely silent for 10 minutes.



export function useWebSocket(
  metal: Metal,
  onUpdate: (bar: NonNullable<LivePriceUpdate['XAU']> & { timestamp: string }) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (!WS_URL || unmounted.current) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      // Start sending periodic pings to keep the connection alive
      // and update the last_ping column in the RDS database
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ action: 'ping' }));
        }
      }, PING_INTERVAL_MS);
    };

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
      if (pingTimer.current) clearInterval(pingTimer.current);
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
      if (pingTimer.current) clearInterval(pingTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
