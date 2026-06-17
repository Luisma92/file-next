# Security

> What file-next enforces and what your application is responsible for.

## Quick path

1. Read the **three boundaries** below — every file flow crosses all three.
2. Verify your storage provider's IAM policy against the **minimum scope** checklist.
3. Confirm your app enforces auth at the **withAuth** boundary (server actions + route handlers).

## The three boundaries

| Boundary | Enforced by | What you must do |
|---|---|---|
| **Server ↔ storage** | AWS SigV4 (S3) or Cloudflare token (R2) | Provide credentials via env; use least-privilege IAM. |
| **Server ↔ database** | TLS for the connection | Provide connection string; rotate credentials. |
| **Browser ↔ server** | Next.js + your auth (Clerk, Auth.js, etc.) | Wrap server actions / route handlers in `withAuth`. |

## Minimum IAM scope (S3)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Actions": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:CopyObject",
        "s3:HeadObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket",
        "arn:aws:s3:::your-bucket/*"
      ]
    }
  ]
}
```

For multi-tenant setups, scope by prefix:

```json
"Resource": [
  "arn:aws:s3:::your-bucket",
  "arn:aws:s3:::your-bucket/tenant-${caller-principal-tag}/"
]
```

## What file-next does NOT do

| Concern | Why it's your responsibility |
|---|---|
| **Auth** | file-next has no opinion on who the user is. Wrap every server action and route handler in `withAuth(yourResolver, handler)`. |
| **Encryption at rest** | Use a bucket-level policy (S3 SSE-S3 or SSE-KMS). file-next writes whatever you configure. |
| **Audit log** | file-next doesn't log access. Subscribe to S3 server-access logs or CloudTrail if needed. |
| **DDoS / rate limit** | Use CloudFront or your CDN of choice. file-next's headless hooks are thin enough to rate-limit per IP. |
| **File content scanning** | v0.1 doesn't scan uploads. Add a Lambda / Cloudflare Worker triggered on `s3:ObjectCreated:*` if you need AV / malware detection. |

## CORS for browser-direct uploads

If you use the upload route handler with a presigned URL, the browser POSTs directly to S3. Configure your bucket CORS:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["PUT"],
    "AllowedOrigins": ["https://your-app.example.com"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }
]
```

Without this, browser-direct uploads fail with a CORS error.

## Checklist

- [ ] S3 bucket has SSE-KMS enabled (or SSE-S3 at minimum).
- [ ] IAM policy uses the least-privilege scope above.
- [ ] CORS allows PUT only from your app's origin.
- [ ] Every server action is wrapped in `withAuth` (or your equivalent).
- [ ] Every route handler is wrapped in `withAuth`.
- [ ] Database connection uses TLS (`?sslmode=require` in Postgres).
- [ ] `FILE_NEXT_BUCKET`, `FILE_NEXT_REGION`, and credential env vars are NOT in the client bundle (check via `pnpm build` + grep).

## Next step

- Need to set up AWS or Cloudflare? Read [`provider-setup.md`](./provider-setup.md).
- Want the architectural overview? Read [`architecture.md`](./architecture.md).
