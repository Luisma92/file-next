/**
 * `AuthContext` — the minimum shape every auth resolver must
 * produce. The rest of the library (and downstream code) can
 * assume these three fields exist; consumers can extend with
 * their own fields via TypeScript generics.
 */
export interface AuthContext {
  /** Opaque user identifier. */
  readonly userId: string;
  /**
   * Tenant identifier. Used by the metadata store to scope
   * queries; carried in every server-action call so the library
   * never has to ask "which tenant is this for?".
   */
  readonly tenantId: string;
  /**
   * Role list (RBAC). Library code does NOT branch on roles —
   * the consumer's auth resolver decides which roles grant
   * access to which operations. This list is exposed so
   * downstream code can do its own checks.
   */
  readonly roles: ReadonlyArray<string>;
}
