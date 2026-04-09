export const PROJECT = 'price-tracker';
export const ENV_TAG = 'prod';

// Secret names in Secrets Manager
export const SECRET_METALS_API_KEY = 'metals-api-key';
export const SECRET_RDS_CREDENTIALS = 'rds-credentials';

// S3 bucket logical names (used as CDK IDs; actual names get account suffix)
export const BUCKET_MODEL_ARTIFACTS = 'model-artifacts';
export const BUCKET_STATIC_WEB = 'static-web';

// RDS
export const RDS_DB_NAME = 'pricetracker';
export const RDS_PORT = 5432;

// Lambda environment variable keys
export const ENV_DB_SECRET_ARN = 'DB_SECRET_ARN';
export const ENV_API_SECRET_ARN = 'API_SECRET_ARN';
export const ENV_MODEL_BUCKET = 'MODEL_BUCKET';
export const ENV_WS_ENDPOINT = 'WS_ENDPOINT';
export const ENV_MODEL_INVOKER_ARN = 'MODEL_INVOKER_ARN';
export const ENV_DB_HOST = 'DB_HOST';
export const ENV_DB_NAME = 'DB_NAME';
export const ENV_DB_PORT = 'DB_PORT';

// Common tags applied to all resources
export const COMMON_TAGS: Record<string, string> = {
  Project: PROJECT,
  Env: ENV_TAG,
  ManagedBy: 'CDK',
};
