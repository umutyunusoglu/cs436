import type { Prediction } from '../types';

interface Props {
  prediction: Prediction | null;
  loading: boolean;
  error: string | null;
}

const DIRECTION_CONFIG = {
  up: { label: '▲ Bullish', color: '#22c55e', bg: '#22c55e18', border: '#22c55e40' },
  down: { label: '▼ Bearish', color: '#ef4444', bg: '#ef444418', border: '#ef444440' },
  sideways: { label: '◆ Sideways', color: '#f59e0b', bg: '#f59e0b18', border: '#f59e0b40' },
};

export function PredictionBadge({ prediction, loading, error }: Props) {
  if (loading && !prediction) {
    return (
      <div style={{ padding: '16px', background: '#1e2433', borderRadius: '12px', minWidth: '200px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', letterSpacing: '0.1em' }}>
          ML PREDICTION
        </div>
        <div style={{ color: '#475569' }}>Loading…</div>
      </div>
    );
  }

  if (error && !prediction) {
    return (
      <div style={{ padding: '16px', background: '#1e2433', borderRadius: '12px', minWidth: '200px' }}>
        <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', letterSpacing: '0.1em' }}>
          ML PREDICTION
        </div>
        <div style={{ color: '#ef4444', fontSize: '13px' }}>Model unavailable</div>
      </div>
    );
  }

  if (!prediction) return null;

  // Force the API string to lowercase, and provide a safe fallback if the string is unrecognized
  const safeDirection = (prediction.direction || '').toLowerCase() as keyof typeof DIRECTION_CONFIG;
  
  const cfg = DIRECTION_CONFIG[safeDirection] || { 
    label: '— Unknown', 
    color: '#64748b', 
    bg: '#1e2433', 
    border: '#334155' 
  };
  const confidencePct = Math.round(prediction.confidence * 100);
  const barWidth = `${confidencePct}%`;

  return (
    <div
      style={{
        padding: '16px',
        background: cfg.bg,
        border: `1px solid ${cfg.border}`,
        borderRadius: '12px',
        minWidth: '220px',
      }}
    >
      <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '8px', letterSpacing: '0.1em' }}>
        ML PREDICTION
      </div>

      <div style={{ fontSize: '22px', fontWeight: 700, color: cfg.color, marginBottom: '12px' }}>
        {cfg.label}
      </div>

      {/* Confidence bar */}
      <div style={{ marginBottom: '4px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#94a3b8', marginBottom: '4px' }}>
          <span>Confidence</span>
          <span style={{ fontWeight: 600, color: cfg.color }}>{confidencePct}%</span>
        </div>
        <div style={{ height: '6px', background: '#1e2433', borderRadius: '3px', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: barWidth,
              background: cfg.color,
              borderRadius: '3px',
              transition: 'width 0.4s ease',
            }}
          />
        </div>
      </div>

      <div style={{ fontSize: '11px', color: '#475569', marginTop: '8px' }}>
        Model v{prediction.model_ver}
      </div>
    </div>
  );
}
