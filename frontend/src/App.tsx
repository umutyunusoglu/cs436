import { useState, useCallback, useEffect } from 'react';
import type { Metal, RangeOption, OHLCBar, RSIPoint, MACDPoint } from './types';
import { MetalSelector } from './components/MetalSelector';
import { PriceHeader } from './components/PriceHeader';
import { PriceChart } from './components/PriceChart';
import { RSIChart, MACDChart } from './components/TechnicalIndicators';
import { PredictionBadge } from './components/PredictionBadge';
import { usePrices } from './hooks/usePrices';
import { usePrediction } from './hooks/usePrediction';
import { useWebSocket } from './hooks/useWebSocket';
// 1. IMPORT THE CORRECT TYPE NAME
import type { ConnectionStatus } from './hooks/useWebSocket';
import { fetchTechnical } from './api/client';

// ── WebSocket status indicator ────────────────────────────────────────────────
// 2. USE ConnectionStatus AND ADD THE MISSING 'error' STATE
const WS_STATUS_CONFIG: Record<ConnectionStatus, { color: string; label: string }> = {
  connected:    { color: '#22c55e', label: 'Live' },
  connecting:   { color: '#f59e0b', label: 'Connecting…' },
  disconnected: { color: '#ef4444', label: 'Reconnecting…' },
  error:        { color: '#ef4444', label: 'Error' }, 
};

// 3. UPDATE THE PROP TYPE TO ConnectionStatus
function WsStatusBadge({ status }: { status: ConnectionStatus }) {
  const { color, label } = WS_STATUS_CONFIG[status];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#94a3b8' }}>
      <span
        style={{
          display: 'inline-block',
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: color,
          boxShadow: status === 'connected' ? `0 0 6px ${color}` : 'none',
        }}
      />
      {label}
    </div>
  );
}

export default function App() {
  const [metal, setMetal] = useState<Metal>('XAU');
  const [range, setRange] = useState<RangeOption>('7d');
  const [rsiData, setRsiData] = useState<RSIPoint[]>([]);
  const [macdData, setMacdData] = useState<MACDPoint[]>([]);
  const [liveBars, setLiveBars] = useState<OHLCBar[]>([]);

  const { data: priceData, loading, error, lastUpdated } = usePrices(metal, range);
  const { prediction, loading: predLoading, error: predError } = usePrediction(metal);

  // Merge historical + live bars, deduplicating by timestamp bucket
  // 1. Ensure priceData is at least an empty array so we don't crash on .length
  const safePriceData = priceData || [];

  // 2. Merge historical + live bars, deduplicating by timestamp bucket
  const allBars = liveBars.length > 0
    ? [...safePriceData, ...liveBars].reduce<OHLCBar[]>((acc, bar) => {
        const last = acc[acc.length - 1];
        if (last && last.timestamp === bar.timestamp) {
          acc[acc.length - 1] = bar; // update existing 5-min bucket in place
        } else {
          acc.push(bar);
        }
        return acc;
      }, [])
    : safePriceData;

  const handleLiveUpdate = useCallback(
    (bar: { open: number; high: number; low: number; close: number; timestamp: string }) => {
      setLiveBars((prev) => {
        const next = [...prev];
        const idx = next.findIndex((b) => b.timestamp === bar.timestamp);
        const ohlcBar: OHLCBar = { ...bar, volume: 0 };
        if (idx >= 0) {
          next[idx] = ohlcBar;
        } else {
          next.push(ohlcBar);
        }
        return next.slice(-10); // keep only last 10 live bars
      });
    },
    [],
  );

  const { status: wsStatus } = useWebSocket(metal, handleLiveUpdate);

  // Fetch technical indicators when metal changes
  useEffect(() => {
    let cancelled = false;
    fetchTechnical(metal)
      .then((resp) => {
        if (!cancelled) {
          // Add fallbacks here to prevent 'undefined' state
          setRsiData(resp?.rsi || []); 
          setMacdData(resp?.macd || []);
        }
      })
      .catch(() => {/* silently ignore */});
    return () => { cancelled = true; };
  }, [metal]);

  // Reset live bars when metal or range changes
  useEffect(() => { setLiveBars([]); }, [metal, range]);

  return (
    <div style={{ maxWidth: '1280px', margin: '0 auto', padding: '24px 16px' }}>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 700, color: '#e2e8f0' }}>
            Precious Metals Tracker
          </h1>
          <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
            Real-time XAU/XAG price charts · RSI · MACD · ML predictions
          </p>
        </div>
        <WsStatusBadge status={wsStatus} />
      </div>

      {/* ── Controls ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '20px' }}>
        <MetalSelector
          metal={metal}
          range={range}
          onMetalChange={setMetal}
          onRangeChange={setRange}
        />
      </div>

      {/* ── Price header + prediction badge ──────────────────────────────────── */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '16px',
        marginBottom: '16px',
      }}>
        <PriceHeader metal={metal} data={allBars} loading={loading} lastUpdated={lastUpdated} />
        <PredictionBadge prediction={prediction} loading={predLoading} error={predError} />
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────────── */}
      {error && (
        <div style={{
          padding: '12px 16px',
          background: '#ef444418',
          border: '1px solid #ef444440',
          borderRadius: '8px',
          color: '#ef4444',
          marginBottom: '16px',
          fontSize: '14px',
        }}>
          {error}
        </div>
      )}

      {/* ── Candlestick chart ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '16px' }}>
        <PriceChart data={allBars} metal={metal} height={380} />
      </div>

      {/* ── Technical indicators ──────────────────────────────────────────────── */}
      {(rsiData?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <RSIChart data={rsiData} />
          <MACDChart data={macdData} />
        </div>
      )}
    </div>
  );
}
