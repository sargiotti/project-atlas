// Slice 08c + 13, security P4: the ONE accepted use of localStorage for panel data is the unsaved-changes draft of an
// editor (Points, Schedule). This file owns what they share: access guarded by try/catch, and the two wipes that run
// on sign out and after /auth/me. Every draft key is `<prefix>v1.<organizerId>.<eventId>`.
export const DRAFT_PREFIXES = ["atlas.pointsDraft.", "atlas.scheduleDraft."] as const;
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const draftStore = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

function draftKeys(ls: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k && DRAFT_PREFIXES.some((p) => k.startsWith(p))) out.push(k);
  }
  return out;
}

/** Sign out: every draft of every organizer and every editor, before the logout request is awaited. */
export function clearAllDrafts() {
  const ls = draftStore();
  if (!ls) return;
  try {
    for (const k of draftKeys(ls)) ls.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** After a successful /auth/me: drafts left by another account on this browser are deleted. */
export function purgeForeignDrafts(organizerId: string) {
  const ls = draftStore();
  if (!ls) return;
  try {
    for (const k of draftKeys(ls)) if (!DRAFT_PREFIXES.some((p) => k.startsWith(`${p}v1.${organizerId}.`))) ls.removeItem(k);
  } catch {
    /* ignore */
  }
}
