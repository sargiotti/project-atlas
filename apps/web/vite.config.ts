import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * Bakes the absolute Home link-preview URLs into index.html (slice 04). The origin has ONE source of truth:
 * PUBLIC_ORIGIN in apps/api/wrangler.toml (the Worker builds the /e/{slug} URLs from the same value).
 * The brand card is the content-hashed file the seed step wrote to public/og/ (npm run seed:build).
 */
const here = import.meta.dirname;
function readPublicOrigin(): string {
  const toml = readFileSync(resolve(here, "../api/wrangler.toml"), "utf8");
  const origin = /^PUBLIC_ORIGIN\s*=\s*"([^"]+)"\s*$/m.exec(toml)?.[1];
  if (!origin || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(origin)) {
    throw new Error("PUBLIC_ORIGIN in apps/api/wrangler.toml must be a bare https origin");
  }
  return origin;
}

function linkPreviewMeta(): Plugin {
  return {
    name: "atlas-link-preview-meta",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const origin = readPublicOrigin();
        let cards: string[] = [];
        try {
          cards = readdirSync(resolve(here, "public/og")).filter((f) => /^brand-card\.[0-9a-f]{8}\.jpg$/.test(f));
        } catch {
          // handled below
        }
        if (cards.length !== 1) {
          throw new Error("Expected exactly one public/og/brand-card.{hash8}.jpg. Run: npm run seed:build");
        }
        return html
          .replaceAll("__PUBLIC_ORIGIN__", origin)
          .replaceAll("__BRAND_CARD_URL__", `${origin}/og/${cards[0]}`);
      },
    },
  };
}

// In dev the Worker (wrangler, :8787) serves the API and the seeded map SVGs.
const worker = "http://localhost:8787";

export default defineConfig({
  plugins: [react(), linkPreviewMeta()],
  // Slice 09: the same origin is baked into the calendar link-back (https://<origin>/e/<slug>).
  define: { __PUBLIC_ORIGIN__: JSON.stringify(readPublicOrigin()) },
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
