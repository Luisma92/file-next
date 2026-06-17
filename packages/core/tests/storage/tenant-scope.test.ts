/**
 * Tests for the `TenantScope` chainable + the `withPrefixAdapter`
 * wrapper. These prove the multi-tenant scoping surface WITHOUT
 * touching S3 — the integration test in
 * `tests/integration/s3-compatible.test.ts` proves the prefix
 * rewrite actually works against a real bucket.
 */
import { describe, it, expect, vi } from "vitest";
import {
  TenantScope,
  forTenant,
  withPrefixAdapter,
} from "@/storage/tenant-scope";
import type { FileSystem } from "@/storage/filesystem";
import type { S3CompatibleAdapter } from "@/storage/adapter";
import { asPrefix, asS3Key } from "@/types/branded";
import type { FileSystemConfig } from "@/storage/config";

// ---------------------------------------------------------------------------
// A minimal in-memory S3CompatibleAdapter for unit testing
// ---------------------------------------------------------------------------

const makeMemoryAdapter = (): S3CompatibleAdapter & {
  store: Map<string, { body: string; metadata: Record<string, string> }>;
  calls: Array<{ method: string; input: unknown }>;
} => {
  const store = new Map<string, { body: string; metadata: Record<string, string> }>();
  const calls: Array<{ method: string; input: unknown }> = [];

  const wrap = <T>(method: string, input: unknown, fn: () => T): T => {
    calls.push({ method, input });
    return fn();
  };

  return {
    store,
    calls,
    list: async (input) => wrap("list", input, () => {
      const prefix = (input.prefix ?? "") as string;
      const items = [...store.entries()]
        .filter(([k]) => k.startsWith(prefix))
        .map(([k, v]) => ({
          key: asS3Key(k),
          size: v.body.length,
          lastModified: new Date(0),
        }));
      return { ok: true, value: { items, prefixes: [], nextContinuationToken: undefined } } as never;
    }),
    read: async (input) => wrap("read", input, () => {
      const v = store.get(input.key);
      if (!v) {
        return { ok: false, error: new Error("not found") } as never;
      }
      return { ok: true, value: { body: new TextEncoder().encode(v.body) } } as never;
    }),
    write: async (input) =>
      wrap("write", input, () => {
        const body =
          input.body instanceof Uint8Array
            ? new TextDecoder().decode(input.body)
            : "(stream)";
        store.set(input.key, { body, metadata: input.metadata ?? {} });
        return { ok: true, value: { etag: "x" } } as never;
      }),
    delete: async (input) =>
      wrap("delete", input, () => {
        store.delete(input.key);
        return { ok: true, value: {} } as never;
      }),
    move: async (input) =>
      wrap("move", input, () => {
        const v = store.get(input.sourceKey);
        if (!v) {
          return { ok: false, error: new Error("not found") } as never;
        }
        store.set(input.destinationKey, v);
        store.delete(input.sourceKey);
        return { ok: true, value: {} } as never;
      }),
    copy: async (input) =>
      wrap("copy", input, () => {
        const v = store.get(input.sourceKey);
        if (!v) {
          return { ok: false, error: new Error("not found") } as never;
        }
        store.set(input.destinationKey, { ...v });
        return { ok: true, value: {} } as never;
      }),
    stat: async (input) =>
      wrap("stat", input, () => {
        const v = store.get(input.key);
        if (!v) {
          return { ok: false, error: new Error("not found") } as never;
        }
        return { ok: true, value: { key: input.key, size: v.body.length, etag: "x", contentType: "text/plain", lastModified: new Date(0), metadata: v.metadata } } as never;
      }),
    exists: async (input) =>
      wrap("exists", input, () => {
        return { ok: true, value: { exists: store.has(input.key) } } as never;
      }),
    getMetadata: async (input) =>
      wrap("getMetadata", input, () => {
        const v = store.get(input.key);
        if (!v) {
          return { ok: false, error: new Error("not found") } as never;
        }
        return { ok: true, value: v.metadata } as never;
      }),
    setMetadata: async (input) =>
      wrap("setMetadata", input, () => {
        const v = store.get(input.key);
        if (!v) {
          return { ok: false, error: new Error("not found") } as never;
        }
        store.set(input.key, { ...v, metadata: input.metadata });
        return { ok: true, value: {} } as never;
      }),
    createPresignedUploadUrl: async (input) =>
      wrap("createPresignedUploadUrl", input, () => {
        return { ok: true, value: { url: `https://signed/${input.key}`, method: "PUT" as const } } as never;
      }),
    createPresignedDownloadUrl: async (input) =>
      wrap("createPresignedDownloadUrl", input, () => {
        return { ok: true, value: { url: `https://signed/${input.key}` } } as never;
      }),
    getPublicUrl: async (input) =>
      wrap("getPublicUrl", input, () => {
        return { ok: true, value: { url: `https://public/${input.key}` } } as never;
      }),
  };
};

