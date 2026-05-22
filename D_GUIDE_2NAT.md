# AWS Serverless Deployment Guide: Price Tracker (Multi-AZ, Full NAT Redundancy)

> **Architecture:** CloudFront → S3 (SPA) | HTTP & WebSocket API Gateway → Lambda → RDS PostgreSQL (Multi-AZ)
> **Region:** eu-west-1 (Ireland) — adjust region references if deploying elsewhere.
> **NAT configuration:** One NAT Gateway per AZ (2 total) for full outbound redundancy. If either AZ fails, Lambdas in the surviving AZ retain uninterrupted internet access. See `DEPLOYMENT_GUIDE.md` for the single-NAT cost-saving variant.

---

## Estimated Monthly Cost (eu-west-1)

| Service | Configuration | $/month |
|---|---|---|
| RDS PostgreSQL 15.4 | db.t3.micro, Multi-AZ, gp3 20 GB | ~$30.00 |
| NAT Gateway ×2 | One per AZ, ~$0.048/hr each + data processing | ~$72.00 |
| Elastic IP ×2 | One attached to each NAT Gateway | ~$7.20 |
| Secrets Manager | 2 secrets × $0.40/mo (after 30-day trial) | ~$0.80 |
| CloudWatch Logs | 4 Lambda log groups, low volume | ~$0.50 |
| Lambda (×4) | 512 MB, ~9K req/mo — within always-free tier | ~$0.00 |
| API Gateway HTTP | ~9K req/mo — within always-free tier | ~$0.00 |
| API Gateway WebSocket | Course-project connection volume | ~$0.00 |
| CloudFront | SPA traffic — within always-free tier | ~$0.00 |
| S3 (×2 buckets) | < 100 MB total | ~$0.02 |
| EventBridge (×2 rules) | Always free | $0.00 |
| VPC, Subnets, SGs, IGW | Always free | $0.00 |
| **Total** | | **~$110/month** |

> **Credit runway:** With $100 in AWS credits, this architecture runs for approximately **27 days** before out-of-pocket billing begins.
>
> **10-day project cost:** If the system runs for 7–10 days as expected, the total spend will be approximately **$24–37**, comfortably within the $100 credit. Tear down promptly after grading — leaving the stack running for a full month would exhaust the credit entirely with ~$10 left over.
>
> **Why two NAT Gateways?** With a single NAT Gateway, an AZ-a outage would leave Lambdas placed in AZ-b unable to reach the Tiingo API or AWS service endpoints, even though the RDS standby would have already promoted in AZ-b. Two NAT Gateways — one per AZ, each with its own route table — ensure each AZ's Lambda instances always route through a local NAT, achieving true outbound redundancy that matches the RDS Multi-AZ guarantee.
>
> **Free tier note:** The 12-month EC2/RDS trial (single-AZ only) does not apply to Multi-AZ RDS, which is billed from day one regardless of account age.

---

## Phase 1: Networking & Security Groups

*We configure a fully redundant 2-AZ network with one NAT Gateway and one Elastic IP per AZ, and two separate private route tables — one per AZ — so each AZ's outbound traffic routes through its local NAT.*

> **Why the VPC wizard alone isn't enough:** The console's **VPC and more** wizard supports "NAT gateways: In 1 AZ" or "1 per AZ". Selecting **1 per AZ** will create both NAT Gateways automatically, but it also auto-creates a single shared private route table pointing only to NAT Gateway 1. You must manually correct this after the wizard completes: create a second private route table for AZ-b pointing to NAT Gateway 2, and re-associate Private Subnet 2 with it. The steps below walk through this explicitly.

### 1. Create the VPC

1. Go to **VPC** > **VPCs** > **Create VPC**.
2. Select **VPC and more**.
3. Set the following:
   - **Name tag:** `price-tracker`
   - **IPv4 CIDR block:** `10.0.0.0/16`
   - **Number of AZs:** 2
   - **Public subnets:** 2
   - **Private subnets:** 2
   - **NAT gateways:** **1 per AZ**
   - **VPC endpoints:** None
