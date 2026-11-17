import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { beaconTag } from "./beaconTag";

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

/** Preloads the three fonts every page needs (Bricolage 800, Figtree 400 and 700, latin subset) with their hashed URLs. */
function fontPreload(): Plugin {
  const wanted = [/bricolage-grotesque-latin-800-normal.*\.woff2$/, /figtree-latin-400-normal.*\.woff2$/, /figtree-latin-700-normal.*\.woff2$/];
  return {
    name: "atlas-font-preload",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const names = Object.keys(ctx.bundle ?? {});
        return wanted.flatMap((re) => names.filter((n) => re.test(n))).map((n) => ({
          tag: "link",
          attrs: { rel: "preload", as: "font", type: "font/woff2", href: `/${n}`, crossorigin: "" },
          injectTo: "head" as const,
        }));
      },
    },
  };
}

// In dev the Worker (wrangler, :8787) serves the API, the seeded map SVGs and the uploaded images (/media/*).
// Tests must not depend on the developer's timezone (the geo-lang call only fires for Europe/Madrid).
process.env.TZ = "UTC";

const worker = process.env.ATLAS_WORKER ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react(), linkPreviewMeta(), fontPreload(), beaconTag()],
  // Slice 09: the same origin is baked into the calendar link-back (https://<origin>/e/<slug>).
  define: { __PUBLIC_ORIGIN__: JSON.stringify(readPublicOrigin()) },
  server: {
    proxy: { "/api": worker, "/maps": worker, "/media": worker },
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
