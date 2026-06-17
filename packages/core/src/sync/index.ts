/**
 * Sync layer public entry point.
 *
 * Re-exports the write-through pattern (S3 + MetadataStore in
 * lockstep) and the pending-orphan log types. v0.1 ships the
 * in-memory log + no-op reconcile; v0.2 adds persistent orphans
 * and the actual S3-walk reconciliation.
 */
export {
  createWriteThrough,
} from "./write-through";
export type {
  PendingOrphan,
  OrphanOp,
  WriteThroughFileInput,
  DeleteThroughFileInput,
  ReconcileReport,
} from "./write-through";
