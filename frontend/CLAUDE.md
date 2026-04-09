# CLAUDE.md — frontend/

React 18 + Vite 5 (TypeScript) SPA for the Gold & Silver Price Tracker.

## Stack

- **React 18** + **TypeScript** (strict mode)
- **Vite 5** — bundler, dev server with API proxy, production build to `dist/`
- **TradingView Lightweight Charts v4** — candlestick chart, RSI line, MACD histogram
- **Axios** — typed REST API client

## Environment Variables

Set in `.env.local` for local dev; set as build-time env vars in CI for production.

| Variable | Description |
|---|---|
| `VITE_API_URL` | ALB DNS or API Gateway URL (no trailing slash) |
| `VITE_WS_URL` | `wss://` WebSocket URL from API Gateway |

Copy `.env.example` to `.env.local` and populate after deploying the AWS stacks.

## Key Files

| File | Purpose |
|---|---|
| `src/api/client.ts` | Axios instance; all API calls go through here |
| `src/types/index.ts` | All shared TypeScript interfaces (OHLCBar, Prediction, etc.) |
| `src/hooks/usePrices.ts` | Fetches OHLC history, polls every 30s |
| `src/hooks/useWebSocket.ts` | WebSocket connection with auto-reconnect |
| `src/hooks/usePrediction.ts` | Fetches ML prediction, polls every 5 min |
| `src/components/PriceChart.tsx` | Candlestick chart using Lightweight Charts |
| `src/components/TechnicalIndicators.tsx` | RSI + MACD sub-charts |
| `src/components/PredictionBadge.tsx` | Direction badge + confidence bar |
| `src/components/MetalSelector.tsx` | Gold/Silver + range toggles |
| `src/components/PriceHeader.tsx` | Spot price + % change display |

## Chart Pattern

All charts are initialized in `useEffect` and cleaned up on unmount. Use the `ResizeObserver` pattern to handle container width changes — see `PriceChart.tsx` for the canonical example.

**Never** put chart initialization logic in render — it must run after the DOM element exists.

## API Types

Matches the Lambda response shapes exactly:
- `GET /prices` → `PricesResponse`
- `GET /predict` → `Prediction`
- `GET /technical` → `TechnicalResponse`
- WebSocket message → `LivePriceUpdate`

If the backend response shape changes, update `src/types/index.ts` first.

## Build & Deploy

```bash
npm install
npm run dev           # local dev server on :3000
npm run build         # production build → dist/
npm run preview       # preview production build locally
```

The `dist/` folder is deployed to S3 by CDK `FrontendStack` via `BucketDeployment`. Run `npm run build` before `cdk deploy FrontendStack`.

## Styling Approach

Inline styles only — no CSS modules, no Tailwind (kept simple to avoid build complexity). Dark theme: background `#0f1117`, surface `#1e2433`, text `#e2e8f0`, muted `#64748b`. Metal accent colors: gold `#d4af37`, silver `#aaa9ad`.
