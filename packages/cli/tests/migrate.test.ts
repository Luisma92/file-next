import { describe, it, expect } from "vitest";
import { parseMigrateArgs, runMigrate } from "@/migrate";

describe("parseMigrateArgs", () => {
  it("parses --adapter=postgres", () => {
    const result = parseMigrateArgs(["--adapter=postgres"]);
    expect(result).toEqual({ adapter: "postgres" });
  });

  it("parses -a sqlite (short form)", () => {
    const result = parseMigrateArgs(["-a", "sqlite"]);
    expect(result).toEqual({ adapter: "sqlite" });
  });

  it("rejects unknown adapter", () => {
    const result = parseMigrateArgs(["--adapter=mysql"]);
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toMatch(/postgres/i);
      expect(result.error).toMatch(/sqlite/i);
    }
  });

  it("rejects missing adapter", () => {
    const result = parseMigrateArgs([]);
    expect(result).toHaveProperty("error");
  });

  it("rejects unknown flag (strict mode)", () => {
    const result = parseMigrateArgs(["--adapter=postgres", "--foo=bar"]);
    expect(result).toHaveProperty("error");
  });
});

describe("runMigrate", () => {
  it("returns applied + pending from the migrator hook", async () => {
    let capturedAdapter: string | undefined;
    const result = await runMigrate(
      { adapter: "postgres" },
      {
        resolveMigrator: async (adapter) => {
          capturedAdapter = adapter;
          return {
            listPending: async () => ["0003_add_tags"],
            apply: async () => ["0001_init", "0002_add_owner"],
          };
        },
      },
    );
    expect(capturedAdapter).toBe("postgres");
    expect(result.applied).toEqual(["0001_init", "0002_add_owner"]);
    expect(result.pending).toEqual(["0003_add_tags"]);
  });

  it("with default hooks (no-op) returns empty arrays", async () => {
    const result = await runMigrate({ adapter: "sqlite" });
    expect(result.applied).toEqual([]);
    expect(result.pending).toEqual([]);
  });

  it("propagates migrator errors", async () => {
    await expect(
      runMigrate(
        { adapter: "postgres" },
        {
          resolveMigrator: async () => {
            throw new Error("connection refused");
          },
        },
      ),
    ).rejects.toThrow(/connection refused/);
  });
});
