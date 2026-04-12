import axios from 'axios';
import type { Metal, MetalName, PricesResponse, Prediction, RangeOption, TechnicalResponse } from '../types';

// All API calls go through CloudFront (/api/*) on the same origin as the SPA.
// No env var needed — the path is relative, which also eliminates CORS entirely.
const BASE_URL = '/api';

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 15_000,
  headers: { 'Content-Type': 'application/json' },
});

function toMetalParam(metal: Metal): MetalName {
  return metal === 'XAU' ? 'gold' : 'silver';
}

export async function fetchPrices(metal: Metal, range: RangeOption): Promise<PricesResponse> {
  const { data } = await api.get<PricesResponse>('/prices', {
    params: { metal: toMetalParam(metal), range },
  });
  return data;
}

export async function fetchPrediction(metal: Metal): Promise<Prediction> {
  const { data } = await api.get<Prediction>('/predict', {
    params: { metal: toMetalParam(metal) },
  });
  return data;
}

export async function fetchTechnical(metal: Metal): Promise<TechnicalResponse> {
  const { data } = await api.get<TechnicalResponse>('/technical', {
    params: { metal: toMetalParam(metal) },
  });
  return data;
}
