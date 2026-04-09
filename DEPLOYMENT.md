# Deployment Guide

Complete walkthrough from a brand-new AWS account to a fully running Gold & Silver Price Tracker.

---

## Part 1 — Create and Configure Your AWS Account

### 1.1 Sign Up

1. Go to [https://aws.amazon.com](https://aws.amazon.com) and click **Create an AWS Account**.
2. Enter your email address and choose an account name (e.g., `price-tracker-dev`).
3. Choose **Personal** account type.
4. Enter payment details — a valid credit card is required even for Free Tier. You will not be charged as long as you stay within limits.
5. Complete phone verification.
6. Select the **Basic Support** plan (free).
7. Sign in to the **AWS Management Console** at [https://console.aws.amazon.com](https://console.aws.amazon.com).

### 1.2 Secure the Root Account

> The root account has unrestricted access to everything. You should only use it for initial setup.

1. In the top-right corner, click your account name → **Security credentials**.
2. Under **Multi-factor authentication (MFA)**, click **Assign MFA device** and follow the steps to enable an authenticator app.
3. Do **not** create root access keys. Use an IAM user instead (next step).

### 1.3 Create an IAM Admin User

1. Open **IAM** → **Users** → **Create user**.
2. Username: `price-tracker-admin`
3. Check **Provide user access to the AWS Management Console**.
4. Select **I want to create an IAM user**, set a password, uncheck "must reset password".
5. Click **Next** → **Attach policies directly** → search for and select `AdministratorAccess`.
6. Click **Create user** and note the console sign-in URL.

### 1.4 Create Access Keys (for CLI)

1. In IAM → Users → click `price-tracker-admin` → **Security credentials** tab.
2. Under **Access keys**, click **Create access key**.
3. Select **Command Line Interface (CLI)** → confirm → click **Create**.
4. **Download the `.csv` file** or copy the Access Key ID and Secret Access Key now — you cannot retrieve the secret key again.

### 1.5 Choose a Region

Pick a region close to you that has all required services. Recommended choices:

| Location | Region code |
|---|---|
| US East (N. Virginia) | `us-east-1` |
| EU (Frankfurt) | `eu-central-1` |
| Asia Pacific (Singapore) | `ap-southeast-1` |

> All commands below use `us-east-1`. Substitute your region where needed.

---

## Part 2 — Install Local Tools

Run all commands in your terminal (Linux/macOS). On Windows, use WSL2.

### 2.1 AWS CLI

```bash
# macOS (Homebrew)
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip && sudo ./aws/install

# Verify
aws --version
# Expected: aws-cli/2.x.x
```

### 2.2 Configure AWS CLI

```bash
aws configure
```

Enter when prompted:

```
AWS Access Key ID:     <your access key ID from step 1.4>
AWS Secret Access Key: <your secret access key from step 1.4>
Default region name:   us-east-1
Default output format: json
```

Verify it works:

```bash
aws sts get-caller-identity
# Should return your account ID and ARN
```

### 2.3 Node.js (v18+)

```bash
# macOS
brew install node

# Linux (via nvm — recommended)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# Verify
node --version   # v20.x.x
npm --version    # 10.x.x
```

### 2.4 AWS CDK v2

```bash
npm install -g aws-cdk

# Verify
cdk --version
# Expected: 2.x.x
```

### 2.5 Python 3.12

```bash
# macOS
brew install python@3.12

# Ubuntu/Debian
sudo apt update && sudo apt install python3.12 python3.12-venv python3-pip

# Verify
python3.12 --version
```

### 2.6 Docker (required for CDK Lambda bundling)

CDK uses Docker to install Python Lambda dependencies in a container that matches the Lambda runtime.

```bash
# macOS: install Docker Desktop from https://www.docker.com/products/docker-desktop

# Linux
sudo apt install docker.io
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker info
```

---

## Part 3 — Get a goldapi.io API Key

1. Go to [https://www.goldapi.io](https://www.goldapi.io) and click **Sign Up** (free plan available).
2. After signing in, go to **Dashboard** → copy your **API Key** (looks like `goldapi-xxxx-xxxx`).
3. Keep it handy — you'll add it to AWS Secrets Manager in Part 5.

---

## Part 4 — CDK Bootstrap

Bootstrap creates the CDK staging infrastructure (an S3 bucket and IAM roles) in your account. This is a one-time step per account/region.

```bash
cd /path/to/cs436/infra
npm install

# Replace 123456789012 with your actual AWS account ID
# Run: aws sts get-caller-identity --query Account --output text
cdk bootstrap aws://$(aws sts get-caller-identity --query Account --output text)/us-east-1
```

Expected output ends with:
```
✅  Environment aws://123456789012/us-east-1 bootstrapped.
```

---

## Part 5 — Deploy the Infrastructure

Deploy each stack in order. Each step takes 2–15 minutes.

### Step 5.1 — Storage Layer

Creates the VPC, RDS PostgreSQL instance, two S3 buckets, and Secrets Manager secrets.

```bash
cdk deploy StorageStack
```

When prompted `Do you wish to deploy these changes (y/n)?` → type `y`.

This takes ~8–12 minutes (RDS provisioning is slow).

At the end, note the outputs — you'll need `DbEndpoint`:

```
Outputs:
StorageStack.DbEndpoint = price-tracker-rds.xxxx.us-east-1.rds.amazonaws.com
StorageStack.DbSecretArn = arn:aws:secretsmanager:us-east-1:...
StorageStack.ModelBucketName = model-artifacts-123456789012-us-east-1
StorageStack.StaticWebBucketName = static-web-123456789012-us-east-1
```

### Step 5.2 — Add Your goldapi.io Key to Secrets Manager

```bash
aws secretsmanager put-secret-value \
  --secret-id metals-api-key \
  --secret-string '{"api_key":"YOUR_GOLDAPI_KEY_HERE"}'
```

Verify it was stored:

```bash
aws secretsmanager get-secret-value --secret-id metals-api-key \
  --query SecretString --output text
# Should print: {"api_key":"goldapi-xxxx-xxxx"}
```

### Step 5.3 — Run Database Schema Migration

You need to connect to RDS to create the tables. RDS is in a private subnet, so connect via the AWS Systems Manager Session Manager or a temporary bastion.

**Option A — Temporary EC2 Bastion (easiest)**

```bash
# 1. Launch a tiny EC2 in the public subnet of your VPC
VPC_ID=$(aws ec2 describe-vpcs \
  --filters "Name=tag:Project,Values=price-tracker" \
  --query "Vpcs[0].VpcId" --output text)

SUBNET_ID=$(aws ec2 describe-subnets \
  --filters "Name=vpc-id,Values=$VPC_ID" "Name=tag:Name,Values=*public*" \
  --query "Subnets[0].SubnetId" --output text)

# Use the latest Amazon Linux 2023 AMI
AMI_ID=$(aws ec2 describe-images \
  --owners amazon \
  --filters "Name=name,Values=al2023-ami-*-x86_64" \
  --query "sort_by(Images,&CreationDate)[-1].ImageId" \
  --output text)

# Launch bastion (t2.micro — Free Tier)
INSTANCE_ID=$(aws ec2 run-instances \
  --image-id $AMI_ID \
  --instance-type t2.micro \
  --subnet-id $SUBNET_ID \
  --associate-public-ip-address \
  --iam-instance-profile Name=SSMInstanceProfile \
  --query "Instances[0].InstanceId" \
  --output text)

echo "Bastion instance ID: $INSTANCE_ID"
# Wait ~2 minutes for it to boot, then SSH or use SSM
```

> **Note**: You'll need an SSM instance profile. Alternatively, create an EC2 key pair and open port 22 in the Lambda security group for your IP. Then SSH in.

**Option B — AWS RDS Query Editor (if using Aurora — not applicable here)**

**Option C — Lambda one-shot migration (simplest, no bastion needed)**

Create a one-time Lambda to run the migration:

```bash
# Get the DB secret ARN and host from StorageStack outputs
DB_SECRET_ARN=$(aws cloudformation describe-stacks \
  --stack-name StorageStack \
  --query "Stacks[0].Outputs[?OutputKey=='DbSecretArn'].OutputValue" \
  --output text)

DB_HOST=$(aws cloudformation describe-stacks \
  --stack-name StorageStack \
  --query "Stacks[0].Outputs[?OutputKey=='DbEndpoint'].OutputValue" \
  --output text)

# Invoke a migration by temporarily creating an inline Lambda
# OR — the simplest approach: use the price-fetcher Lambda to run migration
# since it already has DB access. Invoke it with a special migration event:

# Actually the easiest: use AWS CloudShell (it has outbound internet)
# or just proceed to Step 5.4 and run the migration from api-handler
```

**Recommended: Use AWS CloudShell**

1. Open [AWS CloudShell](https://console.aws.amazon.com/cloudshell) in the console (top toolbar).
2. Install psql:
   ```bash
   sudo dnf install -y postgresql15
   ```
3. Get the DB password:
   ```bash
   DB_SECRET=$(aws secretsmanager get-secret-value \
     --secret-id rds-credentials --query SecretString --output text)
   DB_PASS=$(echo $DB_SECRET | python3 -c "import sys,json; print(json.load(sys.stdin)['password'])")
   DB_USER=$(echo $DB_SECRET | python3 -c "import sys,json; print(json.load(sys.stdin)['username'])")
   DB_HOST="<your-rds-endpoint-from-step-5.1>"
   ```
4. Connect and run schema:
   ```bash
   # Note: CloudShell cannot reach RDS in a private subnet directly.
   # You must allow CloudShell's IP in the DB security group, OR
   # temporarily make RDS publicly accessible for migration only.
   
   # Temporarily allow public access (re-disable after migration):
   aws rds modify-db-instance \
     --db-instance-identifier <your-db-identifier> \
     --publicly-accessible \
     --apply-immediately
   
   # Wait ~2 min for the change to apply, then:
   PGPASSWORD=$DB_PASS psql -h $DB_HOST -U $DB_USER -d pricetracker \
     -f /path/to/cs436/infra/schema.sql
   
   # Immediately re-disable public access:
   aws rds modify-db-instance \
     --db-instance-identifier <your-db-identifier> \
     --no-publicly-accessible \
     --apply-immediately
   ```

Find your DB instance identifier:
```bash
aws rds describe-db-instances \
  --query "DBInstances[?DBName=='pricetracker'].DBInstanceIdentifier" \
  --output text
```

### Step 5.4 — Deploy Lambda Stacks

```bash
cdk deploy IngestionStack MlStack ApiStack
```

This deploys all three stacks in parallel where possible. Takes ~5–8 minutes.

Note the outputs from `ApiStack`:

```
Outputs:
ApiStack.RestApiUrl  = https://xxxx.execute-api.us-east-1.amazonaws.com/prod/
ApiStack.WsApiUrl    = wss://yyyy.execute-api.us-east-1.amazonaws.com/prod
ApiStack.AlbDnsName  = price-tracker-alb-xxxx.us-east-1.elb.amazonaws.com
```

### Step 5.5 — Build and Deploy Frontend

```bash
# Build the React app
cd ../frontend
npm install

# Create your production env file
cat > .env.production << EOF
VITE_API_URL=http://$(cd ../infra && aws cloudformation describe-stacks \
  --stack-name ApiStack \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" \
  --output text)
VITE_WS_URL=$(cd ../infra && aws cloudformation describe-stacks \
  --stack-name ApiStack \
  --query "Stacks[0].Outputs[?OutputKey=='WsApiUrl'].OutputValue" \
  --output text)
EOF

npm run build
# Creates frontend/dist/

cd ../infra
cdk deploy FrontendStack
```

Note the CloudFront URL:

```
Outputs:
FrontendStack.CloudFrontUrl = https://xxxx.cloudfront.net
```

### Step 5.6 — Deploy Monitoring

```bash
cdk deploy MonitoringStack
```

---

## Part 6 — Verify Everything Works

### 6.1 Check Price Ingestion

Wait up to 5 minutes for the first scheduled invocation, then check CloudWatch:

```bash
aws logs tail /aws/lambda/price-fetcher --follow
```

You should see log lines like:
```
Wrote XAU OHLC: close=2345.1200
Wrote XAG OHLC: close=27.4300
```

### 6.2 Test the REST API

```bash
ALB=$(aws cloudformation describe-stacks \
  --stack-name ApiStack \
  --query "Stacks[0].Outputs[?OutputKey=='AlbDnsName'].OutputValue" \
  --output text)

# Prices endpoint
curl "http://$ALB/prices?metal=gold&range=1d" | python3 -m json.tool

# Technical indicators
curl "http://$ALB/technical?metal=gold" | python3 -m json.tool

# Prediction (returns 503 until model-trainer has run at least once)
curl "http://$ALB/predict?metal=gold" | python3 -m json.tool
```

### 6.3 Trigger Model Training Manually

The weekly schedule won't fire until Sunday. Trigger it now for testing:

```bash
aws lambda invoke \
  --function-name model-trainer \
  --payload '{}' \
  --cli-binary-format raw-in-base64-out \
  /tmp/trainer-output.json

cat /tmp/trainer-output.json
# {"statusCode": 200, "body": "Training complete"}
```

> Note: Training needs at least 100 OHLC rows. Wait for the price-fetcher to accumulate data first (or trigger it manually a few times).

Trigger price-fetcher manually to accumulate data quickly:

```bash
# Run 50 times to get enough data for training
for i in $(seq 1 50); do
  aws lambda invoke \
    --function-name price-fetcher \
    --payload '{}' \
    --cli-binary-format raw-in-base64-out \
    /tmp/out.json > /dev/null
  echo -n "."
  sleep 2
done
echo " done"
```

Then retry model training and the prediction endpoint.

### 6.4 Open the Frontend

```bash
CF_URL=$(aws cloudformation describe-stacks \
  --stack-name FrontendStack \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" \
  --output text)

echo "Open: $CF_URL"
```

Open the URL in your browser. You should see:
- The candlestick chart with historical data
- RSI and MACD charts below
- A prediction badge (after model training)

### 6.5 Check the CloudWatch Dashboard

Open [CloudWatch Dashboards](https://console.aws.amazon.com/cloudwatch/home#dashboards) in the console and click **price-tracker** to see Lambda invocations, errors, duration, and RDS CPU.

---

## Part 7 — Tear Down (Save Costs)

When you're done, destroy all AWS resources to avoid charges:

```bash
cd infra

# Destroy in reverse dependency order
cdk destroy MonitoringStack
cdk destroy FrontendStack
cdk destroy ApiStack MlStack IngestionStack
cdk destroy StorageStack
```

> **Warning**: `StorageStack` destruction deletes the RDS instance and all price data. The `model-artifacts` S3 bucket has `RemovalPolicy.RETAIN` — delete it manually if needed:
> ```bash
> aws s3 rb s3://model-artifacts-<account>-<region> --force
> ```

---

## Troubleshooting

### Lambda can't connect to RDS

- Confirm RDS security group allows TCP 5432 from the Lambda security group.
- Both Lambda and RDS must be in the same VPC.
- Check the Lambda's VPC config in the AWS Console → Lambda → Configuration → VPC.

### `cdk deploy` fails with Docker not found

- Ensure Docker daemon is running: `docker info`
- On Linux: `sudo systemctl start docker`

### `price-fetcher` returns 401 from goldapi.io

- The API key in Secrets Manager is wrong or still `REPLACE_ME`.
- Re-run Step 5.2 with the correct key.

### CloudFront returns 403

- The `dist/` folder may not have been uploaded. Re-run `cdk deploy FrontendStack` after `npm run build`.
- Check that `frontend/dist/index.html` exists before deploying.

### Prediction returns 503 "No trained model found"

- Run model-trainer manually (Step 6.3) after accumulating enough price data.
- Check model-trainer CloudWatch logs: `aws logs tail /aws/lambda/model-trainer --follow`

### `cdk bootstrap` fails with "already bootstrapped"

- Safe to ignore — it's idempotent.

### RDS instance won't start / billing concern

- You only get 750 hours/month of t3.micro RDS for free. With one instance that's exactly 31 days.
- If you have another RDS instance running in the same account/region, you may exceed Free Tier.

---

## Cost Monitoring

Set a billing alarm to protect against unexpected charges:

```bash
# Alert if estimated charges exceed $5
aws cloudwatch put-metric-alarm \
  --alarm-name billing-alert-5usd \
  --alarm-description "Alert when AWS charges exceed $5" \
  --metric-name EstimatedCharges \
  --namespace AWS/Billing \
  --statistic Maximum \
  --period 86400 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold \
  --dimensions Name=Currency,Value=USD \
  --evaluation-periods 1 \
  --alarm-actions arn:aws:sns:us-east-1:$(aws sts get-caller-identity \
    --query Account --output text):price-tracker-alarms \
  --region us-east-1
```

Also enable billing alerts in the console:
1. Go to **Billing** → **Billing preferences**
2. Check **Receive Free Tier usage alerts**
3. Check **Receive AWS Billing Alerts**

---

## Quick Reference

```bash
# Get all stack outputs at once
for stack in StorageStack IngestionStack MlStack ApiStack FrontendStack; do
  echo "=== $stack ==="
  aws cloudformation describe-stacks \
    --stack-name $stack \
    --query "Stacks[0].Outputs[*].[OutputKey,OutputValue]" \
    --output table 2>/dev/null || echo "(not deployed)"
done

# Tail all Lambda logs simultaneously
aws logs tail /aws/lambda/price-fetcher --follow &
aws logs tail /aws/lambda/api-handler --follow &
aws logs tail /aws/lambda/model-invoker --follow &
wait
```
