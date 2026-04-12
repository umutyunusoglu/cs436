import { useEffect, useRef, useCallback, useState } from 'react';
import type { LivePriceUpdate, Metal } from '../types';

const RECONNECT_DELAY_MS = 5_000;

/**
 * Derives the WebSocket URL from the current page origin so it always
 * routes through CloudFront (/ws) regardless of environment.
 *   https://d1234.cloudfront.net  →  wss://d1234.cloudfront.net/ws
 *   http://localhost:3000          →  ws://localhost:3000/ws
 */
function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export type WsStatus = 'connecting' | 'connected' | 'disconnected';

export function useWebSocket(
  metal: Metal,
  onUpdate: (bar: NonNullable<LivePriceUpdate['XAU']> & { timestamp: string }) => void,
): { status: WsStatus } {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmounted = useRef(false);
  const [status, setStatus] = useState<WsStatus>('connecting');

  const connect = useCallback(() => {
    if (unmounted.current) return;

    setStatus('connecting');
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      if (!unmounted.current) setStatus('connected');
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
      if (!unmounted.current) {
        setStatus('disconnected');
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

  return { status };
}
