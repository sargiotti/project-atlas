import { SOURCE_REF_RE } from "@atlas/contract";

const KEY = "atlas.sourceRef";

/** Normalise like the contract expects (the server does not): trim, lowercase, then test the shared regex. */
function clean(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  return SOURCE_REF_RE.test(s) ? s : null;
}

/** Slice 44: on the organizer page, keep a valid `?ref=` for the tab session. Never rendered. Storage may be blocked. */
export function captureSourceRef(): void {
  try {
    const ref = clean(new URLSearchParams(window.location.search).get("ref"));
    if (ref) window.sessionStorage.setItem(KEY, ref);
  } catch {
    // storage unavailable: the ref is simply lost
  }
}

/** The stored ref, only if it still passes the regex. */
export function readSourceRef(): string | null {
  try {
    return clean(window.sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}

/** Drop the stored ref once the request was sent (the privacy notice promises it). */
export function clearSourceRef(): void {
  try {
    window.sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable: nothing to clear
  }
}
