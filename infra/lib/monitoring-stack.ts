import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { StorageStack } from './storage-stack';
import { ApiStack } from './api-stack';
import { COMMON_TAGS } from './shared/constants';

interface MonitoringStackProps extends cdk.StackProps {
  storage: StorageStack;
  api: ApiStack;
}

export class MonitoringStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);

    Object.entries(COMMON_TAGS).forEach(([k, v]) => cdk.Tags.of(this).add(k, v));

    // ── SNS Topic for Alarms ──────────────────────────────────────────────────
    const alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: 'price-tracker-alarms',
      displayName: 'Price Tracker Alarms',
    });

    // ── Helper: Lambda error rate alarm ──────────────────────────────────────
    const lambdaErrorAlarm = (fnName: string, threshold = 5) =>
      new cloudwatch.Alarm(this, `${fnName}ErrorAlarm`, {
        alarmName: `${fnName}-error-rate-high`,
        alarmDescription: `${fnName} Lambda error rate exceeded ${threshold}%`,
        metric: new cloudwatch.MathExpression({
          expression: '(errors/invocations)*100',
          usingMetrics: {
            errors: new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Errors',
              dimensionsMap: { FunctionName: fnName },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
            invocations: new cloudwatch.Metric({
              namespace: 'AWS/Lambda',
              metricName: 'Invocations',
              dimensionsMap: { FunctionName: fnName },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
            }),
          },
        }),
        threshold,
        evaluationPeriods: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      });

    ['price-fetcher', 'model-invoker', 'api-handler', 'model-trainer'].forEach(
      (fn) => {
        const alarm = lambdaErrorAlarm(fn);
        alarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));
      },
    );

    // ── RDS CPU Alarm ─────────────────────────────────────────────────────────
    const rdsCpuAlarm = new cloudwatch.Alarm(this, 'RdsCpuAlarm', {
      alarmName: 'rds-cpu-high',
      alarmDescription: 'RDS CPU utilization exceeded 80%',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          DBInstanceIdentifier: storage.dbInstance.instanceIdentifier,
        },
        statistic: 'Average',
        period: cdk.Duration.minutes(5),
      }),
      threshold: 80,
      evaluationPeriods: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    rdsCpuAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // ── price-fetcher Missing Invocations Alarm ───────────────────────────────
    // Alert if price-fetcher hasn't run in 15 minutes (3 missed cycles)
    const fetcherMissingAlarm = new cloudwatch.Alarm(this, 'FetcherMissingAlarm', {
      alarmName: 'price-fetcher-not-running',
      alarmDescription: 'price-fetcher has not been invoked for 15+ minutes',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: 'Invocations',
        dimensionsMap: { FunctionName: 'price-fetcher' },
        statistic: 'Sum',
        period: cdk.Duration.minutes(15),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    fetcherMissingAlarm.addAlarmAction(new cloudwatchActions.SnsAction(alarmTopic));

    // ── CloudWatch Dashboard ──────────────────────────────────────────────────
    const dashboard = new cloudwatch.Dashboard(this, 'MainDashboard', {
      dashboardName: 'price-tracker',
    });

    const lambdaMetric = (fn: string, metric: string, stat = 'Sum') =>
      new cloudwatch.Metric({
        namespace: 'AWS/Lambda',
        metricName: metric,
        dimensionsMap: { FunctionName: fn },
        statistic: stat,
        period: cdk.Duration.minutes(5),
      });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Lambda Invocations',
        width: 12,
        left: ['price-fetcher', 'api-handler', 'model-invoker'].map((fn) =>
          lambdaMetric(fn, 'Invocations'),
        ),
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Errors',
        width: 12,
        left: ['price-fetcher', 'api-handler', 'model-invoker'].map((fn) =>
          lambdaMetric(fn, 'Errors'),
        ),
      }),
      new cloudwatch.GraphWidget({
        title: 'Lambda Duration (ms)',
        width: 12,
        left: ['price-fetcher', 'api-handler', 'model-invoker'].map((fn) =>
          lambdaMetric(fn, 'Duration', 'Average'),
        ),
      }),
      new cloudwatch.GraphWidget({
        title: 'RDS CPU Utilization',
        width: 12,
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/RDS',
            metricName: 'CPUUtilization',
            dimensionsMap: {
              DBInstanceIdentifier: storage.dbInstance.instanceIdentifier,
            },
            statistic: 'Average',
            period: cdk.Duration.minutes(5),
          }),
        ],
      }),
    );
  }
}
