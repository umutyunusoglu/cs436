# CLAUDE.md — infra/

AWS CDK v2 (TypeScript) for the Gold & Silver Price Tracker.

## Stack Layout

| Stack | File | Key Resources |
|---|---|---|
| `StorageStack` | `lib/storage-stack.ts` | VPC, RDS t3.micro, S3 ×2, Secrets Manager ×2, S3 Gateway endpoint, Secrets Manager Interface endpoint |
| `IngestionStack` | `lib/ingestion-stack.ts` | `price-fetcher` Lambda (public subnet) + EventBridge 5-min rate |
| `MlStack` | `lib/ml-stack.ts` | `model-trainer` Lambda (private subnet) + `model-invoker` Lambda (private subnet) + EventBridge weekly cron |
| `ApiStack` | `lib/api-stack.ts` | `api-handler` Lambda (public subnet) + ALB + WebSocket API GW |
| `FrontendStack` | `lib/frontend-stack.ts` | CloudFront (3 origins) + S3 `static-web` + 2 CloudFront Functions + BucketDeployment |
| `MonitoringStack` | `lib/monitoring-stack.ts` | CloudWatch dashboard + alarms + SNS topic |

Deploy order (enforced via `addDependency`): `StorageStack` → `IngestionStack`, `MlStack`, `ApiStack` → `FrontendStack`, `MonitoringStack`.

## Traffic Flow & Security

CloudFront is the **only public entry point** for browser traffic. No AWS resource is exposed directly to the internet except CloudFront and the ALB (which is only meant to receive traffic from CloudFront).

```
Browser
 └── CloudFront
       ├── /*        S3 origin (static SPA)
       ├── /api/*    ALB origin  ← CloudFront Function strips /api before forwarding
       └── /ws       WebSocket API GW origin  ← CloudFront Function rewrites /ws to /
```

## Subnet Layout

| Lambda | Subnet | Why |
|---|---|---|
| `price-fetcher` | PUBLIC | Must reach goldapi.io (no NAT GW) |
| `api-handler` | PUBLIC | Must invoke `model-invoker` via Lambda API (no Lambda VPC endpoint) |
| `model-invoker` | PRIVATE_ISOLATED | Only needs RDS + S3 + Secrets Manager (all via VPC endpoints) |
| `model-trainer` | PRIVATE_ISOLATED | Only needs RDS + S3 + Secrets Manager (all via VPC endpoints) |
| RDS | PRIVATE_ISOLATED | Only reachable from Lambda security group |

**VPC Endpoints in use:**
- S3 Gateway endpoint (free) — lets private Lambdas reach S3 without internet
- Secrets Manager Interface endpoint — lets all Lambdas read secrets within VPC

## CDK Patterns Used

- **`PythonFunction`** (`@aws-cdk/aws-lambda-python-alpha`): bundles Python Lambda code + `requirements.txt` using Docker. Each Lambda's `entry` points to its directory in `../lambdas/<name>/`.
- **`LoadBalancerV2Origin`**: CloudFront → ALB over HTTP (internal AWS network); ALB → Lambda via `LambdaTarget`.
- **`HttpOrigin`**: CloudFront → WebSocket API GW over HTTPS with `originPath: '/prod'`.
- **`cloudfront.Function`**: two lightweight JS functions — one strips `/api` from API paths, one rewrites `/ws` to `/` for WebSocket connections.
- **`WebSocketApi` + `WebSocketStage`**: real-time price push channel. `price-fetcher` posts to connected clients via Management API.
- **`S3BucketOrigin.withOriginAccessControl`**: CloudFront → S3 without making the bucket public.
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
- `WS_ENDPOINT` — WebSocket callback URL for API Gateway Management API (ApiStack, injected via `addPropertyOverride`)

## Free Tier Constraints

- `instanceType` on RDS must stay `ec2.InstanceType.of(T3, MICRO)`.
- `natGateways: 0` — no NAT Gateway; private Lambdas rely on VPC endpoints only.
- `multiAz: false` — single-AZ RDS to fit within 750 hr/month.
- `price-fetcher` and `api-handler` run in PUBLIC subnets (`allowPublicSubnet: true`) because there is no NAT Gateway to route private subnet traffic to the internet.

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
