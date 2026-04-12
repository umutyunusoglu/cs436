import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as path from 'path';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { StorageStack } from './storage-stack';
import { ApiStack } from './api-stack';
import {
  COMMON_TAGS,
  ENV_DB_SECRET_ARN,
  ENV_API_SECRET_ARN,
  ENV_DB_HOST,
  ENV_DB_NAME,
  ENV_DB_PORT,
  RDS_DB_NAME,
  RDS_PORT,
} from './shared/constants';

// Updated the interface
interface IngestionStackProps extends cdk.StackProps {
  storage: StorageStack;
  api: ApiStack; // new
}

export class IngestionStack extends cdk.Stack {
  public readonly priceFetcherFn: lambda.IFunction;

  constructor(scope: Construct, id: string, props: IngestionStackProps) {
    super(scope, id, props);
    Object.entries(COMMON_TAGS).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const { storage, api } = props; // <-- Destructure api

    this.priceFetcherFn = new PythonFunction(this, 'PriceFetcherFn', {
      functionName: 'price-fetcher',
      // ... keep existing paths/runtime configurations ...
      layers: [storage.sharedLayer],
      vpc: storage.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [storage.lambdaSecurityGroup],
      allowPublicSubnet: true,
      environment: {
        [ENV_DB_SECRET_ARN]: storage.dbSecret.secretArn,
        [ENV_API_SECRET_ARN]: storage.apiKeySecret.secretArn,
        [ENV_DB_HOST]: storage.dbInstance.dbInstanceEndpointAddress,
        [ENV_DB_NAME]: RDS_DB_NAME,
        [ENV_DB_PORT]: String(RDS_PORT),
        [ENV_WS_ENDPOINT]: api.wsApiUrl, // <-- Inject the real WebSocket URL
      },
    });

    // Grant Secrets Manager read access
    storage.dbSecret.grantRead(this.priceFetcherFn);
    storage.apiKeySecret.grantRead(this.priceFetcherFn);

    // ── EventBridge Scheduler — every 5 minutes ───────────────────────────────
    const fetchRule = new events.Rule(this, 'PriceFetchSchedule', {
      ruleName: 'price-fetch-every-5min',
      description: 'Triggers price-fetcher Lambda every 5 minutes',
      schedule: events.Schedule.rate(cdk.Duration.minutes(5)),
      enabled: true,
    });

    fetchRule.addTarget(new targets.LambdaFunction(this.priceFetcherFn, {
      retryAttempts: 2,
    }));

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'PriceFetcherArn', {
      value: this.priceFetcherFn.functionArn,
    });
  }
}
