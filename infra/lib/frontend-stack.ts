import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { StorageStack } from './storage-stack';
import { ApiStack } from './api-stack';
import { COMMON_TAGS } from './shared/constants';
import { HttpOrigin } from 'aws-cdk-lib/aws-cloudfront-origins'

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


    // ── REST API origin — serves all /api/* requests ──────────────────────────
    // Extracts the domain name from the API Gateway URL and routes to the /prod stage
    const apiOrigin = new origins.HttpOrigin(cdk.Fn.parseDomainName(api.restApiUrl), {
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
          origin: apiOrigin,
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
        }
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
