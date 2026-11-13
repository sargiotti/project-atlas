import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// In dev the Worker (wrangler, :8787) serves the API and the seeded map SVGs.
const worker = "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { "/api": worker, "/maps": worker },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // CSP has no data: source: never inline fonts/images as data: URLs.
    assetsInlineLimit: 0,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
    css: false,
  },
});
