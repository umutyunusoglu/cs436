import type { Metal, OHLCBar } from '../types';

interface Props {
  metal: Metal;
  data: OHLCBar[];
  loading: boolean;
  lastUpdated: Date | null;
}

function formatPrice(price: number, metal: Metal): string {
  return price.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: metal === 'XAU' ? 2 : 4,
    maximumFractionDigits: metal === 'XAU' ? 2 : 4,
  });
}

export function PriceHeader({ metal, data, loading, lastUpdated }: Props) {
  if (loading && data.length === 0) {
    return (
      <div style={{ padding: '24px 0' }}>
        <div style={{ fontSize: '36px', color: '#475569' }}>Loading…</div>
      </div>
    );
  }

  if (!data || data.length === 0) return null;

  const latest = data[data.length - 1];
  const first = data[0];
  const change = latest.close - first.open;
  const changePct = (change / first.open) * 100;
  const isPositive = change >= 0;
  const changeColor = isPositive ? '#22c55e' : '#ef4444';
  const metalColor = metal === 'XAU' ? '#d4af37' : '#aaa9ad';
  const metalLabel = metal === 'XAU' ? 'Gold' : 'Silver';

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '16px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '13px', color: metalColor, fontWeight: 600, letterSpacing: '0.1em' }}>
          {metalLabel} / USD
        </span>
        <span style={{ fontSize: '36px', fontWeight: 700, letterSpacing: '-0.02em' }}>
          {formatPrice(latest.close, metal)}
        </span>
        <span style={{ fontSize: '18px', color: changeColor, fontWeight: 600 }}>
          {isPositive ? '+' : ''}
          {formatPrice(change, metal)} ({isPositive ? '+' : ''}{changePct.toFixed(2)}%)
        </span>
      </div>
      {lastUpdated && (
        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
          Updated {lastUpdated.toLocaleTimeString()}
        </div>
      )}
    </div>
  );
}
