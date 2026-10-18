import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Unit tests for the framework-free modules in lib/. Tests sit next to the
 * module they cover (`lib/crop.test.ts`). They run in Node; a file that needs a
 * DOM (the .xmp parser uses DOMParser) opts in with a
 * `// @vitest-environment jsdom` comment at its top.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    include: ["{lib,components,app}/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
