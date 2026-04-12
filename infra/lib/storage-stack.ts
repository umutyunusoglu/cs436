import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import {
  COMMON_TAGS,
  RDS_DB_NAME,
  RDS_PORT,
  SECRET_METALS_API_KEY,
  BUCKET_MODEL_ARTIFACTS,
  BUCKET_STATIC_WEB,
} from './shared/constants';

export interface StorageStackOutputs {
  vpc: ec2.Vpc;
  lambdaSecurityGroup: ec2.SecurityGroup;
  dbInstance: rds.DatabaseInstance;
  dbSecret: secretsmanager.ISecret;
  apiKeySecret: secretsmanager.Secret;
  modelBucket: s3.Bucket;
  staticWebBucket: s3.Bucket;
}

export class StorageStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly lambdaSecurityGroup: ec2.SecurityGroup;
  public readonly dbInstance: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly apiKeySecret: secretsmanager.Secret;
  public readonly modelBucket: s3.Bucket;
  public readonly staticWebBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    Object.entries(COMMON_TAGS).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // ── VPC ──────────────────────────────────────────────────────────────────
    // 2 AZs, public subnets only (no NAT Gateway to stay Free Tier).
    // Lambdas in public subnets with outbound internet access via IGW.
    // RDS is in isolated (private) subnets — only reachable from Lambda SG.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0, // NAT Gateway is NOT Free Tier — skip it
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // VPC endpoint for Secrets Manager so Lambdas can reach it within the VPC
    this.vpc.addInterfaceEndpoint('SecretsManagerEndpoint', {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });

    // S3 Gateway endpoint — free, lets private-subnet Lambdas reach S3
    // without a NAT Gateway or internet route
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });

    // ── Security Groups ───────────────────────────────────────────────────────
    this.lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions',
      allowAllOutbound: true,
    });

    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: this.vpc,
      description: 'Security group for RDS PostgreSQL',
      allowAllOutbound: false,
    });

    dbSecurityGroup.addIngressRule(
      this.lambdaSecurityGroup,
      ec2.Port.tcp(RDS_PORT),
      'Allow Lambda to connect to PostgreSQL',
    );

    // ── RDS PostgreSQL ────────────────────────────────────────────────────────
    const dbCredentials = rds.Credentials.fromGeneratedSecret('postgres', {
      secretName: 'rds-credentials',
    });

    this.dbInstance = new rds.DatabaseInstance(this, 'RdsPostgres', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_15,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO, // Free Tier: t3.micro
      ),
      credentials: dbCredentials,
      databaseName: RDS_DB_NAME,
      vpc: this.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      multiAz: false, // Free Tier: single AZ
      allocatedStorage: 20, // Free Tier: 20 GB gp2
      storageType: rds.StorageType.GP2,
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false, // Set true for production
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Remove for production
      publiclyAccessible: false,
    });

    this.dbSecret = this.dbInstance.secret!;

    // ── Secrets Manager — Metal Price API Key ─────────────────────────────────
    this.apiKeySecret = new secretsmanager.Secret(this, 'MetalsApiKeySecret', {
      secretName: SECRET_METALS_API_KEY,
      description: 'goldapi.io API key for fetching XAU/XAG spot prices',
      // Placeholder — update manually after deploy:
      // aws secretsmanager put-secret-value --secret-id metals-api-key \
      //   --secret-string '{"api_key":"YOUR_KEY_HERE"}'
      secretObjectValue: {
        api_key: cdk.SecretValue.unsafePlainText('REPLACE_ME'),
      },
    });

    // ── S3 Buckets ────────────────────────────────────────────────────────────
    this.modelBucket = new s3.Bucket(this, 'ModelArtifactsBucket', {
      bucketName: `${BUCKET_MODEL_ARTIFACTS}-${this.account}-${this.region}`,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.staticWebBucket = new s3.Bucket(this, 'StaticWebBucket', {
      bucketName: `${BUCKET_STATIC_WEB}-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: this.dbInstance.dbInstanceEndpointAddress,
    });
    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: this.dbSecret.secretArn,
      exportName: 'DbSecretArn',
    });
    new cdk.CfnOutput(this, 'ApiKeySecretArn', {
      value: this.apiKeySecret.secretArn,
      exportName: 'ApiKeySecretArn',
    });
    new cdk.CfnOutput(this, 'ModelBucketName', {
      value: this.modelBucket.bucketName,
      exportName: 'ModelBucketName',
    });
    new cdk.CfnOutput(this, 'StaticWebBucketName', {
      value: this.staticWebBucket.bucketName,
      exportName: 'StaticWebBucketName',
    });
  }
}
