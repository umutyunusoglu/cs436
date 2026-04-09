# Gold & Silver Price Tracker

A full-stack AWS application that tracks XAU/XAG spot prices in near real-time, displays interactive candlestick charts with RSI/MACD technical indicators, and provides ML-based price direction predictions.

## Architecture

```
goldapi.io
    │
    ▼ (every 5 min)
EventBridge Scheduler ──► Lambda: price-fetcher ──► RDS PostgreSQL (t3.micro)
                                                           │
                     EventBridge (weekly) ──► Lambda: model-trainer ──► S3: model-artifacts
                                                           │
                          Browser ──► CloudFront ──► S3: static-web (React SPA)
                                           │
                                           ▼
                                    ALB ──► API Gateway ──► Lambda: api-handler ──► RDS
                                                                     │
                                                           Lambda: model-invoker ◄── S3
```

## Prerequisites

- [AWS CLI](https://aws.amazon.com/cli/) configured (`aws configure`)
- [Node.js](https://nodejs.org/) >= 18
- [Python](https://www.python.org/) >= 3.12
- [AWS CDK](https://aws.amazon.com/cdk/) v2: `npm install -g aws-cdk`
- A free API key from [goldapi.io](https://www.goldapi.io/)

## Project Structure

```
cs436/
├── infra/          # AWS CDK TypeScript — all infrastructure as code
├── lambdas/        # Python Lambda functions
│   ├── shared/     # Shared DB helper
│   ├── price-fetcher/
│   ├── model-trainer/
│   ├── model-invoker/
│   └── api-handler/
└── frontend/       # React + Vite SPA
```

## Deployment

### 1. Bootstrap CDK (first time only)

```bash
cd infra
npm install
cdk bootstrap aws://YOUR_ACCOUNT_ID/YOUR_REGION
```

### 2. Deploy Storage Layer

```bash
cdk deploy StorageStack
```

This creates the VPC, RDS PostgreSQL instance, S3 buckets, and Secrets Manager secrets.

### 3. Configure Secrets

After `StorageStack` deploys, add your goldapi.io key to Secrets Manager:

```bash
aws secretsmanager put-secret-value \
  --secret-id metals-api-key \
  --secret-string '{"api_key":"YOUR_GOLDAPI_KEY"}'
```

### 4. Run Database Migration

Connect to RDS via the bastion host or AWS Systems Manager Session Manager:

```bash
psql -h <rds-endpoint> -U postgres -d pricetracker -f infra/schema.sql
```

### 5. Deploy Lambda Stacks

```bash
cdk deploy IngestionStack MlStack ApiStack
```

### 6. Build and Deploy Frontend

```bash
cd ../frontend
npm install
npm run build
cd ../infra
cdk deploy FrontendStack
```

### 7. Deploy Monitoring

```bash
cdk deploy MonitoringStack
```

### 8. Get Endpoints

```bash
cdk outputs ApiStack     # REST API URL
cdk outputs ApiStack     # WebSocket URL
cdk outputs FrontendStack  # CloudFront URL
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/prices?metal=gold&range=7d` | OHLC price history |
| GET | `/predict?metal=gold` | ML direction prediction |
| GET | `/technical?metal=silver` | RSI + MACD indicators |
| WS | `wss://<ws-url>` | Real-time price stream |

## Free Tier Usage

| Service | Limit | This App |
|---------|-------|----------|
| Lambda | 1M req/month | ~9K req/month |
| RDS t3.micro | 750 hrs/month | 744 hrs/month |
| S3 | 5 GB | < 100 MB |
| API Gateway | 1M calls/month | Low traffic |
| CloudFront | 1 TB transfer | SPA traffic |
| ALB | 750 hrs/month | 744 hrs/month |

> **Note**: AWS Secrets Manager costs $0.40/secret/month after the 30-day trial. Consider SSM Parameter Store (free) as a no-cost alternative.

## Local Development

### Frontend

```bash
cd frontend
npm install
# Point to your deployed API
echo "VITE_API_URL=https://your-alb-dns" > .env.local
echo "VITE_WS_URL=wss://your-ws-api-id.execute-api.region.amazonaws.com/prod" >> .env.local
npm run dev
```

### Lambda (local testing)

```bash
cd lambdas/price-fetcher
pip install -r requirements.txt
python -c "import handler; handler.lambda_handler({}, {})"
```
