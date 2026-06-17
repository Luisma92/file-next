# file-next

> File-system abstraction over AWS S3 / Cloudflare R2 for Next.js, with shadcn/ui components and a SQLite/Postgres metadata index.

`file-next` gives Next.js apps a single, batteries-included API for file management:

- **Storage adapter** — drop-in S3 / R2 client built on AWS SDK v3.
- **Metadata index** — bring your own DB (Postgres / SQLite / in-memory); queries stay fast.
- **UI components** — copy-paste-ready shadcn/ui items for upload, list, delete, breadcrumb, preview.
- **Headless hooks** — five React hooks (`useFileBrowser`, `useUploader`, `useFileActions`, `useFileUrl`, `useDownloadProgress`) for custom UIs.
- **Type-safe** — strict TypeScript; errors as `Result<T, FileSystemError>`.

## Quick start

```bash
# 1. Install
pnpm add file-next @file-next/headless

# 2. Set env (see docs/provider-setup.md for full config)
export FILE_NEXT_PROVIDER=s3
export FILE_NEXT_BUCKET=my-app-uploads
export FILE_NEXT_REGION=us-east-1
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...

# 3. Wire it up in Next.js (server action)
"use server";
import { createServerActions } from "file-next/server";
const actions = createServerActions({ store, writeThrough });
export const listFiles = actions.listFiles;

# 4. Add the registry components
npx shadcn@^2.1.0 add @file-next/file-browser
npx shadcn@^2.1.0 add @file-next/file-uploader
```

That's it — you have a file browser, uploader, and server actions in 5 minutes.

## What's in this repo

| Path | Purpose |
|---|---|
| `packages/core/` | Storage adapter, metadata store interfaces, server actions, route handlers |
| `packages/headless/` | 5 React hooks (state machines, dependency-injected) |
| `packages/cli/` | `@file-next/cli` — `migrate`, `reconcile`, `doctor` commands |
| `registry/` | 7 shadcn registry items (`file-browser`, `file-uploader`, ...) |
| `docs/` | `architecture.md`, `security.md`, `provider-setup.md` |
| `app/` | Demo / docs Next.js app |
| `.github/workflows/ci.yml` | CI (lint, typecheck, test, build, secret-guard, registry smoke) |

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the demo app (Next.js) |
| `pnpm build` | Build all workspace packages + the demo app |
| `pnpm test` | Run tests in watch mode (Vitest) |
| `pnpm test:run` | Run tests once |
| `pnpm typecheck` | Type-check the whole project |
| `pnpm --filter "@file-next/cli" build` | Build just the CLI |

## Next steps

- **First time?** Read [`docs/provider-setup.md`](./docs/provider-setup.md) to configure AWS or Cloudflare.
- **Building a UI?** Browse [`registry/`](./registry/) and install what you need via `shadcn add`.
- **Curious how it works?** Read [`docs/architecture.md`](./docs/architecture.md).
- **Production safety?** Read [`docs/security.md`](./docs/security.md).

## License

MIT
