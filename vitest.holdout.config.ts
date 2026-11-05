import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["holdout/**/*.test.ts"] } });
