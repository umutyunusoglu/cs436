# CLAUDE.md — infra/

AWS CDK v2 (TypeScript) for the Gold & Silver Price Tracker.

## Stack Layout

| Stack | File | Key Resources |
|---|---|---|
| `StorageStack` | `lib/storage-stack.ts` | VPC, RDS t3.micro, S3 ×2, Secrets Manager ×2 |
| `IngestionStack` | `lib/ingestion-stack.ts` | `price-fetcher` Lambda + EventBridge 5-min rate |
| `MlStack` | `lib/ml-stack.ts` | `model-trainer` Lambda + `model-invoker` Lambda + EventBridge weekly cron |
| `ApiStack` | `lib/api-stack.ts` | `api-handler` Lambda + API Gateway REST + API Gateway WebSocket + ALB |
| `FrontendStack` | `lib/frontend-stack.ts` | CloudFront + S3 `static-web` + BucketDeployment |
| `MonitoringStack` | `lib/monitoring-stack.ts` | CloudWatch dashboard + alarms + SNS topic |

Deploy order (enforced via `addDependency`): `StorageStack` → `IngestionStack`, `MlStack`, `ApiStack` → `FrontendStack`, `MonitoringStack`.

## CDK Patterns Used

- **`PythonFunction`** (`@aws-cdk/aws-lambda-python-alpha`): bundles Python Lambda code + `requirements.txt` using Docker. Each Lambda's `entry` points to its directory in `../lambdas/<name>/`.
- **`LambdaRestApi`**: API Gateway with Lambda proxy integration; CORS pre-flight enabled.
- **`WebSocketApi` + `WebSocketStage`**: real-time price push channel.
- **`S3OriginAccessControl`** + `S3BucketOrigin.withOriginAccessControl`: CloudFront → S3 without making the bucket public.
- **`BucketDeployment`**: uploads `frontend/dist/` and invalidates `/*` on every deploy.

## Shared Constants

All resource names, env var keys, and tags are in `lib/shared/constants.ts`. Refer to that file before adding new strings — do not hardcode names in stack files.

## Lambda Environment Variables

Each Lambda receives environment variables defined in its stack:
- `DB_SECRET_ARN` — Secrets Manager ARN for RDS credentials
- `API_SECRET_ARN` — Secrets Manager ARN for goldapi.io key (IngestionStack only)
- `DB_HOST` — RDS endpoint hostname
- `DB_NAME` — database name (`pricetracker`)
- `DB_PORT` — `5432`
- `MODEL_BUCKET` — S3 bucket name for model artifacts (ML stacks)
- `MODEL_INVOKER_ARN` — Lambda ARN of `model-invoker` (ApiStack)
- `WS_ENDPOINT` — WebSocket callback URL for API Gateway Management API

## Free Tier Constraints

- `instanceType` on RDS must stay `ec2.InstanceType.of(T3, MICRO)`.
- `natGateways: 0` — no NAT Gateway; Lambdas run in PUBLIC subnets with `allowPublicSubnet: true`.
- `multiAz: false` — single-AZ RDS to fit within 750 hr/month.

## Common Commands

```bash
npm install                    # install CDK and construct deps
cdk synth                      # synthesise CloudFormation (no deploy)
cdk diff StorageStack          # preview changes
cdk deploy StorageStack        # deploy a single stack
cdk deploy --all               # deploy all stacks in dependency order
cdk destroy --all              # tear down everything (⚠ irreversible)
```

## schema.sql

`infra/schema.sql` must be applied to the RDS instance manually after `StorageStack` deploys. There is no automated migration step built into CDK.
