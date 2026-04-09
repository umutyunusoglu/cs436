# CLAUDE.md — Gold & Silver Price Tracker (Root)

## Project Overview

Full-stack AWS application: XAU/XAG price tracking with ML predictions.

- **IaC**: AWS CDK v2 (TypeScript) in `/infra`
- **Backend**: Python 3.12 Lambda functions in `/lambdas`
- **Frontend**: React 18 + Vite 5 (TypeScript) in `/frontend`

## Repository Layout

```
infra/      CDK stacks — one stack per architectural layer
lambdas/    Python Lambda handlers + requirements.txt per function
frontend/   React SPA with TradingView Lightweight Charts
```

## Stack Dependency Order

```
StorageStack → IngestionStack
             → MlStack
             → ApiStack → FrontendStack
                        → MonitoringStack
```

Always deploy `StorageStack` first; it exports VPC, RDS, S3, and Secrets ARNs consumed by all other stacks.

## Deployment Sequence

```bash
cd infra && npm install
cdk deploy StorageStack
# Add API key to Secrets Manager manually
# Run schema.sql against RDS
cdk deploy IngestionStack MlStack ApiStack
cd ../frontend && npm install && npm run build && cd ../infra
cdk deploy FrontendStack MonitoringStack
```

## Secrets

Two Secrets Manager secrets:
- `metals-api-key` — `{ "api_key": "..." }` — goldapi.io key
- `rds-credentials` — `{ "username": "...", "password": "..." }` — auto-rotated by CDK

All Lambda functions read secrets via `boto3` at invocation time; never hardcode credentials.

## Free Tier Notes

- RDS must stay `t3.micro`; do not resize.
- Only one RDS instance at a time (750 hr/month limit).
- Secrets Manager is NOT perpetually free ($0.40/secret/month post-trial).
- ALB free tier: 750 hrs/month — matches one instance running continuously.

## Conventions

- Python Lambda dependencies are declared in `requirements.txt` per function directory.
- Lambda packaging: CDK `PythonFunction` construct (`aws_lambda_python_alpha`) bundles deps automatically using Docker.
- CDK context variables (account/region) are resolved at deploy time via `process.env`.
- All resources are tagged with `Project: price-tracker` and `Env: prod`.
