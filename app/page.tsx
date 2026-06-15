export default function HomePage() {
  return (
    <main className="container flex min-h-screen flex-col items-center justify-center gap-6 py-12">
      <h1 className="text-4xl font-bold tracking-tight">file-next</h1>
      <p className="max-w-prose text-center text-muted-foreground">
        File-system abstraction over AWS S3 / Cloudflare R2 for Next.js,
        with ready-to-use shadcn/ui components.
      </p>
      <p className="text-sm text-muted-foreground">
        Demo app — components and storage adapters land in the next phase.
      </p>
    </main>
  );
}
