import type { Metal, RangeOption } from '../types';

const RANGES: RangeOption[] = ['1h', '6h', '1d', '7d', '30d', '90d'];

interface Props {
  metal: Metal;
  range: RangeOption;
  onMetalChange: (m: Metal) => void;
  onRangeChange: (r: RangeOption) => void;
}

const btnBase = 'px-4 py-2 rounded-lg text-sm font-medium transition-colors cursor-pointer border-0 outline-none';
const activeBtn = `${btnBase} text-black`;
const inactiveBtn = `${btnBase} bg-transparent text-slate-400 hover:text-slate-200`;

export function MetalSelector({ metal, range, onMetalChange, onRangeChange }: Props) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
      {/* Metal toggle */}
      <div style={{ display: 'flex', background: '#1e2433', borderRadius: '10px', padding: '4px', gap: '2px' }}>
        {(['XAU', 'XAG'] as Metal[]).map((m) => (
          <button
            key={m}
            onClick={() => onMetalChange(m)}
            className={metal === m ? activeBtn : inactiveBtn}
            style={metal === m ? { background: m === 'XAU' ? '#d4af37' : '#aaa9ad' } : {}}
          >
            {m === 'XAU' ? '🥇 Gold (XAU)' : '🥈 Silver (XAG)'}
          </button>
        ))}
      </div>

      {/* Range selector */}
      <div style={{ display: 'flex', background: '#1e2433', borderRadius: '10px', padding: '4px', gap: '2px' }}>
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => onRangeChange(r)}
            className={range === r ? activeBtn : inactiveBtn}
            style={range === r ? { background: '#3b82f6' } : {}}
          >
            {r}
          </button>
        ))}
      </div>
    </div>
  );
}
