/**
 * Slice 24: leyenda.ink is the canonical host. Old hosts redirect to it.
 *
 * The target is built ONLY from this constant plus the request path and query. Host and X-Forwarded-Host
 * are never read to build it, and the host match is an exact lookup (no suffix or regex), so preview
 * hosts (`<hash>-atlas.sargiotti67.workers.dev`), localhost and test hosts are served unchanged.
 */
export const PUBLIC_ORIGIN = "https://leyenda.ink";

/** Permanent since slice 25 (the slice 24 smoke test passed on both old hosts). */
export const REDIRECT_STATUS = 301;

const REDIRECT_HOSTS: ReadonlySet<string> = new Set(["www.leyenda.ink", "atlas.sargiotti67.workers.dev"]);

export type HostDecision =
  | { action: "serve" }
  | { action: "redirect"; location: string }
  | { action: "reject" };

export function decideHost(requestUrl: string, method: string): HostDecision {
  const url = new URL(requestUrl);
  if (!REDIRECT_HOSTS.has(url.hostname)) return { action: "serve" };
  if (method !== "GET" && method !== "HEAD") return { action: "reject" };
  return { action: "redirect", location: PUBLIC_ORIGIN + url.pathname + url.search };
}
