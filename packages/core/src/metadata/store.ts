/**
 * Forward-declared placeholder for the `MetadataStore` interface.
 *
 * The real `MetadataStore` (BYODB, Postgres-backed or SQLite-backed)
 * lands in a later PR (the secondary metadata index). For T-012
 * the `FileSystem.metadata` slot is typed as `MetadataStore | undefined`
 * to mirror the design's shape without dragging in the full store
 * contract before it is built.
 */
export interface MetadataStore {
  // Intentionally empty in T-012. Methods (search, get, put, ...)
  // land in the metadata-index PR.
  readonly __placeholder: unique symbol;
}
