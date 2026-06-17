/**
 * Metadata store public entry point.
 *
 * The hexagonal boundary between the core library (which programs
 * against the `MetadataStore` interface) and the concrete adapters
 * (memory, SQLite, Postgres). Re-exports the interface + the
 * shipped adapters so consumers get a single import path.
 */
export type {
  CreateNodeInput,
  DeleteNodeInput,
  FileNode,
  GetNodeInput,
  GetPathInput,
  GetPathOutput,
  ListChildrenInput,
  ListChildrenOutput,
  MetadataStore,
  MoveNodeInput,
  NodeKind,
  ReconcileResult,
  SearchInput,
  UpdateMetadataInput,
} from "./store";
export { createMemoryStore } from "./memory-store";
export { createSqliteStore } from "./sqlite-store";
export { createPostgresStore } from "./postgres-store";
