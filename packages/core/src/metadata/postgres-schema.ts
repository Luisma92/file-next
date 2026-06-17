/**
 * Drizzle Postgres schema for the `file_nodes` table.
 *
 * Same shape as the SQLite schema (PR 4b) but typed for Postgres.
 * The DDL adds:
 *   - `JSONB` for metadata (queryable, indexable in v0.2)
 *   - Row-Level Security (FORCE ROW LEVEL SECURITY) so cross-
 *     tenant SELECTs return 0 rows at the DB level (defense in
 *     depth; the adapter ALSO filters by tenantId in app code)
 *   - The `app.current_tenant` GUC that the adapter sets per
 *     transaction via `SET LOCAL`
 *
 * The RLS policy:
 *   - USING clause: tenant_id = current_setting('app.current_tenant')
 *   - WITH CHECK clause: same (enforces on INSERT/UPDATE too)
 *   - FORCE: even the table owner is subject to the policy
 *
 * Why this matters: a single Postgres instance can host many
 * file-next consumers. Without RLS, a bug in the adapter (forgot
 * a WHERE clause) would leak data. With FORCE RLS, the worst
 * case is "current_tenant is unset" → 0 rows returned.
 */
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const fileNodes = pgTable(
  "file_nodes",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    parentId: text("parent_id"),
    name: text("name").notNull(),
    path: text("path").notNull(),
    /** "file" or "folder". */
    kind: text("kind", { enum: ["file", "folder"] }).notNull(),
    size: integer("size").notNull().default(0),
    mimeType: text("mime_type").notNull().default(""),
    s3Key: text("s3_key").notNull().default(""),
    ownerId: text("owner_id").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    /** Unix ms. */
    createdAt: integer("created_at").notNull(),
    /** Unix ms. */
    updatedAt: integer("updated_at").notNull(),
    /** Unix ms, null = live. */
    deletedAt: integer("deleted_at"),
  },
  (t) => ({
    byParent: index("file_nodes_by_parent").on(t.tenantId, t.parentId),
    byTenantLive: index("file_nodes_by_tenant_live").on(t.tenantId, t.deletedAt),
    uniqueName: uniqueIndex("file_nodes_unique_name").on(
      t.tenantId,
      t.parentId,
      t.name,
    ),
  }),
);

/**
 * Inline DDL — applied on first connect.
 *
 * Includes:
 *   - The table + indexes (matching the Drizzle schema)
 *   - `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
 *   - `ALTER TABLE ... FORCE ROW LEVEL SECURITY` (so the table
 *     owner is also subject to the policy — without FORCE, a
 *     superuser/owner bypasses RLS by default)
 *   - The policy itself: tenant_id must equal the per-tx
 *     `app.current_tenant` GUC
 *
 * v0.2 moves this to a proper drizzle-kit migration; v0.1 keeps
 * it inline so the SQLite/Postgres adapters have the same
 * "first connect creates the schema" experience.
 */
export const FILE_NODES_DDL = sql`
  CREATE TABLE IF NOT EXISTS file_nodes (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('file', 'folder')),
    size INTEGER NOT NULL DEFAULT 0,
    mime_type TEXT NOT NULL DEFAULT '',
    s3_key TEXT NOT NULL DEFAULT '',
    owner_id TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS file_nodes_by_parent ON file_nodes (tenant_id, parent_id);
  CREATE INDEX IF NOT EXISTS file_nodes_by_tenant_live ON file_nodes (tenant_id, deleted_at);
  CREATE UNIQUE INDEX IF NOT EXISTS file_nodes_unique_name ON file_nodes (tenant_id, parent_id, name);
  ALTER TABLE file_nodes ENABLE ROW LEVEL SECURITY;
  ALTER TABLE file_nodes FORCE ROW LEVEL SECURITY;
  DROP POLICY IF EXISTS file_nodes_tenant_isolation ON file_nodes;
  CREATE POLICY file_nodes_tenant_isolation ON file_nodes
    USING (tenant_id = current_setting('app.current_tenant', true))
    WITH CHECK (tenant_id = current_setting('app.current_tenant', true));
`;
