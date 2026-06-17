# Architecture

> How file-next stores files in S3/R2 while keeping a fast, queryable index in your own database.

## Quick path

1. The browser asks Next.js for a file list.
2. Next.js asks the **metadata store** (your database) for the tree — fast, queryable.
3. When a file is read, Next.js fetches the bytes from **S3 or R2** using a presigned URL.
4. Writes go through a **write-through sync** that keeps both sides consistent.

```
Browser ──► Next.js (your code)
              │
              ├──► Metadata store (your DB: Postgres / SQLite)
              │     - file tree, names, owner, size, mime, user meta
              │     - fast queries, search, folder walks
              │     - tenant isolation via Postgres RLS or app-level checks
              │
              └──► Object storage (S3 / R2)
                    - the actual file bytes
                    - accessed via presigned URLs (browser ↔ S3 direct)
```

## Core concepts

| Concept | What it is | Why it matters |
|---|---|---|
| `FileSystemAdapter` | Storage abstraction over S3/R2 | Swap providers without touching your code. |
| `MetadataStore` | Database interface for the file tree | Your DB is the source of truth for queries; S3 is the source of truth for bytes. |
| `FileSystemError` | The single error class | 11 codes (`NotFound`, `Conflict`, `NetworkError`, ...). Always instanceof `FileSystemError`. |
| `Result<T, E>` | Discriminated union return type | No exceptions on the happy path. Force callers to handle `error`. |
| `forTenant(id)` | Chainable tenant scope | `forTenant('acme').bucket('acme-r2').prefix('users/').fs()` — structural isolation. |
| `withAuth(resolve, handler)` | Auth HOF for server actions / route handlers | Resolves the request context; short-circuits to 401 if `null`. |

## Write-through sync

Every write to S3 is followed by a metadata insert. If the metadata insert fails:

1. We append the orphan key to `pending_orphan_log` (durable compensation).
2. We attempt a best-effort `adapter.delete(key)` to clean up S3.
3. The next `reconcile` run drains the orphan log.

The metadata is always recoverable: `pnpm dlx file-next reconcile --tenant=acme --dry-run` finds drift, `--tenant=acme` (no flag) fixes it.

## Tenant isolation

Three layers, in order:

1. **Bucket prefix** — `forTenant('acme').bucket('acme-r2')` writes to a dedicated bucket.
2. **POSIX prefix** — `forTenant('acme').prefix('acme/')` writes to a sub-tree in a shared bucket.
3. **Database row-level security** (Postgres only) — `SET LOCAL app.current_tenant = 'acme'` + `FORCE ROW LEVEL SECURITY` filters every query.

For most apps, layer 2 + 3 is enough. Layer 1 is for regulated workloads with strict blast-radius requirements.

## v0.2 direction

- Per-command AWS SDK packages (smaller tree-shake).
- Server-side multipart for objects > 5 GB (v0.1 caps at single-PUT 5 GB).
- Persistent orphan log table — v0.1 keeps it in memory per process.

## Next step

- New to file-next? Read [`provider-setup.md`](./provider-setup.md) next.
- Curious about safety boundaries? Read [`security.md`](./security.md).