4. Click **Create VPC**.

AWS will create the VPC, Internet Gateway, 4 subnets, allocate 2 Elastic IPs, and provision both NAT Gateways. This takes approximately 2–3 minutes.

> ⚠️ **After the wizard completes**, note the names/IDs of the following resources — you will need them in steps 2 and 3:
> - **Public Subnet 1** (in AZ-a, e.g. `eu-west-1a`)
> - **Public Subnet 2** (in AZ-b, e.g. `eu-west-1b`)
> - **Private Subnet 1** (in AZ-a)
> - **Private Subnet 2** (in AZ-b)
> - **NAT Gateway 1** (placed in Public Subnet 1 / AZ-a)
> - **NAT Gateway 2** (placed in Public Subnet 2 / AZ-b)
>
> Go to **VPC** > **NAT Gateways** and confirm both show status **Available** and are placed in the correct AZs before continuing.

### 2. Verify and Fix the Private Route Tables

The wizard may create only one private route table and associate both private subnets with it, pointing all traffic to NAT Gateway 1. You need two separate private route tables — one per AZ.

**Check existing state:**

1. Go to **VPC** > **Route Tables**.
2. Filter by your VPC. Look for route tables that contain a route with destination `0.0.0.0/0` pointing to a NAT Gateway.
3. Check the **Subnet associations** tab for each. If both Private Subnet 1 and Private Subnet 2 are associated with the same route table, proceed with the fix below. If they are already on separate route tables each pointing to their own NAT Gateway, skip to step 3.

**Create Private Route Table 2 (for AZ-b):**

1. Go to **VPC** > **Route Tables** > **Create route table**.
2. **Name:** `price-tracker-private-rtb-2`
3. **VPC:** `price-tracker-vpc`
4. Click **Create route table**.
5. Select the new route table → **Routes** tab → **Edit routes** → **Add route**:
   - **Destination:** `0.0.0.0/0`
   - **Target:** NAT Gateway → select **NAT Gateway 2** (the one in AZ-b / Public Subnet 2)
6. Click **Save changes**.
7. Go to the **Subnet associations** tab → **Edit subnet associations** → select **Private Subnet 2** (AZ-b) → **Save associations**.

**Fix Private Route Table 1 (for AZ-a):**

1. Find the original private route table (associated with Private Subnet 1).
2. Confirm its `0.0.0.0/0` route points to **NAT Gateway 1** (AZ-a). If it does, no change needed.
3. Go to the **Subnet associations** tab and confirm only **Private Subnet 1** is associated. If Private Subnet 2 was also associated here, it will now be unassociated — that is correct; it is now handled by Route Table 2.
4. Optionally rename this route table to `price-tracker-private-rtb-1` for clarity.

**Result:** Private Subnet 1 (AZ-a) → NAT Gateway 1 (AZ-a). Private Subnet 2 (AZ-b) → NAT Gateway 2 (AZ-b). Each AZ is fully self-contained for outbound traffic.

### 3. Create Security Groups

Go to **VPC** > **Security Groups** > **Create security group**.

**Lambda SG:**
- **Name:** `lambda-sg`
- **VPC:** Select `price-tracker-vpc`
- **Outbound rules:** Leave as `All traffic` — required for Lambdas and CloudShell to reach the internet and RDS.
- Click **Create**.

**RDS SG:**
- **Name:** `rds-sg`
- **VPC:** Select `price-tracker-vpc`
- **Inbound rule:** Type `PostgreSQL` (Port 5432) | Source: Custom → select `lambda-sg`
- Click **Create**.

---

## Phase 2: Secrets & Storage

### 1. Create Secrets

Go to **Secrets Manager** > **Store a new secret**.

**Secret 1 — Database credentials:**
- Type: **Other type of secret**
- Key/value pairs: `username` = `postgres` | `password` = *(generate a 24-character alphanumeric string)*
- **Name:** `pricetracker-db-creds`
- Click through to **Store**.

