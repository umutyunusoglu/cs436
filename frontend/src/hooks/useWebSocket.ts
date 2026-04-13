import { useEffect, useRef, useCallback, useState } from 'react';
import type { LivePriceUpdate, Metal } from '../types';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080/ws';
const RECONNECT_DELAY_MS = 5_000;
const PING_INTERVAL_MS = 4 * 60 * 1000; // 4 minutes

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export function useWebSocket(
  metal: Metal,
  onUpdate: (bar: NonNullable<LivePriceUpdate['XAU']> & { timestamp: string }) => void,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const unmounted = useRef(false);
  
  // Track the connection status so App.tsx can display it
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  const connect = useCallback(() => {
    // If the URL is missing, ensure we return the disconnected state gracefully
    if (!WS_URL || unmounted.current) {
      console.warn("WebSocket URL is missing or component unmounted.");
      setStatus('disconnected');
      return;
    }

    setStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('connected');
      // Start sending periodic pings to keep the connection alive
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
      setStatus('disconnected');
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (!unmounted.current) {
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS);
      }
    };

    ws.onerror = () => {
      setStatus('error');
      ws.close();
    };
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

  // THIS is the critical fix. The hook must return the object App.tsx expects.
  return { status };
}