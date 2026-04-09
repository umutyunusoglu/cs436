export type Metal = 'XAU' | 'XAG';
export type MetalName = 'gold' | 'silver';

export interface OHLCBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: string; // ISO 8601
}

export interface PricesResponse {
  metal: Metal;
  range: string;
  count: number;
  data: OHLCBar[];
}

export interface Prediction {
  metal: Metal;
  direction: 'up' | 'down' | 'sideways';
  confidence: number; // 0–1
  model_ver: string;
}

export interface RSIPoint {
  value: number | null;
  timestamp: string;
}

export interface MACDPoint {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
  timestamp: string;
}

export interface TechnicalResponse {
  metal: Metal;
  rsi: RSIPoint[];
  macd: MACDPoint[];
}

export type RangeOption = '1h' | '6h' | '1d' | '7d' | '30d' | '90d';

export interface LivePriceUpdate {
  event: 'price_update';
  timestamp: string;
  XAU?: { open: number; high: number; low: number; close: number };
  XAG?: { open: number; high: number; low: number; close: number };
}
