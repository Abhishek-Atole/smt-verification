import { defineConfig } from "vitest/config";

// The api-server src/ tree currently contains stale, git-tracked compiled *.js
// files sitting next to their *.ts sources (build cruft — tsconfig outDir is
// dist/, and nothing imports these .js files). Vite's default resolver tries
// `.js` before `.ts` for extensionless imports, so `await import("../app")`
// and every transitive extensionless import inside it would load the stale
// shadow instead of the current source. Prefer TypeScript extensions so tests
// always exercise the real sources. Safe to delete once the src/*.js shadows
// are removed from the repo.
export default defineConfig({
  resolve: {
    extensions: [".ts", ".mts", ".mjs", ".js", ".tsx", ".jsx", ".json"],
  },
});
