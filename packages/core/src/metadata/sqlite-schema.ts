/**
 * Drizzle SQLite schema for the `file_nodes` table.
 *
 * The single table is the canonical store for the file tree.
 * - `parentId` is self-referential (null for the root).
 * - `path` is the materialized POSIX path (denormalized for
 *   fast lookups; updated on every `moveNode`).
 * - `kind` is "file" or "folder" (SQLite has no native enum,
 *   so we use a text column with a CHECK constraint).
 * - `metadata` is JSON-serialized text; queries don't read it
 *   (the search index is a future optimization — v0.1 reads the
 *   whole row and parses the JSON lazily).
 * - `deletedAt` is the soft-delete tombstone.
 *
 * Indexes:
 * - (tenantId, parentId) for O(log n) child listings
 * - (tenantId, deletedAt) for the live-only filter that every
 *   read goes through
 * - (tenantId, name) for the uniqueness check on createNode
 *
 * v0.1 keeps the schema here (not in a separate migrations
 * folder) and creates it on first connect. v0.2 will move to
 * drizzle-kit migrations via the @file-next/cli.
 */
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const fileNodes = sqliteTable(
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
    /** JSON-serialized Record<string, string>. */
    metadata: text("metadata").notNull().default("{}"),
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
    uniqueName: uniqueIndex("file_nodes_unique_name").on(t.tenantId, t.parentId, t.name),
  }),
);

/** Inline DDL — applied on first connect. v0.2 moves to migrations. */
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
    metadata TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS file_nodes_by_parent ON file_nodes (tenant_id, parent_id);
  CREATE INDEX IF NOT EXISTS file_nodes_by_tenant_live ON file_nodes (tenant_id, deleted_at);
  CREATE UNIQUE INDEX IF NOT EXISTS file_nodes_unique_name ON file_nodes (tenant_id, parent_id, name);
`;