**Secret 2 — Tiingo API key:**
- Type: **Other type of secret**
- Key/value pair: `api_key` = *(paste your Tiingo token)*
- **Name:** `pricetracker-metals-api-key`
- Click through to **Store**.

> ⚠️ **ACTION ITEM:** After creating each secret, click into it and copy its **Secret ARN** from the detail page. You will need both ARNs in Phase 4. Store them somewhere accessible (e.g. a local notepad).

### 2. Create S3 Buckets

Go to **S3** > **Create bucket**.

**Models bucket:**
- **Name:** `pricetracker-models-[your-account-id]`
- Keep **Block all public access** checked.
- Click **Create bucket**.

**Web bucket:**
- **Name:** `pricetracker-web-[your-account-id]`
- Keep **Block all public access** checked. *(CloudFront OAC will handle access — do not enable static website hosting.)*
- Click **Create bucket**.

---

## Phase 3: Database & CloudShell Migration

### 1. Create DB Subnet Group

Go to **RDS** > **Subnet groups** > **Create DB subnet group**.

- **Name:** `pricetracker-sng`
- **VPC:** Select `price-tracker-vpc`
- **Subnets:** Add **both private subnets** (Private Subnet 1 in AZ-a and Private Subnet 2 in AZ-b).
- Click **Create**.

### 2. Provision Multi-AZ RDS

Go to **RDS** > **Databases** > **Create database**.

| Setting | Value |
|---|---|
| Creation method | Standard create |
| Engine | PostgreSQL 15.4 |
| Template | Dev/Test |
| DB instance identifier | `pricetracker-db` |
| Master username | `postgres` |
| Master password | Paste the password from `pricetracker-db-creds` |
| Instance class | `db.t3.micro` *(max ~85 concurrent connections)* |
| Storage type | gp3 |
| Allocated storage | 20 GB |
| Storage autoscaling | **Disabled** |
| Availability & durability | **Create a standby instance (Multi-AZ)** |
| VPC | `price-tracker-vpc` |
| DB subnet group | `pricetracker-sng` |
| Public access | **No** |
| VPC security groups | `rds-sg` |
| Initial database name *(Additional Configuration)* | `pricetracker` ← **Crucial** |
| Deletion protection *(Additional Configuration)* | **Enabled** ← **Crucial** |

Click **Create database**. This takes approximately 10 minutes.

### 3. Run the Schema Migration

Once the database status shows **Available**:

1. Open **CloudShell** (the `>_` terminal icon in the top-right AWS navbar).
2. Click **Actions** > **VPC environment settings**.
3. Select `price-tracker-vpc`, **Private Subnet 1** (AZ-a) *(either private subnet works — both now have NAT Gateway access via their respective route tables)*, and `lambda-sg`.
4. Click **Actions** > **Upload file** and upload your local `schema.sql` file. CloudShell places it in `~/`.
5. Install PostgreSQL tools:

```bash
sudo dnf install -y postgresql15
```

6. Connect and run the schema:

```bash
psql -h <YOUR_RDS_ENDPOINT> -U postgres -d pricetracker -f ~/schema.sql
```

7. Paste the database password when prompted. The schema will execute and return to the terminal prompt automatically. No `\q` is needed.

### 4. Load Historical Price Data (Initial Training Dataset)

Before deploying the Lambdas, seed the database with your 1-month historical OHLC dataset (~8,000 rows collected locally from 13 Apr – 13 May 2026). This gives the `model-trainer` enough data to train immediately on first invocation, rather than waiting 90 days for the `price-fetcher` to accumulate sufficient rows.

> **Data preparation (do this locally before uploading):**
> 1. Open your exported CSV (`ohlc_prices.csv`) and clean the ~200 problematic rows you identified.
> 2. Remove the `id`, `currency`, and `created_at` columns — the database auto-generates `id` and `created_at`, and the schema has no `currency` column. Keep only: `metal,open,high,low,close,volume,timestamp`
> 3. Save the cleaned file as `ohlc_seed.csv` with headers included.
>
> Your final CSV should look like:
> ```
> metal,open,high,low,close,volume,timestamp
> XAU,4709.9900,4709.9900,4709.9900,4709.9900,0.0000,2026-04-13 12:20:00+00
> XAG,74.1620,74.1620,74.1620,74.1620,0.0000,2026-04-13 12:20:00+00
> ```

