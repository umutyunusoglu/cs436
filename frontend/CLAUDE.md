# CLAUDE.md — frontend/

React 18 + Vite 5 (TypeScript) SPA for the Gold & Silver Price Tracker.

## Stack

- **React 18** + **TypeScript** (strict mode)
- **Vite 5** — bundler, dev server with API proxy, production build to `dist/`
- **TradingView Lightweight Charts v4** — candlestick chart, RSI line, MACD histogram
- **Axios** — typed REST API client

## URL Strategy

All API and WebSocket calls use **relative paths** — no env vars needed for URLs.
CloudFront serves the SPA and proxies both `/api/*` and `/ws` on the same domain,
which also eliminates CORS entirely.

| Path | Target (via CloudFront) |
|---|---|
| `/api/prices` | ALB → `api-handler` Lambda |
| `/api/predict` | ALB → `api-handler` Lambda |
| `/api/technical` | ALB → `api-handler` Lambda |
| `/ws` | WebSocket API Gateway |

For local dev, configure Vite's proxy in `vite.config.ts` to forward `/api` and `/ws`
to the deployed ALB and WebSocket API GW URLs.

## Key Files

| File | Purpose |
|---|---|
| `src/api/client.ts` | Axios instance; `baseURL = '/api'`; all REST calls go through here |
| `src/types/index.ts` | All shared TypeScript interfaces (OHLCBar, Prediction, etc.) |
| `src/hooks/usePrices.ts` | Fetches OHLC history, polls every 30 s |
| `src/hooks/useWebSocket.ts` | WebSocket with auto-reconnect; derives URL from `window.location.host`; returns `{ status: WsStatus }` |
| `src/hooks/usePrediction.ts` | Fetches ML prediction, polls every 5 min |
| `src/components/PriceChart.tsx` | Candlestick chart using Lightweight Charts |
| `src/components/TechnicalIndicators.tsx` | RSI + MACD sub-charts |
| `src/components/PredictionBadge.tsx` | Direction badge + confidence bar |
| `src/components/MetalSelector.tsx` | Gold/Silver + range toggles |
| `src/components/PriceHeader.tsx` | Spot price + % change display |

## WebSocket Status

`useWebSocket` returns `{ status: WsStatus }` where `WsStatus = 'connecting' | 'connected' | 'disconnected'`.
`App.tsx` renders `<WsStatusBadge>` in the header to show a coloured dot + label.
The hook auto-reconnects every 5 s on close/error.

## Chart Pattern

All charts are initialized in `useEffect` and cleaned up on unmount. Use the `ResizeObserver` pattern to handle container width changes — see `PriceChart.tsx` for the canonical example.

**Never** put chart initialization logic in render — it must run after the DOM element exists.

## API Types

Matches the Lambda response shapes exactly:
- `GET /api/prices` → `PricesResponse`
- `GET /api/predict` → `Prediction`
- `GET /api/technical` → `TechnicalResponse`
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
