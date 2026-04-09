import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwv2integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as elbv2targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
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

interface ApiStackProps extends cdk.StackProps {
  storage: StorageStack;
  ml: MlStack;
}

export class ApiStack extends cdk.Stack {
  public readonly restApiUrl: string;
  public readonly wsApiUrl: string;
  public readonly albDnsName: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    Object.entries(COMMON_TAGS).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const { storage, ml } = props;

    // ── Lambda: api-handler ───────────────────────────────────────────────────
    const apiHandlerFn = new PythonFunction(this, 'ApiHandlerFn', {
      functionName: 'api-handler',
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
        [ENV_MODEL_INVOKER_ARN]: ml.modelInvokerFn.functionArn,
        [ENV_WS_ENDPOINT]: '', // Filled after WebSocket API is created
      },
    });

    storage.dbSecret.grantRead(apiHandlerFn);
    ml.modelInvokerFn.grantInvoke(apiHandlerFn);

    // ── REST API Gateway ──────────────────────────────────────────────────────
    const restApi = new apigw.LambdaRestApi(this, 'RestApi', {
      restApiName: 'price-tracker-api',
      handler: apiHandlerFn,
      proxy: false,
      deployOptions: {
        stageName: 'prod',
        loggingLevel: apigw.MethodLoggingLevel.INFO,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigw.Cors.ALL_ORIGINS,
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const pricesResource = restApi.root.addResource('prices');
    pricesResource.addMethod('GET', new apigw.LambdaIntegration(apiHandlerFn));

    const predictResource = restApi.root.addResource('predict');
    predictResource.addMethod('GET', new apigw.LambdaIntegration(apiHandlerFn));

    const technicalResource = restApi.root.addResource('technical');
    technicalResource.addMethod('GET', new apigw.LambdaIntegration(apiHandlerFn));

    this.restApiUrl = restApi.url;

    // ── WebSocket API ─────────────────────────────────────────────────────────
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

    this.wsApiUrl = wsStage.url;

    // Grant api-handler permission to post back on WebSocket connections
    apiHandlerFn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [`arn:aws:execute-api:${this.region}:${this.account}:${wsApi.apiId}/prod/POST/@connections/*`],
    }));

    // Update WS_ENDPOINT env var now that we have the URL
    const cfnLambda = apiHandlerFn.node.defaultChild as lambda.CfnFunction;
    cfnLambda.addPropertyOverride('Environment.Variables.WS_ENDPOINT', wsStage.callbackUrl);

    // ── Application Load Balancer ─────────────────────────────────────────────
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: storage.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    const listener = alb.addListener('HttpListener', {
      port: 80,
      open: true,
    });

    // ALB → API Gateway (REST) via Lambda target
    listener.addTargets('ApiGatewayTarget', {
      targets: [new elbv2targets.LambdaTarget(apiHandlerFn)],
      healthCheck: { enabled: false },
    });

    this.albDnsName = alb.loadBalancerDnsName;

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'RestApiUrl', {
      value: restApi.url,
      exportName: 'RestApiUrl',
    });
    new cdk.CfnOutput(this, 'WsApiUrl', {
      value: wsStage.url,
      exportName: 'WsApiUrl',
    });
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: alb.loadBalancerDnsName,
      exportName: 'AlbDnsName',
    });
  }
}
