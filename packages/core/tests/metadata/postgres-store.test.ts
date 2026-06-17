/**
 * Tests for the Postgres-backed MetadataStore.
 *
 * Two test surfaces, both env-gated on POSTGRES_URL:
 *   1. The shared contract suite (`./contract.ts`) — runs every
 *      test against the Postgres adapter, parameterized over a
 *      real pg.Pool. Skips when POSTGRES_URL is unset.
 *   2. A dedicated RLS isolation test that proves the
 *      structural tenant isolation works at the DB level:
 *      even if the adapter forgets a WHERE clause, a
 *      cross-tenant SELECT returns 0 rows.
 *
 * Local dev setup (Postgres via Docker):
 *
 *   docker run -d --name file-next-pg -p 5432:5432 \
 *     -e POSTGRES_USER=test \
 *     -e POSTGRES_PASSWORD=test12345 \
 *     -e POSTGRES_DB=file_next \
 *     postgres:16
 *
 *   export POSTGRES_URL=postgres://test:test12345@localhost:5432/file_next
 *
 *   pnpm test:integration
 *
 * For CI: a service container with the same env. No testcontainers
 * dep in v0.1.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";
import { createPostgresStore } from "@/metadata/postgres-store";
import { asTenantId, asUserId } from "@/types/branded";
import { runMetadataStoreContract } from "./contract";

const POSTGRES_URL = process.env.POSTGRES_URL;
const skipReason = !POSTGRES_URL
  ? "POSTGRES_URL not set — skipping. See header for local dev setup with Postgres."
  : null;

// Skip the whole file's contract test when POSTGRES_URL is unset.
// We use describe.skipIf via the contract's name prefix so the
// skip shows up clearly in the test output.
if (skipReason === null && POSTGRES_URL) {
  const pool = new Pool({ connectionString: POSTGRES_URL });
  runMetadataStoreContract("postgres", () => createPostgresStore(pool));
}

// RLS isolation test: proves the DB-level structural isolation
// actually works. Sets up two tenants, writes from each,
// then opens a connection with NO `app.current_tenant` GUC
// and tries to SELECT — must return 0 rows. This is the
// "forgot a WHERE clause" defense-in-depth check.
describe.skipIf(skipReason !== null)("postgres: RLS structural isolation", () => {
  let rawPool: Pool;
  const TENANT_A = asTenantId("rls-tenant-a");
  const TENANT_B = asTenantId("rls-tenant-b");
  const USER = asUserId("rls-user");

  beforeAll(() => {
    if (!POSTGRES_URL) return;
    rawPool = new Pool({ connectionString: POSTGRES_URL });
  });

  afterAll(async () => {
    if (rawPool) await rawPool.end();
  });

  it("without `app.current_tenant`, a SELECT returns 0 rows for both tenants", async () => {
    if (!POSTGRES_URL) return;
    const store = createPostgresStore(new Pool({ connectionString: POSTGRES_URL }));

    // Seed: one node per tenant
    await store.createNode({
      tenantId: TENANT_A,
      parentId: null,
      name: "a.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "a.txt",
      ownerId: USER,
    });
    await store.createNode({
      tenantId: TENANT_B,
      parentId: null,
      name: "b.txt",
      kind: "file",
      size: 1,
      mimeType: "text/plain",
      s3Key: "b.txt",
      ownerId: USER,
    });

    // Open a connection WITHOUT SET LOCAL and SELECT.
    const c = await rawPool.connect();
    try {
      const result = await c.query("SELECT id, tenant_id FROM file_nodes");
      // The RLS policy requires app.current_tenant to be set.
      // Without it, the policy's `current_setting('app.current_tenant', true)`
      // returns NULL (the `true` arg = missing_ok), and the
      // comparison `tenant_id = NULL` is always false → 0 rows.
      expect(result.rows).toHaveLength(0);
    } finally {
      c.release();
    }
  });

  it("with `app.current_tenant = A`, a SELECT returns ONLY tenant A's rows", async () => {
    if (!POSTGRES_URL) return;
    const c = await rawPool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SET LOCAL app.current_tenant = $1", [TENANT_A]);
      const result = await c.query("SELECT tenant_id, name FROM file_nodes ORDER BY name");
      // The seeded row for A (a.txt) shows up; the seeded row for
      // B (b.txt) does not. The contract test will have added
      // more rows, so we just check the B row is NOT in the set.
      const rows = result.rows as Array<{ tenant_id: string; name: string }>;
      const hasB = rows.some((r) => r.tenant_id === TENANT_B);
      expect(hasB).toBe(false);
      // The A row is there.
      const aRow = rows.find((r) => r.tenant_id === TENANT_A);
      expect(aRow).toBeDefined();
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  });
});