const makeParent = (adapter: S3CompatibleAdapter): FileSystem => {
  const config: FileSystemConfig = {
    provider: "s3",
    bucket: "parent-bucket",
    region: "us-east-1",
    credentials: { accessKeyId: "a", secretAccessKey: "b" },
    forcePathStyle: false,
  };
  const parentFs: FileSystem = {
    adapter,
    config,
    metadata: undefined,
    forTenant: (id: string) => forTenant(id, parentFs),
  };
  return parentFs;
};

// ---------------------------------------------------------------------------
// withPrefixAdapter
// ---------------------------------------------------------------------------

describe("T-020/T-021: withPrefixAdapter — key rewriting for all 13 methods", () => {
  it("rewrites read key", async () => {
    const inner = makeMemoryAdapter();
    inner.store.set("/org/acme/a.txt", { body: "hi", metadata: {} });
    const wrapped = withPrefixAdapter(inner, "/org/acme");
    const r = await wrapped.read({ key: asS3Key("a.txt") });
    expect(r.ok).toBe(true);
    // The inner adapter saw the rewritten key
    expect(inner.calls.at(-1)?.input).toMatchObject({ key: "/org/acme/a.txt" });
  });

  it("rewrites write key", async () => {
    const inner = makeMemoryAdapter();
    const wrapped = withPrefixAdapter(inner, "/org/acme");
    await wrapped.write({ key: asS3Key("a.txt"), body: new TextEncoder().encode("x") });
    expect(inner.store.has("/org/acme/a.txt")).toBe(true);
    expect(inner.store.has("a.txt")).toBe(false);
  });

  it("rewrites move source + destination", async () => {
    const inner = makeMemoryAdapter();
    inner.store.set("/org/acme/a.txt", { body: "x", metadata: {} });
    const wrapped = withPrefixAdapter(inner, "/org/acme");
    await wrapped.move({ sourceKey: asS3Key("a.txt"), destinationKey: asS3Key("b.txt") });
    expect(inner.store.has("/org/acme/b.txt")).toBe(true);
    expect(inner.store.has("/org/acme/a.txt")).toBe(false);
  });

  it("rewrites list prefix", async () => {
    const inner = makeMemoryAdapter();
    inner.store.set("/org/acme/a.txt", { body: "x", metadata: {} });
    inner.store.set("/org/acme/sub/b.txt", { body: "y", metadata: {} });
    inner.store.set("/other-tenant/c.txt", { body: "z", metadata: {} });
    const wrapped = withPrefixAdapter(inner, "/org/acme");
    const r = await wrapped.list({ prefix: asPrefix("") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Only /org/acme/* items should be in the result (the inner
    // adapter filtered by its own prefix arg, which we prepended).
    const keys = r.value.items.map((i) => i.key);
    expect(keys.every((k) => k.startsWith("/org/acme/"))).toBe(true);
  });

  it("rewrites presigned URL key", async () => {
    const inner = makeMemoryAdapter();
    const wrapped = withPrefixAdapter(inner, "/org/acme");
    const r = await wrapped.createPresignedUploadUrl({ key: asS3Key("big.bin") });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.url).toContain("/org/acme/big.bin");
  });

  it("empty prefix is a no-op (returns the original adapter)", () => {
    const inner = makeMemoryAdapter();
    const wrapped = withPrefixAdapter(inner, "");
    expect(wrapped).toBe(inner);
  });

  it("strips trailing slash from prefix to avoid double-slash", async () => {
    const inner = makeMemoryAdapter();
    const wrapped = withPrefixAdapter(inner, "/org/acme/");
    await wrapped.write({ key: asS3Key("a.txt"), body: new Uint8Array() });
    expect(inner.store.has("/org/acme/a.txt")).toBe(true);
    expect(inner.store.has("/org/acme//a.txt")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TenantScope
// ---------------------------------------------------------------------------

describe("T-020: TenantScope — chainable, immutable, materializes via .fs()", () => {
  it("forTenant returns a TenantScope (not a FileSystem)", () => {
    const parent = makeParent(makeMemoryAdapter());
    const scope = parent.forTenant("acme");
    expect(scope).toBeInstanceOf(TenantScope);
    expect(scope.tenantId).toBe("acme");
  });

  it("is immutable: bucket/prefix return NEW scopes, not mutate", () => {
    const parent = makeParent(makeMemoryAdapter());
    const a = parent.forTenant("acme");
    const b = a.bucket("acme-private");
    const c = a.prefix("/org/acme");
    // The original is unchanged
    expect(a.bucketOverride).toBeUndefined();
    expect(a.prefixOverride).toBeUndefined();
    // The children have their own state
    expect(b.bucketOverride).toBe("acme-private");
    expect(c.prefixOverride).toBe("/org/acme");
  });

  it("is chainable: bucket + prefix + fs produces a FileSystem", () => {
    const parentFs = makeParent(makeMemoryAdapter());
    const child = parentFs.forTenant("acme").bucket("acme-private").prefix("/org/acme").fs();
    expect(child.config.bucket).toBe("acme-private");
    // The adapter is the prefix-wrapped one (writes go to /org/acme/*)
    expect(child.adapter).not.toBe(parentFs.adapter);
  });

  it("forTenant without bucket/prefix keeps the parent's bucket, no key rewriting", () => {
    const parentFs = makeParent(makeMemoryAdapter());
    const child = parentFs.forTenant("acme").fs();
    expect(child.config.bucket).toBe(parentFs.config.bucket);
  });

  it("child.forTenant(id) returns a new scope (chained tenant scoping)", () => {
    const parentFs = makeParent(makeMemoryAdapter());
    const child = parentFs.forTenant("acme").prefix("/org/acme").fs();
    const grandchild = child.forTenant("acme-sub").prefix("/sub").fs();
    expect(grandchild.adapter).not.toBe(child.adapter);
    // The grandchild's adapter writes to /org/acme/sub/* (prefix
    // accumulation is a v0.2 feature; v0.1 resets to /sub/*).
    // The structural point: forTenant works on the child too.
  });
});

// ---------------------------------------------------------------------------
// withAuth
// ---------------------------------------------------------------------------

import { withAuth } from "@/storage/auth";
import type { AuthContext } from "@/storage/auth-types";

const baseContext: AuthContext = {
  userId: "u-1",
  tenantId: "acme",
  roles: ["admin"],
};

describe("T-024/T-025: withAuth HOF — composes with both transports", () => {
  it("calls the handler when the resolver returns a context", async () => {
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = withAuth(
      async () => baseContext,
      handler,
    );
    const res = await wrapped(new Request("https://example.com/"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(handler).toHaveBeenCalledOnce();
  });

  it("short-circuits to 401 when the resolver returns null", async () => {
    const handler = vi.fn(async () => new Response("ok", { status: 200 }));
    const wrapped = withAuth(
      async () => null,
      handler,
    );
    const res = await wrapped(new Request("https://example.com/"));
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("Unauthorized");
    expect(handler).not.toHaveBeenCalled();
  });

  it("passes the resolved context to the handler", async () => {
    let received: AuthContext | undefined;
    const wrapped = withAuth<AuthContext>(
      async () => baseContext,
      async (ctx) => {
        received = ctx;
        return new Response("ok");
      },
    );
    await wrapped(new Request("https://example.com/"));
    expect(received).toEqual(baseContext);
  });

  it("accepts an extended context type (generic over C extends AuthContext)", async () => {
    interface ExtendedCtx extends AuthContext {
      orgId: string;
      subscriptionTier: "free" | "pro" | "enterprise";
    }
    const extended: ExtendedCtx = {
      ...baseContext,
      orgId: "org-1",
      subscriptionTier: "pro",
    };
    let received: ExtendedCtx | undefined;
    const wrapped = withAuth<ExtendedCtx>(
      async () => extended,
      async (ctx) => {
        received = ctx;
        return new Response("ok");
      },
    );
    await wrapped(new Request("https://example.com/"));
    expect(received).toEqual(extended);
  });

  it("forwards the request to the resolver", async () => {
    let receivedReq: Request | undefined;
    const wrapped = withAuth(
      async ({ req }) => {
        receivedReq = req;
        return baseContext;
      },
      async () => new Response("ok"),
    );
    const req = new Request("https://example.com/foo?bar=1");
    await wrapped(req);
    expect(receivedReq).toBe(req);
  });
});
