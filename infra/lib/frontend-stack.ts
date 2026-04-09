import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { StorageStack } from './storage-stack';
import { COMMON_TAGS } from './shared/constants';

interface FrontendStackProps extends cdk.StackProps {
  storage: StorageStack;
}

export class FrontendStack extends cdk.Stack {
  public readonly distributionUrl: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    Object.entries(COMMON_TAGS).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    const { storage } = props;

    // ── Origin Access Control (OAC) ───────────────────────────────────────────
    const oac = new cloudfront.S3OriginAccessControl(this, 'OAC', {
      description: 'OAC for price-tracker static web bucket',
    });

    const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(
      storage.staticWebBucket,
      { originAccessControl: oac },
    );

    // ── CloudFront Distribution ───────────────────────────────────────────────
    const distribution = new cloudfront.Distribution(this, 'CloudFrontDist', {
      comment: 'price-tracker SPA',
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      defaultRootObject: 'index.html',
      // SPA fallback: return index.html for all 403/404 so React Router works
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
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // US/Europe only — cheapest
    });

    this.distributionUrl = `https://${distribution.distributionDomainName}`;

    // ── Deploy frontend/dist to S3 ────────────────────────────────────────────
    // Run `npm run build` in frontend/ before deploying this stack.
    new s3deploy.BucketDeployment(this, 'DeployStaticWeb', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../frontend/dist')),
      ],
      destinationBucket: storage.staticWebBucket,
      distribution,
      distributionPaths: ['/*'], // Invalidate all CloudFront paths on deploy
      memoryLimit: 256,
    });

    // ── Outputs ───────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: this.distributionUrl,
      description: 'Public URL of the React SPA',
    });
    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
    });
  }
}
