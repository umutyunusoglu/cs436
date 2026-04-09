import { useEffect, useRef } from 'react';
import {
  createChart,
  type IChartApi,
  type Time,
  ColorType,
  LineStyle,
} from 'lightweight-charts';
import type { RSIPoint, MACDPoint } from '../types';

// ── RSI Chart ─────────────────────────────────────────────────────────────────

interface RSIProps {
  data: RSIPoint[];
  height?: number;
}

export function RSIChart({ data, height = 160 }: RSIProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: '#0f1117' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1e2433' }, horzLines: { color: '#1e2433' } },
      rightPriceScale: { borderColor: '#1e2433', scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: '#1e2433', timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const rsiSeries = chart.addLineSeries({ color: '#a855f7', lineWidth: 2 });

    // Overbought / oversold reference lines
    const ob = chart.addLineSeries({ color: '#ef444460', lineWidth: 1, lineStyle: LineStyle.Dashed });
    const os = chart.addLineSeries({ color: '#22c55e60', lineWidth: 1, lineStyle: LineStyle.Dashed });

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    if (containerRef.current) ro.observe(containerRef.current);

    // Populate RSI
    const rsiPoints = data
      .filter((p) => p.value !== null)
      .map((p) => ({ time: (new Date(p.timestamp).getTime() / 1000) as Time, value: p.value as number }));

    rsiSeries.setData(rsiPoints);

    if (rsiPoints.length > 0) {
      const first = rsiPoints[0].time;
      const last = rsiPoints[rsiPoints.length - 1].time;
      ob.setData([{ time: first, value: 70 }, { time: last, value: 70 }]);
      os.setData([{ time: first, value: 30 }, { time: last, value: 30 }]);
      chart.timeScale().fitContent();
    }

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, height]);

  return (
    <div>
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px', padding: '0 4px' }}>
        RSI (14)
        <span style={{ color: '#ef4444', marginLeft: '8px' }}>— 70 Overbought</span>
        <span style={{ color: '#22c55e', marginLeft: '8px' }}>— 30 Oversold</span>
      </div>
      <div ref={containerRef} style={{ width: '100%', height, borderRadius: '8px', overflow: 'hidden', border: '1px solid #1e2433' }} />
    </div>
  );
}

// ── MACD Chart ────────────────────────────────────────────────────────────────

interface MACDProps {
  data: MACDPoint[];
  height?: number;
}

export function MACDChart({ data, height = 160 }: MACDProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: { background: { type: ColorType.Solid, color: '#0f1117' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1e2433' }, horzLines: { color: '#1e2433' } },
      rightPriceScale: { borderColor: '#1e2433' },
      timeScale: { borderColor: '#1e2433', timeVisible: true, secondsVisible: false },
    });

    const macdLine = chart.addLineSeries({ color: '#3b82f6', lineWidth: 2 });
    const signalLine = chart.addLineSeries({ color: '#f97316', lineWidth: 2 });
    const histSeries = chart.addHistogramSeries({
      color: '#22c55e',
      priceScaleId: 'right',
    });

    const filtered = data.filter((p) => p.macd !== null);
    const toTime = (ts: string) => (new Date(ts).getTime() / 1000) as Time;

    macdLine.setData(filtered.map((p) => ({ time: toTime(p.timestamp), value: p.macd as number })));
    signalLine.setData(filtered.map((p) => ({ time: toTime(p.timestamp), value: p.signal as number })));
    histSeries.setData(
      filtered.map((p) => ({
        time: toTime(p.timestamp),
        value: p.histogram as number,
        color: (p.histogram ?? 0) >= 0 ? '#22c55e80' : '#ef444480',
      })),
    );

    chart.timeScale().fitContent();

    const ro = new ResizeObserver(() => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chart.remove();
    };
  }, [data, height]);

  return (
    <div>
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '4px', padding: '0 4px' }}>
        MACD (12, 26, 9)
        <span style={{ color: '#3b82f6', marginLeft: '8px' }}>— MACD</span>
        <span style={{ color: '#f97316', marginLeft: '8px' }}>— Signal</span>
        <span style={{ color: '#94a3b8', marginLeft: '8px' }}>▮ Histogram</span>
      </div>
      <div ref={containerRef} style={{ width: '100%', height, borderRadius: '8px', overflow: 'hidden', border: '1px solid #1e2433' }} />
    </div>
  );
}
