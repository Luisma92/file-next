/**
 * Demo app's `file-next` library wiring — in-memory adapter + in-memory
 * metadata store + server actions, all wired at module load.
 *
 * This is a single-process, ephemeral setup: nothing survives a
 * server restart. For a real deployment, swap `createMemoryAdapter`
 * for `createS3Adapter` (with a real `FileSystemConfig`) and
 * `createMemoryStore` for `createPostgresStore` / `createSqliteStore`.
 *
 * The pattern is identical — the rest of the application code
 * (server actions, route handlers, headless hooks) doesn't change.
 */
import {
  createMemoryAdapter,
  createMemoryStore,
  asTenantId,
  asUserId,
  type FileSystem,
  type FileSystemConfig,
  type MetadataStore,
  type S3CompatibleAdapter,
} from "file-next";
import { createServerActions } from "file-next/server";
import { createWriteThrough } from "file-next/sync";

/**
 * Build a minimal `FileSystem` for the in-memory demo without going
 * through `createFileSystem` (which validates an S3 / R2 config
 * that doesn't apply here).
 */
function makeInMemoryFileSystem(
  adapter: S3CompatibleAdapter,
  metadata: MetadataStore,
): FileSystem {
  // The config here is a SHAM. The in-memory adapter doesn't read
  // it; only writeThrough uses `config.bucket`. We provide a
  // minimal shape that satisfies the type without claiming any
  // real provider.
  const shamConfig: FileSystemConfig = {
    provider: "s3",
    bucket: "in-memory",
    region: "us-east-1",
    credentials: {
      accessKeyId: "in-memory",
      secretAccessKey: "in-memory",
    },
    forcePathStyle: false,
  };
  return {
    adapter,
    config: shamConfig,
    metadata,
    forTenant: () => makeInMemoryFileSystem(adapter, metadata),
  };
}

// ---------------------------------------------------------------------------
// Singletons (lazy, per-process)
// ---------------------------------------------------------------------------

let _adapter: S3CompatibleAdapter | null = null;
let _store: MetadataStore | null = null;
let _fs: FileSystem | null = null;
let _actions: ReturnType<typeof createServerActions> | null = null;
let _writeThrough: ReturnType<typeof createWriteThrough> | null = null;

export function getAdapter(): S3CompatibleAdapter {
  if (!_adapter) _adapter = createMemoryAdapter();
  return _adapter;
}

export function getStore(): MetadataStore {
  if (!_store) _store = createMemoryStore();
  return _store;
}

function getFileSystemInstance(): FileSystem {
  if (!_fs) _fs = makeInMemoryFileSystem(getAdapter(), getStore());
  return _fs;
}

function getWriteThroughInstance(): ReturnType<typeof createWriteThrough> {
  if (!_writeThrough) _writeThrough = createWriteThrough(getFileSystemInstance(), getStore());
  return _writeThrough;
}

export function getActions(): ReturnType<typeof createServerActions> {
  if (!_actions) {
    _actions = createServerActions({
      store: getStore(),
      writeThrough: getWriteThroughInstance(),
    });
  }
  return _actions;
}

/**
 * Reset all singletons. Used by tests; consumers should not call
 * this in production code.
 */
export function _resetForTests(): void {
  _adapter = null;
  _store = null;
  _fs = null;
  _actions = null;
  _writeThrough = null;
}

/**
 * The default tenant + user for the demo. In a real app these come
 * from the auth layer (e.g. the session, or withAuth's resolver).
 */
export const DEMO_TENANT = asTenantId("acme");
export const DEMO_USER = asUserId("user-1");
