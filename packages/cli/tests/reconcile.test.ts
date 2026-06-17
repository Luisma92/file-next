import { describe, it, expect } from "vitest";
import { parseReconcileArgs, runReconcile } from "@/reconcile";

describe("parseReconcileArgs", () => {
  it("parses --tenant=acme", () => {
    const result = parseReconcileArgs(["--tenant=acme"]);
    expect(result).toEqual({ tenant: "acme", dryRun: false });
  });

  it("parses -t acme (short form)", () => {
    const result = parseReconcileArgs(["-t", "acme"]);
    expect(result).toEqual({ tenant: "acme", dryRun: false });
  });

  it("parses --dry-run", () => {
    const result = parseReconcileArgs(["--tenant=acme", "--dry-run"]);
    expect(result).toEqual({ tenant: "acme", dryRun: true });
  });

  it("rejects missing tenant", () => {
    const result = parseReconcileArgs([]);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/tenant is required/i);
    }
  });

  it("rejects empty tenant string", () => {
    const result = parseReconcileArgs(["--tenant="]);
    expect(result).toHaveProperty("error");
  });
});

describe("runReconcile", () => {
  it("reports no drift when both arrays are empty (exit 0)", async () => {
    const result = await runReconcile({ tenant: "acme", dryRun: true });
    expect(result.drift.missingInS3).toEqual([]);
    expect(result.drift.orphansInS3).toEqual([]);
    expect(result.hadDrift).toBe(false);
  });

  it("reports drift when missingInS3 is non-empty", async () => {
    const result = await runReconcile(
      { tenant: "acme", dryRun: false },
      {
        runSync: async () => ({
          missingInS3: ["a.txt", "b.txt"],
          orphansInS3: [],
          fixedCount: 0,
        }),
      },
    );
    expect(result.drift.missingInS3).toEqual(["a.txt", "b.txt"]);
    expect(result.drift.fixedCount).toBe(0);
    expect(result.hadDrift).toBe(true);
  });

  it("reports drift when orphansInS3 is non-empty", async () => {
    const result = await runReconcile(
      { tenant: "acme", dryRun: false },
      {
        runSync: async () => ({
          missingInS3: [],
          orphansInS3: ["orphan-1"],
          fixedCount: 1,
        }),
      },
    );
    expect(result.hadDrift).toBe(true);
    expect(result.drift.orphansInS3).toHaveLength(1);
  });

  it("fixedCount is independent of hadDrift", async () => {
    const result = await runReconcile(
      { tenant: "acme", dryRun: false },
      {
        runSync: async () => ({
          missingInS3: [],
          orphansInS3: [],
          fixedCount: 5, // all 5 fixed already
        }),
      },
    );
    expect(result.hadDrift).toBe(false);
    expect(result.drift.fixedCount).toBe(5);
  });
});
