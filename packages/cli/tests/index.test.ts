import { describe, it, expect, vi } from "vitest";
import { dispatch, printHelp, VERSION } from "@/index";

describe("dispatch", () => {
  it("prints help for --help, exits 0", async () => {
    const result = await dispatch(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/file-next CLI v/);
    expect(result.stdout).toContain("migrate");
    expect(result.stdout).toContain("reconcile");
    expect(result.stdout).toContain("doctor");
  });

  it("prints help for -h", async () => {
    const result = await dispatch(["-h"]);
    expect(result.exitCode).toBe(0);
  });

  it("prints version for --version", async () => {
    const result = await dispatch(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(VERSION);
  });

  it("prints help + exits 1 when no command given", async () => {
    const result = await dispatch([]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/file-next CLI v/);
  });

  it("returns exit 2 for unknown command", async () => {
    const result = await dispatch(["frobnicate"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/unknown command/i);
  });

  it("dispatches migrate successfully", async () => {
    const result = await dispatch(
      ["migrate", "--adapter=postgres"],
      {
        migrate: {
          resolveMigrator: async () => ({
            listPending: async () => ["0001_init"],
            apply: async () => ["0000_baseline"],
          }),
        },
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/Applied 1 migration/);
    expect(result.stdout).toMatch(/1 pending/);
  });

  it("dispatches migrate with bad args → exit 2", async () => {
    const result = await dispatch(["migrate", "--adapter=mysql"]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/postgres/);
    expect(result.stderr).toMatch(/sqlite/);
  });

  it("dispatches reconcile — no drift → exit 0", async () => {
    const result = await dispatch(
      ["reconcile", "--tenant=acme"],
      { reconcile: { runSync: async () => ({ missingInS3: [], orphansInS3: [], fixedCount: 0 }) } },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/tenant=acme/);
    expect(result.stdout).toMatch(/missingInS3=0/);
  });

  it("dispatches reconcile — drift → exit 1", async () => {
    const result = await dispatch(
      ["reconcile", "--tenant=acme", "--dry-run"],
      {
        reconcile: {
          runSync: async () => ({
            missingInS3: ["a", "b"],
            orphansInS3: [],
            fixedCount: 0,
          }),
        },
      },
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toMatch(/missingInS3=2/);
    expect(result.stdout).toMatch(/dry-run/);
  });

  it("dispatches doctor — all pass → exit 0", async () => {
    const originalEnv = process.env;
    process.env = {
      ...originalEnv,
      FILE_NEXT_PROVIDER: "s3",
      FILE_NEXT_BUCKET: "b",
      FILE_NEXT_REGION: "r",
    };
    try {
      const result = await dispatch(["doctor"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/doctor:/);
    } finally {
      process.env = originalEnv;
    }
  });

  it("dispatches doctor — missing provider → exit 1", async () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.FILE_NEXT_PROVIDER;
    delete process.env.FILE_NEXT_BUCKET;
    delete process.env.FILE_NEXT_REGION;
    try {
      const result = await dispatch(["doctor"]);
      expect(result.exitCode).toBe(1);
    } finally {
      process.env = originalEnv;
    }
  });

  it("returns exit 2 when migrate hook throws", async () => {
    const result = await dispatch(
      ["migrate", "--adapter=postgres"],
      {
        migrate: {
          resolveMigrator: async () => {
            throw new Error("DB unreachable");
          },
        },
      },
    );
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toMatch(/DB unreachable/);
  });
});

describe("printHelp", () => {
  it("includes the version passed in", () => {
    expect(printHelp("9.9.9")).toContain("v9.9.9");
  });

  it("uses VERSION by default", () => {
    expect(printHelp()).toContain(`v${VERSION}`);
  });
});