**Upload and import the data via CloudShell:**

1. If your CloudShell VPC session from the previous step is still active, continue. Otherwise, re-open CloudShell and re-attach to the VPC (same settings: `price-tracker-vpc`, a private subnet, `lambda-sg`).

2. Click **Actions** > **Upload file** and upload `ohlc_seed.csv`. CloudShell places it in `~/`.

3. Import the CSV into the `ohlc_prices` table using PostgreSQL's `\copy` command:

```bash
psql -h <YOUR_RDS_ENDPOINT> -U postgres -d pricetracker
```

4. Paste the database password, then run:

```sql
\copy ohlc_prices(metal, open, high, low, close, volume, timestamp) FROM '~/ohlc_seed.csv' WITH (FORMAT csv, HEADER true);
```

5. Verify the import:

```sql
SELECT metal, COUNT(*) FROM ohlc_prices GROUP BY metal;
```

You should see approximately 4,000+ rows for XAU and 4,000+ rows for XAG.

6. Type `\q` to exit.

> 💡 **Why this matters:** The `model-trainer` Lambda requires at least 100 rows per metal and uses the last 90 days of data (`WHERE timestamp > NOW() - INTERVAL '90 days'`). Since your data spans 13 Apr – 13 May 2026, you have a 30-day window. Once deployed, the `model-trainer` EventBridge rule fires every Sunday at 02:00 UTC. If your deployment date is within 90 days of May 13, the trainer will find your historical data and train successfully on first run. The `price-fetcher` will then continue appending fresh 5-minute bars going forward.

---

## Phase 4: IAM & Serverless Compute

> **Note:** The CDK README references a "Shared Lambda Layer." For this console deployment, we use per-function packaging instead, ensuring isolated dependency management without requiring CDK infrastructure.

### 1. Create the Least-Privilege IAM Role

Go to **IAM** > **Roles** > **Create role**.

- **Trusted entity:** AWS service → **Lambda**
- **Permissions:** Add managed policy `AWSLambdaVPCAccessExecutionRole` *(required for VPC attachment)*
- **Role name:** `pricetracker-lambda-role`
- Click **Create role**.

