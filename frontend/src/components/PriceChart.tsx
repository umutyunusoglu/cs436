import { useEffect, useRef, useCallback } from 'react';
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type Time,
  ColorType,
} from 'lightweight-charts';
import type { OHLCBar, Metal } from '../types';

interface Props {
  data: OHLCBar[];
  metal: Metal;
  height?: number;
}

function toChartBars(bars: OHLCBar[]): CandlestickData<Time>[] {
  return bars.map((b) => ({
    time: (new Date(b.timestamp).getTime() / 1000) as Time,
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
  }));
}

export function PriceChart({ data, metal, height = 360 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const metalColor = metal === 'XAU' ? '#d4af37' : '#aaa9ad';

  const initChart = useCallback(() => {
    if (!containerRef.current) return;

    chartRef.current = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#0f1117' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e2433' },
        horzLines: { color: '#1e2433' },
      },
      crosshair: {
        vertLine: { color: '#3b82f6', labelBackgroundColor: '#3b82f6' },
        horzLine: { color: '#3b82f6', labelBackgroundColor: '#3b82f6' },
      },
      rightPriceScale: { borderColor: '#1e2433' },
      timeScale: { borderColor: '#1e2433', timeVisible: true, secondsVisible: false },
    });

    seriesRef.current = chartRef.current.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
  }, [height]);

  // Init chart once
  useEffect(() => {
    initChart();

    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [initChart]);

  // Update data whenever it changes
  useEffect(() => {
    if (!seriesRef.current || data.length === 0) return;
    seriesRef.current.setData(toChartBars(data));
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height,
        borderRadius: '12px',
        overflow: 'hidden',
        border: `1px solid ${metalColor}22`,
      }}
    />
  );
}

/** Append a single live tick without re-rendering the full dataset. */
export function appendLiveTick(
  seriesRef: React.RefObject<ISeriesApi<'Candlestick'> | null>,
  bar: OHLCBar,
) {
  if (!seriesRef.current) return;
  seriesRef.current.update({
    time: (new Date(bar.timestamp).getTime() / 1000) as Time,
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
  });
}
