import { describe, it, expect } from "vitest";
import { runDoctor, formatDoctorReport } from "@/doctor";

describe("runDoctor", () => {
  it("returns allOk=false when provider is missing", async () => {
    const { checks, allOk } = await runDoctor({ env: {} });
    expect(allOk).toBe(false);
    // When provider is not declared, the check is named "provider declared".
    const provider = checks.find(
      (c) => c.name === "provider declared" || c.name === "provider valid",
    );
    expect(provider?.ok).toBe(false);
  });

  it("returns allOk=true when all required vars present + provider is s3", async () => {
    const env: NodeJS.ProcessEnv = {
      FILE_NEXT_PROVIDER: "s3",
      FILE_NEXT_BUCKET: "my-bucket",
      FILE_NEXT_REGION: "us-east-1",
    };
    const { checks, allOk } = await runDoctor({ env });
    expect(allOk).toBe(true);
    expect(checks.every((c) => c.ok)).toBe(true);
  });

  it("rejects unknown provider", async () => {
    const env: NodeJS.ProcessEnv = {
      FILE_NEXT_PROVIDER: "azure",
      FILE_NEXT_BUCKET: "x",
      FILE_NEXT_REGION: "us-east-1",
    };
    const { checks, allOk } = await runDoctor({ env });
    expect(allOk).toBe(false);
    const provider = checks.find((c) => c.name === "provider valid");
    expect(provider?.ok).toBe(false);
    expect(provider?.detail).toMatch(/azure/);
  });

  it("requires postgres env vars when adapter=postgres", async () => {
    const env: NodeJS.ProcessEnv = {
      FILE_NEXT_PROVIDER: "s3",
      FILE_NEXT_BUCKET: "b",
      FILE_NEXT_REGION: "r",
      FILE_NEXT_ADAPTER: "postgres",
    };
    const { checks, allOk } = await runDoctor({ env });
    expect(allOk).toBe(false);
    const pgHost = checks.find((c) => c.name === "env FILE_NEXT_PG_HOST");
    expect(pgHost?.ok).toBe(false);
  });

  it("requires FILE_NEXT_SQLITE_PATH when adapter=sqlite", async () => {
    const env: NodeJS.ProcessEnv = {
      FILE_NEXT_PROVIDER: "s3",
      FILE_NEXT_BUCKET: "b",
      FILE_NEXT_REGION: "r",
      FILE_NEXT_ADAPTER: "sqlite",
    };
    const { checks } = await runDoctor({ env });
    const sqlitePath = checks.find((c) => c.name === "env FILE_NEXT_SQLITE_PATH");
    expect(sqlitePath?.ok).toBe(false);
  });

  it("invokes the DB probe when provided", async () => {
    const env: NodeJS.ProcessEnv = {
      FILE_NEXT_PROVIDER: "s3",
      FILE_NEXT_BUCKET: "b",
      FILE_NEXT_REGION: "r",
      FILE_NEXT_ADAPTER: "postgres",
      FILE_NEXT_PG_HOST: "h",
      FILE_NEXT_PG_USER: "u",
      FILE_NEXT_PG_DATABASE: "d",
    };
    const { checks } = await runDoctor({
      env,
      probeDb: async (provider) => ({
        ok: provider === "postgres",
        detail: "connected in 12ms",
      }),
    });
    const pgReachable = checks.find((c) => c.name === "postgres reachable");
    expect(pgReachable?.ok).toBe(true);
    expect(pgReachable?.detail).toMatch(/12ms/);
  });

  it("invokes the bucket probe when bucket+region are set", async () => {
    const env: NodeJS.ProcessEnv = {
      FILE_NEXT_PROVIDER: "s3",
      FILE_NEXT_BUCKET: "my-bucket",
      FILE_NEXT_REGION: "us-east-1",
    };
    const { checks } = await runDoctor({
      env,
      probeBucket: async (bucket, region) => ({
        ok: bucket === "my-bucket" && region === "us-east-1",
        detail: "HEAD 200",
      }),
    });
    const bucket = checks.find((c) => c.name === "bucket reachable");
    expect(bucket?.ok).toBe(true);
  });
});

describe("formatDoctorReport", () => {
  it("renders passed/failed counts in the header", () => {
    const report = formatDoctorReport([
      { name: "a", ok: true, detail: "ok" },
      { name: "b", ok: false, detail: "bad" },
    ]);
    expect(report).toMatch(/1\/2 checks passed/);
    expect(report).toMatch(/✓ a/);
    expect(report).toMatch(/✗ b/);
  });
});
