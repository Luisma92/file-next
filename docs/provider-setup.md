# Provider setup

> Minimal IAM + env configuration for AWS S3 and Cloudflare R2.

## Quick path

1. Pick a provider (S3 or R2) and follow the matching section.
2. Set the env vars listed in the **Required env** table.
3. Run `pnpm dlx file-next doctor` to verify.

## AWS S3

### Required env

| Var | Example | Notes |
|---|---|---|
| `FILE_NEXT_PROVIDER` | `s3` | |
| `FILE_NEXT_BUCKET` | `my-app-uploads` | Must exist; file-next does NOT create it. |
| `FILE_NEXT_REGION` | `us-east-1` | |
| `AWS_ACCESS_KEY_ID` | `AKIA...` | From an IAM user with the policy in `security.md`. |
| `AWS_SECRET_ACCESS_KEY` | `wJalr...` | Never commit. Use a secret manager. |
| `FILE_NEXT_ADAPTER` | `postgres` or `sqlite` | Which metadata backend. |

### Create the bucket + IAM

```bash
# 1. Create the bucket (only if it doesn't exist)
aws s3api create-bucket \
  --bucket my-app-uploads \
  --region us-east-1

# 2. Enable versioning (recommended; survives accidental deletes)
aws s3api put-bucket-versioning \
  --bucket my-app-uploads \
  --versioning-configuration Status=Enabled

# 3. Enable default encryption
aws s3api put-bucket-encryption \
  --bucket my-app-uploads \
  --server-side-encryption-configuration '{
    "Rules": [{"ApplyServerSideEncryptionByDefault": {"SSEAlgorithm": "AES256"}}]
  }'

# 4. Block public access (file-next uses presigned URLs, not public buckets)
aws s3api put-public-access-block \
  --bucket my-app-uploads \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# 5. Create an IAM user with the policy from security.md (snippet)
aws iam create-user --user-name file-next-app
aws iam put-user-policy --user-name file-next-app \
  --policy-name file-next-bucket-access \
  --policy-document file://./policy.json
```

### CORS

Apply the CORS snippet from `security.md`:

```bash
aws s3api put-bucket-cors --bucket my-app-uploads \
  --cors-configuration file://./cors.json
```

## Cloudflare R2

R2 is S3-compatible. Same SDK, different endpoint.

### Required env

| Var | Example | Notes |
|---|---|---|
| `FILE_NEXT_PROVIDER` | `r2` | Triggers `forcePathStyle: true` in the adapter. |
| `FILE_NEXT_BUCKET` | `my-app-uploads` | R2 bucket name. |
| `FILE_NEXT_REGION` | `auto` | R2 always uses `auto`. |
| `FILE_NEXT_ENDPOINT` | `https://<accountid>.r2.cloudflarestorage.com` | From the R2 dashboard. |
| `AWS_ACCESS_KEY_ID` | R2 access key | From R2 → Manage R2 API Tokens. |
| `AWS_SECRET_ACCESS_KEY` | R2 secret key | Same. |

### Create the bucket + token

1. Cloudflare dashboard → R2 → Create bucket → name it → choose a location.
2. R2 → Manage R2 API Tokens → Create API token:
   - Permissions: **Object Read & Write**
   - Specify bucket: your bucket only
   - TTL: as short as your security policy allows
3. Copy the **Access Key ID** + **Secret Access Key** + **Endpoint** into your env.

### Custom domain (optional)

R2 lets you bind a custom domain (`files.your-app.com`). Once bound, set:

```
FILE_NEXT_PUBLIC_URL=https://files.your-app.com
```

The `getPublicUrl` method will return `https://files.your-app.com/<key>` instead of the R2 endpoint.

## Postgres for metadata

### Required env

| Var | Example |
|---|---|
| `FILE_NEXT_PG_HOST` | `db.example.com` |
| `FILE_NEXT_PG_PORT` | `5432` (default) |
| `FILE_NEXT_PG_USER` | `file_next_app` |
| `FILE_NEXT_PG_DATABASE` | `file_next` |
| `FILE_NEXT_PG_PASSWORD` | `...` (secret) |

The connection string used internally: `postgres://user:password@host:port/database?sslmode=require`.

### Run migrations

```bash
pnpm dlx file-next migrate --adapter=postgres
```

## SQLite for metadata (single-process / small teams)

### Required env

| Var | Example |
|---|---|
| `FILE_NEXT_SQLITE_PATH` | `./data/file-next.sqlite` |

The directory must exist and be writable. The CLI creates the file on first run.

### Run migrations

```bash
pnpm dlx file-next migrate --adapter=sqlite
```

## Verify

```bash
pnpm dlx file-next doctor
```

Expected: all checks pass. Exit code 0.

If a check fails, the output names the failing env var. Fix it and re-run.

## Next step

- Set up auth at the boundary? Read [`security.md`](./security.md).
- Want the architectural overview? Read [`architecture.md`](./architecture.md).
