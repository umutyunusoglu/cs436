#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/storage-stack';
import { IngestionStack } from '../lib/ingestion-stack';
import { MlStack } from '../lib/ml-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { MonitoringStack } from '../lib/monitoring-stack';

const app = new cdk.App();

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// Layer 1: Storage (VPC, RDS, S3, Secrets) — must deploy first
const storage = new StorageStack(app, 'StorageStack', { env });

// Layer 2: Data Ingestion (price-fetcher + EventBridge scheduler)
const ingestion = new IngestionStack(app, 'IngestionStack', { env, storage });
ingestion.addDependency(storage);

// Layer 3: ML Pipeline (model-trainer + model-invoker)
const ml = new MlStack(app, 'MlStack', { env, storage });
ml.addDependency(storage);

// Layer 4: API (api-handler + API Gateway REST + WebSocket + ALB)
const api = new ApiStack(app, 'ApiStack', { env, storage, ml });
api.addDependency(storage);
api.addDependency(ml);

// Layer 5: Frontend (CloudFront + S3 deployment)
const frontend = new FrontendStack(app, 'FrontendStack', { env, storage });
frontend.addDependency(storage);

// Layer 6: Monitoring (CloudWatch dashboard + alarms)
const monitoring = new MonitoringStack(app, 'MonitoringStack', { env, storage, api });
monitoring.addDependency(storage);
monitoring.addDependency(api);

app.synth();
