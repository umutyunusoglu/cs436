import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { StorageStack } from './storage-stack';
import { MlStack } from './ml-stack';
import {
  COMMON_TAGS,
  ENV_DB_SECRET_ARN,
  ENV_DB_HOST,
  ENV_DB_NAME,
  ENV_DB_PORT,
  ENV_MODEL_INVOKER_ARN,
  ENV_WS_ENDPOINT,
  RDS_DB_NAME,
  RDS_PORT,
} from './shared/constants';

import * as apigw from 'aws-cdk-lib/aws-apigateway';


interface ApiStackProps extends cdk.StackProps {
  storage: StorageStack;
  ml: MlStack;
}

export class ApiStack extends cdk.Stack {
  /** REMOVED Internet-facing ALB — the sole public HTTP entry point for the backend. */
  // Added REST API URL instead
  public readonly restApiUrl: string;
  /**
   * Hostname of the WebSocket API execute endpoint, e.g.
   * `abc123.execute-api.us-east-1.amazonaws.com`.
   * Used by FrontendStack to build a CloudFront origin.
   */
  public readonly wsApiExecuteUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    Object.entries(COMMON_TAGS).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const { storage, ml } = props;

    // ── Lambda: api-handler ───────────────────────────────────────────────────
    // Runs in the PUBLIC subnet so it can reach the Lambda service API
    // to invoke model-invoker (which lives in a private subnet).
    // The browser never calls this Lambda directly — only via ALB → CloudFront.
    const apiHandlerFn = new PythonFunction(this, 'ApiHandlerFn', {
      functionName: 'api-handler',
      layers: [storage.sharedLayer],
      entry: path.join(__dirname, '../../lambdas/api-handler'),
      runtime: lambda.Runtime.PYTHON_3_12,
      index: 'handler.py',
      handler: 'lambda_handler',
      memorySize: 256,
      timeout: cdk.Duration.seconds(15),
      vpc: storage.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [storage.lambdaSecurityGroup],
      allowPublicSubnet: true,
      environment: {
        [ENV_DB_SECRET_ARN]: storage.dbSecret.secretArn,
        [ENV_DB_HOST]: storage.dbInstance.dbInstanceEndpointAddress,
        [ENV_DB_NAME]: RDS_DB_NAME,
        [ENV_DB_PORT]: String(RDS_PORT),
        [ENV_MODEL_INVOKER_ARN]: ml.modelInvokerFn.functionArn
      },
    });

    storage.dbSecret.grantRead(apiHandlerFn);
    ml.modelInvokerFn.grantInvoke(apiHandlerFn);

    // ── WebSocket API ─────────────────────────────────────────────────────────
    // Browsers connect via CloudFront /ws → this API; api-handler manages
    // connection IDs and price-fetcher pushes updates to them.
    const wsApi = new apigwv2.WebSocketApi(this, 'WsApi', {
      apiName: 'price-tracker-ws',
      connectRouteOptions: {
        integration: new apigwv2integrations.WebSocketLambdaIntegration(
          'ConnectIntegration',
          apiHandlerFn,
        ),
      },
      disconnectRouteOptions: {
        integration: new apigwv2integrations.WebSocketLambdaIntegration(
          'DisconnectIntegration',
          apiHandlerFn,
        ),
      },
      defaultRouteOptions: {
        integration: new apigwv2integrations.WebSocketLambdaIntegration(
          'DefaultIntegration',
          apiHandlerFn,
        ),
      },
    });

    const wsStage = new apigwv2.WebSocketStage(this, 'WsStage', {
      webSocketApi: wsApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant api-handler permission to post back on WebSocket connections
    apiHandlerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/prod/POST/@connections/*`,
      ],
    }));

    // ── REST API Gateway ──────────────────────────────────────────────────────
    const restApi = new apigw.LambdaRestApi(this, 'RestApi', {
      restApiName: 'price-tracker-api',
      handler: apiHandlerFn,
      proxy: false,
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    restApi.root.addResource('prices').addMethod('GET');
    restApi.root.addResource('predict').addMethod('GET');
    restApi.root.addResource('technical').addMethod('GET');

    this.restApiUrl = restApi.url;

    // ── Exported values ───────────────────────────────────────────────────────
    // Used by FrontendStack to build CloudFront origins.
    this.wsApiExecuteUrl =
      `${wsApi.apiId}.execute-api.${this.region}.amazonaws.com`;

    new cdk.CfnOutput(this, 'RestApiUrl', {
      value: restApi.url,
      exportName: 'RestApiUrl',
    });
    new cdk.CfnOutput(this, 'WsApiUrl', {
      value: wsStage.url,
      exportName: 'WsApiUrl',
    });
  }
}