Open the newly created role, click **Add permissions** > **Create inline policy**, switch to **JSON**, and paste the following. Replace `REGION`, `ACCOUNT_ID` with your values:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:REGION:ACCOUNT_ID:secret:pricetracker-*"
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": "arn:aws:s3:::pricetracker-models-ACCOUNT_ID/*"
    },
    {
      "Effect": "Allow",
      "Action": "execute-api:ManageConnections",
      "Resource": "arn:aws:execute-api:REGION:ACCOUNT_ID:*/production/POST/@connections/*"
    },
    {
      "Effect": "Allow",
      "Action": "lambda:InvokeFunction",
      "Resource": "arn:aws:lambda:REGION:ACCOUNT_ID:function:pricetracker-model-invoker"
    }
  ]
}
```

Name the policy `pricetracker-inline-policy` and save.

### 2. Package Lambda Functions

Run the following in your terminal for each Lambda function directory (`price-fetcher`, `model-trainer`, `model-invoker`, `api-handler`):

```bash
mkdir -p build && rsync -a --exclude='build' --exclude='function.zip' . build/
[ -f requirements.txt ] && pip install -r requirements.txt -t build/
cd build && zip -r ../function.zip . && cd ..
rm -rf build
```

> **Windows users:** Use WSL2, or manually copy files into a staging folder, run `pip install -r requirements.txt -t build\`, and zip the `build\` folder contents.

### 3. Deploy Lambda Functions

Go to **Lambda** > **Create function**. Repeat for all four functions: `price-fetcher`, `model-trainer`, `model-invoker`, `api-handler`.

For each function:
- **Runtime:** Python 3.12
- **Execution role:** Use existing role → `pricetracker-lambda-role`
- **Advanced settings:** Enable VPC → select `price-tracker-vpc`, **both private subnets** (AZ-a and AZ-b), `lambda-sg`
- Click **Create function**.

After creation, apply the following configuration to **each** function:

**Upload code:**
Go to **Code** > **Upload from** > **.zip file** → upload the appropriate `function.zip`.

**Set memory and timeout:**
Go to **Configuration** > **General configuration** > **Edit**:
- **Memory:** `512 MB` *(prevents OOM errors on ML inference; safe baseline for all functions)*
- **Timeout:** `60 seconds` *(covers cold starts, Tiingo API latency, and ML inference time)*

**Set environment variables:**
Go to **Configuration** > **Environment variables** > **Edit**, and add the following per function:

| Function | Environment variables |
|---|---|
| `price-fetcher` | `DB_SECRET_ARN` = *(ARN of pricetracker-db-creds)* <br> `API_SECRET_ARN` = *(ARN of pricetracker-metals-api-key)* <br> `DB_HOST` = *(RDS endpoint)* <br> `DB_NAME` = `pricetracker` <br> *(+ `WS_ENDPOINT` — added in Phase 5)* |
| `model-trainer` | `DB_SECRET_ARN`, `DB_HOST`, `DB_NAME` = `pricetracker`, `MODEL_BUCKET` = `pricetracker-models-[account-id]` |
| `model-invoker` | `DB_SECRET_ARN`, `DB_HOST`, `DB_NAME` = `pricetracker`, `MODEL_BUCKET` = `pricetracker-models-[account-id]` |
| `api-handler` | `DB_SECRET_ARN`, `DB_HOST`, `DB_NAME` = `pricetracker`, `MODEL_INVOKER_ARN` = `model-invoker` <br> *(+ `WS_ENDPOINT` — added in Phase 5)* |

---

## Phase 5: The API Layer

### 1. Create HTTP API (REST)

1. Go to **API Gateway** > **Create API** > **HTTP API**.
2. **Integration:** Lambda → `api-handler`
3. **Name:** `pricetracker-http-api`
4. Keep the `$default` route. *(Internal routing to `/prices`, `/predict`, `/technical` is handled by the application code via Mangum/FastAPI.)*
5. Click through to **Create and deploy**.
6. Note the **Invoke URL**.

### 2. Create WebSocket API

1. Go to **API Gateway** > **Create API** > **WebSocket API**.
2. **Name:** `pricetracker-ws-api`
3. **Route selection expression:** `$request.body.action`
4. Add predefined routes: `$connect`, `$disconnect`, `$default`.
5. Attach the **`api-handler`** Lambda integration to **all three routes**. *(The handler inspects `requestContext.eventType` to insert/delete connection IDs from the RDS `ws_connections` table.)*
6. Deploy to a stage named **`production`**.
7. Note both the **WebSocket URL** (`wss://...`) and the **Connection URL** (`https://...`).

> ⚠️ **ACTION ITEM:** Go to both `price-fetcher` and `api-handler` Lambda **Environment Variables** and add:
> `WS_ENDPOINT` = *(paste the Connection URL from the WebSocket API)*

> 💡 **Developer note:** Ensure your `api-handler` returns `{"statusCode": 200}` for `$connect` events. API Gateway will reject all WebSocket connections with a 403 if the integration response is missing or malformed.

---

## Phase 6: Frontend Deployment & CloudFront OAC

> 🛑 **STOP — do not run `npm run build` yet.**
>
> Open `frontend/.env.production` and set:
> ```
> VITE_API_URL=<HTTP API Invoke URL from Phase 5>
> VITE_WS_URL=<WebSocket URL from Phase 5>
> ```
> If you build before doing this, the API URLs will be baked in as empty strings and the frontend will be permanently disconnected from the backend. You would need to rebuild and re-upload.

### 1. Build and Upload Frontend

```bash
cd frontend
npm install
npm run build
```

Go to **S3** > `pricetracker-web-[account-id]` > **Upload** → upload all contents of the `dist/` folder.

### 2. Create CloudFront Distribution

1. Go to **CloudFront** > **Create Distribution**.
2. **Origin domain:** Select `pricetracker-web-[account-id]` from the S3 dropdown.
3. **Origin access:** Select **Origin access control settings (recommended)**. Click **Create control setting** and accept defaults.
4. **Viewer protocol policy:** `Redirect HTTP to HTTPS`
5. **Default root object:** `index.html`
6. Click **Create distribution**.
7. A yellow banner will appear — click **Copy policy**, then navigate to your S3 web bucket > **Permissions** > **Bucket policy** > **Edit**, paste the policy, and save. This locks the bucket so only CloudFront can read it.

### 3. Fix SPA Deep-Link Routing

Without this step, refreshing the browser on any route other than `/` (e.g. `/predict`) will return a CloudFront 403 error instead of the React app.

While the distribution is deploying, go to the **Error pages** tab and click **Create custom error response**:

| Field | Value |
|---|---|
| HTTP error code | `403: Forbidden` |
| Customize error response | Yes |
| Response page path | `/index.html` |
| HTTP response code | `200: OK` |

Save changes.

> ⏳ **CloudFront propagation:** The distribution will show status **Deploying** for 10–20 minutes. During this time the URL will return errors. Wait until the status changes to **Enabled** before testing.

---

## Phase 7: Automation (EventBridge)

Go to **Amazon EventBridge** > **Rules** > **Create rule**.

**Rule 1 — Price fetcher:**
- **Name:** `trigger-price-fetch`
- **Rule type:** Schedule
- **Schedule:** Rate-based → every **5 minutes**
- **Target:** Lambda function → `price-fetcher`
- Click through to **Create**.

**Rule 2 — Model trainer:**
- **Name:** `trigger-model-train`
- **Rule type:** Schedule
- **Schedule:** Cron-based → `0 2 ? * SUN *` *(Sundays at 02:00 UTC)*
- **Target:** Lambda function → `model-trainer`
- Click through to **Create**.

> 💡 **Validation:** The AWS console wizard auto-adds the `lambda:InvokeFunction` resource-based policy during rule creation. If a Lambda does not trigger on schedule, verify the policy under Lambda > **Configuration** > **Permissions** > **Resource-based policy statements**.

---

## Phase 8: Complete Teardown Sequence

> ⚠️ This architecture costs approximately **$110/month** (~$3.67/day). For a 7–10 day project, expect a total spend of **$26–37** against your $100 credit. Execute this sequence promptly after grading — every additional day costs roughly $3.67. Follow the order exactly — deleting resources out of sequence causes dependency errors.

1. **EventBridge:** Delete `trigger-price-fetch` and `trigger-model-train` rules.

2. **API Gateway:** Delete both the HTTP API (`pricetracker-http-api`) and the WebSocket API (`pricetracker-ws-api`).

3. **CloudFront:** Select the distribution → click **Disable**. Wait for status to return to **Disabled** (~5 minutes), then click **Delete**.

4. **S3 Buckets** — handle each bucket differently:

   *Web bucket (`pricetracker-web-[account-id]`):*
   - Go to **Permissions** > **Bucket policy** → **Delete** the policy. *(Required first — the OAC policy scopes access to CloudFront only; leaving it prevents the Empty operation from succeeding.)*
   - Click **Empty** the bucket.
   - Click **Delete** the bucket.

   *Models bucket (`pricetracker-models-[account-id]`):*
   - The models bucket has no bucket policy — skip directly to **Empty**.
   - Click **Delete** the bucket.

5. **Lambdas:** Delete all 4 Lambda functions: `price-fetcher`, `model-trainer`, `model-invoker`, `api-handler`.

6. **CloudWatch Logs:** Go to **CloudWatch** > **Log groups** and delete the 4 groups matching `/aws/lambda/pricetracker-*`.

7. **IAM Role:** Go to **IAM** > **Roles**, select `pricetracker-lambda-role`, and delete it.

8. **RDS:**
   - Select `pricetracker-db` → **Modify** → uncheck **Enable deletion protection** → **Apply immediately**.
   - Once modified, select the database → **Actions** > **Delete** → choose **Delete without creating a final snapshot**.

9. **RDS Subnet Group:** Go to **RDS** > **Subnet groups**, select `pricetracker-sng`, and delete it. *(This is an RDS-level resource and is not removed automatically when the VPC is deleted.)*

10. **Secrets Manager:** Select both `pricetracker-db-creds` and `pricetracker-metals-api-key` → **Delete**. When prompted, select **Force delete without recovery window**. *(Without this, the 7-day recovery window blocks reuse of the same secret names if you redeploy.)*

11. **VPC Network** *(delete in this exact order — the VPC cannot be deleted while NAT Gateways exist):*
    - Go to **NAT Gateways** → select **both NAT Gateways** → **Actions** > **Delete NAT gateway**. *(Both must be deleted before releasing the Elastic IPs.)*
    - Wait for both NAT Gateways to reach **Deleted** status (~1 minute).
    - Go to **Elastic IPs** → select **both Elastic IPs** that were associated with the NAT Gateways → **Actions** > **Release Elastic IP addresses**.
    - Go to **Route Tables** → select `price-tracker-private-rtb-2` (the one you created manually in Phase 1) → **Delete**. *(The VPC deletion wizard cannot remove route tables that have explicit subnet associations still attached; disassociate Private Subnet 2 first if the delete is blocked.)*
    - Go to **VPCs** → select `price-tracker-vpc` → **Delete VPC**. This automatically removes the remaining subnets, route tables, the Internet Gateway association, and security groups.

---

## Architecture Reference

```
Internet
  │
  ├─── Browser ──HTTPS──► CloudFront ──OAC──► S3: pricetracker-web (React SPA)
  │                │
  │                ├──────────────────────────► HTTP API Gateway
  │                │                                   │
  │                └──wss://──────────────────► WebSocket API Gateway
  │                                                     │
  └─── Tiingo API ◄── outbound (NAT GW-1 or NAT GW-2) ─┤
                                                        │
                   ┌────────────────────────────────────┤
                   │        VPC 10.0.0.0/16             │
                   │                                    │
                   │  Public Subnet 1 (AZ-a)            │
                   │  └── NAT Gateway 1 ── Elastic IP 1 │
                   │                                    │
                   │  Public Subnet 2 (AZ-b)            │
                   │  └── NAT Gateway 2 ── Elastic IP 2 │
                   │                                    │
                   │  Private Subnet 1 (AZ-a)           │
                   │  Private RTB 1 → NAT GW 1          │
                   │  └── Lambdas (price-fetcher,       │
                   │         model-trainer,             │
                   │         model-invoker,             │
                   │         api-handler)    ◄──────────┤ EventBridge
                   │                                    │
                   │  Private Subnet 2 (AZ-b)           │
                   │  Private RTB 2 → NAT GW 2          │
                   │  └── Lambdas (same 4 functions)    │
                   │                                    │
                   │  ┌─────────────────────────────┐   │
                   │  │ RDS PostgreSQL 15.4 (Multi-AZ)│  │
                   │  │ primary (AZ-a) ↔ standby (AZ-b)│ │
                   │  └─────────────────────────────┘   │
                   │                                    │
                   │  S3: pricetracker-models           │
                   │  Secrets Manager (DB creds, API key)│
                   └────────────────────────────────────┘
```

---

*Guide version: 2NAT — full outbound redundancy variant. Based on the finalized single-NAT guide (`DEPLOYMENT_GUIDE.md`) with Phase 1 networking expanded for per-AZ NAT Gateway provisioning and route table separation, updated cost estimates, and an extended teardown sequence covering both NAT Gateways and the manually created route table.*
