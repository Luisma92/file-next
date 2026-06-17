/**
 * Tests for the in-memory MetadataStore. Re-uses the contract test
 * suite from `./contract.ts` so the memory adapter shares the
 * same coverage as the SQLite/Postgres adapters.
 */
import { describe } from "vitest";
import { createMemoryStore } from "@/metadata";
import { runMetadataStoreContract } from "./contract";

runMetadataStoreContract("memory", () => createMemoryStore());
