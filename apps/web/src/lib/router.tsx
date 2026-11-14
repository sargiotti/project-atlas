import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

// Minimal client-side routing: two routes do not justify a router dependency.
export function usePath() {
  const [path, setPath] = useState(() => window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path;
}

// A page with unsaved work (the event form) can veto in-app navigation: the guard returns false to cancel
// and is then responsible for asking the user. `force` skips it (redirects, navigation after a save).
let guard: ((to: string) => boolean) | null = null;
export function setNavigationGuard(g: (to: string) => boolean) {
  guard = g;
  return () => {
    if (guard === g) guard = null;
  };
}

export function navigate(to: string, replace = false, force = false) {
  if (!force && guard && !guard(to)) return;
  if (replace) window.history.replaceState({}, "", to);
  else window.history.pushState({}, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

/** "/e/some-slug" -> "some-slug". Returns null when the path is not an event route. */
export function matchEventSlug(path: string): string | null {
  const m = /^\/e\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return "";
  }
}

/** "/panel/invite/<token>" -> "<token>" (the token shape is validated by the page, not here). */
export function matchInviteToken(path: string): string | null {
  const m = /^\/panel\/invite\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return "";
  }
}

const ID = "[a-z0-9-]{1,64}";
/** `/panel/events/<id>[/edit|/preview]` -> { id, view }. `new` is matched before this. Bad ids give null. */
export function matchPanelEvent(path: string): { id: string; view: "hub" | "edit" | "preview" } | null {
  const m = new RegExp(`^/panel/events/(${ID})(?:/(edit|preview))?$`).exec(path);
  if (!m) return null;
  return { id: m[1], view: (m[2] as "edit" | "preview" | undefined) ?? "hub" };
}
