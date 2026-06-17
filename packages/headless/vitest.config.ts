import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

const headlessSrc = path.resolve(__dirname, "./src");

export default defineConfig({
  plugins: [react()],
  test: {
    name: "headless",
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": headlessSrc,
    },
  },
});
