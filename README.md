# file-next

> File-system abstraction over AWS S3 / Cloudflare R2 for Next.js, with ready-to-use shadcn/ui components.

`file-next` gives Next.js developers a single, batteries-included API for file management in their apps:

- **Storage adapter** — drop-in S3 / R2 client built on AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`).
- **UI components** — copy-paste-ready shadcn/ui components for upload, list, and delete.
- **Type-safe** — strict TypeScript across the public surface.

## Status

This is the initial bootstrap. The library API and components are scoped for the next SDD phase.

## Layout

```
src/      # library source (storage adapter + UI components)
app/      # demo / docs Next.js app
tests/    # vitest specs
```

## Scripts

| Command         | What it does                       |
| --------------- | ---------------------------------- |
| `pnpm dev`      | Run the demo app (Next.js)         |
| `pnpm build`    | Build the demo app                 |
| `pnpm test`     | Run tests in watch mode (Vitest)   |
| `pnpm test:run` | Run tests once (Vitest)            |
| `pnpm typecheck`| Type-check the whole project       |

## License

MIT
