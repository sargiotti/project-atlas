/** Cloudflare's published always-pass secret for local development. Its fake hostname/action must not be checked. */
const ALWAYS_PASS_TEST_SECRET = "1x0000000000000000000000000000000AA";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** `ok`: valid token. `rejected`: the visitor failed the check. `unavailable`: we could not ask (fails closed). */
export type TurnstileOutcome = "ok" | "rejected" | "unavailable";

/**
 * Server-side Turnstile check. Never cached or reused: every token is verified once (siteverify itself refuses
 * a reused token). Secret missing, network error, non-2xx or a 5 s timeout all mean `unavailable`.
 */
export async function verifyTurnstile(opts: { secret: string | undefined; token: string; remoteIp?: string; action: string; hostname: string; isAllowedHostname?: (h: string) => boolean }): Promise<TurnstileOutcome> {
  if (!opts.secret) return "unavailable";
  try {
    const res = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: opts.secret, response: opts.token, ...(opts.remoteIp ? { remoteip: opts.remoteIp } : {}) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return "unavailable";
    const body = (await res.json()) as { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };
    const codes = body["error-codes"] ?? [];
    if (codes.includes("missing-input-secret") || codes.includes("invalid-input-secret") || codes.includes("internal-error")) return "unavailable";
    if (body.success !== true) return "rejected";
    if (opts.secret === ALWAYS_PASS_TEST_SECRET) return "ok";
    return body.action === opts.action && (body.hostname === opts.hostname || (!!body.hostname && !!opts.isAllowedHostname?.(body.hostname))) ? "ok" : "rejected";
  } catch {
    return "unavailable";
  }
}

const PREVIEW_BASE_HOST = "atlas.sargiotti67.workers.dev";

/** Hosts Turnstile may report. Production: exactly the PUBLIC_ORIGIN host. Preview (decided by PUBLIC_ORIGIN being the preview base host, never by the request): the base host or `<anything>-atlas.sargiotti67.workers.dev`. */
export function isAllowedTurnstileHostname(publicOrigin: string, reported: string): boolean {
  const base = new URL(publicOrigin).hostname;
  if (reported === base) return true;
  if (base !== PREVIEW_BASE_HOST) return false;
  return reported.endsWith(`-${PREVIEW_BASE_HOST}`);
}
