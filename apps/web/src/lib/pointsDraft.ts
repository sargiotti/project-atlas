import { MAX_POINTS_PER_MAP, pointCategorySchema, pointIdSchema } from "@atlas/contract";
import { z } from "zod";
import { newKey, type EditorPoint } from "./pointsModel";

// Slice 08c, security P4: the ONE accepted use of localStorage for panel data. It holds only the organizer's own,
// non-secret Points of one event (no tokens, no email, no map URLs, no server responses), scoped by organizer and
// event, never auto-sent, dropped when stale, and wiped on sign out.
const PREFIX = "atlas.pointsDraft.";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const draftKey = (organizerId: string, eventId: string) => `${PREFIX}v1.${organizerId}.${eventId}`;

// A client copy of the save schema, plus `tmpId`. Text lengths are loose on purpose: an over-long field is a
// draft the organizer still has to fix, not a draft to throw away. The server enforces the real limits.
const coord = z.number().finite().min(0).max(1);
const draftSchema = z.strictObject({
  v: z.literal(1),
  savedAt: z.number().finite(),
  baseUpdatedAt: z.string().max(40),
  points: z
    .array(
      z.strictObject({
        id: pointIdSchema.optional(),
        tmpId: z.string().max(64).optional(),
        category: pointCategorySchema,
        name: z.string().max(2000).nullable(),
        description: z.string().max(20000),
        x: coord,
        y: coord,
      }),
    )
    .max(MAX_POINTS_PER_MAP),
});
export type Draft = { savedAt: number; baseUpdatedAt: string; points: EditorPoint[] };

const store = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

function keysWithPrefix(ls: Storage): string[] {
  const out: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k && k.startsWith(PREFIX)) out.push(k);
  }
  return out;
}

/** Parsed draft, or null. An invalid, tampered or older-than-7-days draft is deleted on the spot. */
export function loadDraft(organizerId: string, eventId: string): Draft | null {
  const ls = store();
  if (!ls) return null;
  const k = draftKey(organizerId, eventId);
  try {
    const raw = ls.getItem(k);
    if (raw === null) return null;
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || Date.now() - parsed.data.savedAt > MAX_AGE_MS) {
      ls.removeItem(k);
      return null;
    }
    const d = parsed.data;
    return {
      savedAt: d.savedAt,
      baseUpdatedAt: d.baseUpdatedAt,
      points: d.points.map((p) => ({ key: p.id ?? p.tmpId ?? newKey(), id: p.id, category: p.category, name: p.name, description: p.description, x: p.x, y: p.y })),
    };
  } catch {
    try {
      ls.removeItem(k);
    } catch {
      /* ignore */
    }
    return null;
  }
}

/** "ok", or "quota" when the browser refused (the editor keeps working and says the draft is not kept locally). */
export function saveDraft(organizerId: string, eventId: string, baseUpdatedAt: string, points: EditorPoint[]): "ok" | "quota" {
  const ls = store();
  if (!ls) return "quota";
  const value = {
    v: 1,
    savedAt: Date.now(),
    baseUpdatedAt,
    // What is typed, as typed (a Just-drop name may be null). Identity: server id, or the local tmpId for new Points.
    points: points.map((p) => ({ ...(p.id ? { id: p.id } : { tmpId: p.key }), category: p.category, name: p.name, description: p.description, x: p.x, y: p.y })),
  };
  try {
    ls.setItem(draftKey(organizerId, eventId), JSON.stringify(value));
    return "ok";
  } catch {
    return "quota";
  }
}

export function clearDraft(organizerId: string, eventId: string) {
  try {
    store()?.removeItem(draftKey(organizerId, eventId));
  } catch {
    /* ignore */
  }
}

/** Sign out: every draft of every organizer, before the logout request is awaited. */
export function clearAllDrafts() {
  const ls = store();
  if (!ls) return;
  try {
    for (const k of keysWithPrefix(ls)) ls.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** After a successful /auth/me: drafts left by another account on this browser are deleted. */
export function purgeForeignDrafts(organizerId: string) {
  const ls = store();
  if (!ls) return;
  try {
    const mine = `${PREFIX}v1.${organizerId}.`;
    for (const k of keysWithPrefix(ls)) if (!k.startsWith(mine)) ls.removeItem(k);
  } catch {
    /* ignore */
  }
}

export const ONBOARDING_KEY = "atlas.pointsOnboarding.v1";
export function onboardingSeen(): boolean {
  try {
    return store()?.getItem(ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}
export function markOnboardingSeen() {
  try {
    store()?.setItem(ONBOARDING_KEY, "1");
  } catch {
    /* ignore */
  }
}
