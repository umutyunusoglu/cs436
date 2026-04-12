import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { StorageStack } from './storage-stack';
import { ApiStack } from './api-stack';
import { COMMON_TAGS } from './shared/constants';

interface FrontendStackProps extends cdk.StackProps {
  storage: StorageStack;
  api: ApiStack;
}

export class FrontendStack extends cdk.Stack {
  public readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    Object.entries(COMMON_TAGS).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const { storage, api } = props;

    // ── Origin Access Control (OAC) ───────────────────────────────────────────
    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      description: 'OAC for price-tracker static web bucket',
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(
      storage.staticWebBucket,
      { originAccessControl: oac },
    );

    // ── CloudFront Function: strip /api prefix before forwarding to ALB ───────
    // Viewer requests arrive as GET /api/prices; ALB+Lambda expects GET /prices.
    const apiRewriteFn = new cloudfront.Function(this, 'ApiPathRewrite', {
      functionName: 'price-tracker-api-rewrite',
      comment: 'Strips /api prefix from viewer request URI before origin forward',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  request.uri = request.uri.replace(/^\\/api/, '') || '/';
  return request;
}
      `.trim()),
    });

    // ── CloudFront Function: map /ws to / before forwarding to WebSocket API ──
    // WebSocket API GW accepts connections at /{stage}; originPath handles the
    // stage suffix so the viewer-facing URI just needs to become /.
    const wsRewriteFn = new cloudfront.Function(this, 'WsPathRewrite', {
      functionName: 'price-tracker-ws-rewrite',
      comment: 'Rewrites /ws to / before forwarding to WebSocket API GW origin',
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var request = event.request;
  request.uri = '/';
  return request;
}
      `.trim()),
    });

    // ── ALB origin — serves all /api/* requests ───────────────────────────────
    const albOrigin = new origins.LoadBalancerV2Origin(api.alb, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      // ALB listens on port 80; CloudFront→ALB is internal AWS network
    });

    // ── WebSocket API GW origin — serves /ws upgrades ─────────────────────────
    // api.wsApiExecuteUrl = "{apiId}.execute-api.{region}.amazonaws.com"
    // originPath "/prod" maps CloudFront's / to the API stage root
    const wsOrigin = new origins.HttpOrigin(api.wsApiExecuteUrl, {
      originPath: '/prod',
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
    });

    // ── CloudFront Distribution ───────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'CloudFrontDist', {
      comment: 'price-tracker SPA — single entry point for browser traffic',
      defaultBehavior: {
        // Default: serve the React SPA from S3
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      additionalBehaviors: {
        // /api/*  →  ALB  →  api-handler Lambda
        // Path prefix stripped by CloudFront Function before forwarding.
        '/api/*': {
          origin: albOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            {
              function: apiRewriteFn,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
        // /ws  →  WebSocket API Gateway
        // CloudFront transparently proxies the WS upgrade; URI rewritten to /
        // so API GW receives the connection at the stage root (/prod/).
        '/ws': {
          origin: wsOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy:
            cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [
            {
              function: wsRewriteFn,
              eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
            },
          ],
        },
      },
      defaultRootObject: 'index.html',
      // SPA fallback: return index.html for 403/404 so React Router works
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US/Europe — cheapest
    });

    this.distributionUrl = `https://${distribution.distributionDomainName}`;

    // ── Deploy frontend/dist to S3 ────────────────────────────────────────────
    new s3deploy.BucketDeployment(this, 'DeployStaticWeb', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../frontend/dist')),
      ],
      destinationBucket: storage.staticWebBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 256,
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: this.distributionUrl,
      description: 'Public URL — only entry point for browser traffic',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    });
  }
}
