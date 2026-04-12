import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as path from 'path';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { StorageStack } from './storage-stack';
import {
  COMMON_TAGS,
  ENV_DB_SECRET_ARN,
  ENV_MODEL_BUCKET,
  ENV_DB_HOST,
  ENV_DB_NAME,
  ENV_DB_PORT,
  RDS_DB_NAME,
  RDS_PORT,
} from './shared/constants';

interface MlStackProps extends cdk.StackProps {
  storage: StorageStack;
}

export class MlStack extends cdk.Stack {
  public readonly modelInvokerFn: lambda.IFunction;

  constructor(scope: Construct, id: string, props: MlStackProps) {
    super(scope, id, props);

    Object.entries(COMMON_TAGS).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const { storage } = props;

    const sharedEnv = {
      [ENV_DB_SECRET_ARN]: storage.dbSecret.secretArn,
      [ENV_MODEL_BUCKET]: storage.modelBucket.bucketName,
      [ENV_DB_HOST]: storage.dbInstance.dbInstanceEndpointAddress,
      [ENV_DB_NAME]: RDS_DB_NAME,
      [ENV_DB_PORT]: String(RDS_PORT),
    };

    // ── Lambda: model-invoker (on-demand prediction) ──────────────────────────
    // Private subnet: only needs RDS (security group) + S3 (Gateway endpoint)
    // + Secrets Manager (Interface endpoint). No internet access required.
    this.modelInvokerFn = new PythonFunction(this, 'ModelInvokerFn', {
      functionName: 'model-invoker',
      layers: [storage.sharedLayer],
      entry: path.join(__dirname, '../../lambdas/model-invoker'),
      runtime: lambda.Runtime.PYTHON_3_12,
      index: 'handler.py',
      handler: 'lambda_handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(30),
      vpc: storage.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [storage.lambdaSecurityGroup],
      environment: sharedEnv,
    });

    storage.dbSecret.grantRead(this.modelInvokerFn);
    storage.modelBucket.grantRead(this.modelInvokerFn);

    // ── Lambda: model-trainer (weekly batch) ──────────────────────────────────
    // Private subnet: only needs RDS + S3 (Gateway endpoint) + Secrets Manager.
    const modelTrainerFn = new PythonFunction(this, 'ModelTrainerFn', {
      functionName: 'model-trainer',
      layers: [storage.sharedLayer],
      entry: path.join(__dirname, '../../lambdas/model-trainer'),
      runtime: lambda.Runtime.PYTHON_3_12,
      index: 'handler.py',
      handler: 'lambda_handler',
      memorySize: 512,
      timeout: cdk.Duration.minutes(10),
      vpc: storage.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [storage.lambdaSecurityGroup],
      environment: sharedEnv,
    });

    storage.dbSecret.grantRead(modelTrainerFn);
    storage.modelBucket.grantReadWrite(modelTrainerFn);

    // ── EventBridge Rule — every Sunday 03:00 UTC ─────────────────────────────
    const trainRule = new events.Rule(this, 'WeeklyTrainSchedule', {
      ruleName: 'model-train-weekly',
      description: 'Trains ML model every Sunday at 03:00 UTC',
      schedule: events.Schedule.cron({ minute: '0', hour: '3', weekDay: 'SUN' }),
      enabled: true,
    });

    trainRule.addTarget(new targets.LambdaFunction(modelTrainerFn, {
      retryAttempts: 1,
    }));

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ModelInvokerArn', {
      value: this.modelInvokerFn.functionArn,
      exportName: 'ModelInvokerArn',
    });
    new cdk.CfnOutput(this, 'ModelTrainerArn', {
      value: modelTrainerFn.functionArn,
    });
  }
}
