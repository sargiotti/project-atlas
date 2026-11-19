import { TURNSTILE_SITE_KEY } from "@atlas/contract";

// Cloudflare Turnstile, loaded on demand and only on /organizadores (the CSP allows the script and its frame).
const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Public site key. A build can override it (local dev uses Cloudflare's test key); the default is committed in the contract. */
export const siteKey: string = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY || TURNSTILE_SITE_KEY;

export type TurnstileApi = {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
};

let loading: Promise<TurnstileApi> | null = null;

export function loadTurnstile(): Promise<TurnstileApi> {
  const w = window as any;
  if (w.turnstile) return Promise.resolve(w.turnstile as TurnstileApi);
  if (loading) return loading;
  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile as TurnstileApi) : reject(new Error("turnstile")));
    s.onerror = () => {
      loading = null; // allow a retry on the next mount
      s.remove();
      reject(new Error("turnstile"));
    };
    document.head.appendChild(s);
  });
  return loading;
}
