/**
 * Vitest stub for `file-next` (the core package's published name).
 *
 * The registry components import types and helpers (FileNode,
 * asTenantId, asUserId, FileSystemError) from `file-next`. At test
 * time, we don't want to pull in the full core package source
 * (which uses `@/*` internal aliases that conflict with the
 * registry's own paths). Instead, this stub re-exports just
 * what the registry tests need, with the right types.
 *
 * The runtime behavior of `asTenantId` / `asUserId` is just
 * casting — they're branded string types with no runtime cost.
 */
export type FileNode = {
  id: string;
  tenantId: ReturnType<typeof asTenantId>;
  parentId: string | null;
  path: string;
  kind: "file" | "folder";
  size: number;
  mimeType: string;
  s3Key: string;
  ownerId: ReturnType<typeof asUserId>;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  name: string;
};

export type TenantId = string & { readonly __brand: "TenantId" };
export type UserId = string & { readonly __brand: "UserId" };

export const asTenantId = (s: string): TenantId => s as TenantId;
export const asUserId = (s: string): UserId => s as UserId;
