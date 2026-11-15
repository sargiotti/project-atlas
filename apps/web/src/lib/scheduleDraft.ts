import { MAX_SESSIONS_PER_EVENT, pointIdSchema } from "@atlas/contract";
import { z } from "zod";
import { DRAFT_MAX_AGE_MS, draftStore } from "./draftStorage";
import { newKey, type EditorSession } from "./scheduleModel";

// Slice 13, security (Draft): the editor's unsaved sessions survive a closed tab. Only the programme (no tokens, no
// email, no server responses), scoped by organizer and event, never auto-sent, dropped when stale or invalid, and wiped
// on sign out (lib/draftStorage.ts).
const PREFIX = "atlas.scheduleDraft.";
export const scheduleDraftKey = (organizerId: string, eventId: string) => `${PREFIX}v1.${organizerId}.${eventId}`;

// A client copy of the save schema, plus `tmpId`. Text lengths are loose on purpose (an over-long field is a draft the
// organizer still has to fix); the server enforces the real limits.
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
const draftSchema = z.strictObject({
  v: z.literal(1),
  savedAt: z.number().finite(),
  baseUpdatedAt: z.string().max(40),
  sessions: z
    .array(
      z.strictObject({
        id: pointIdSchema.optional(),
        tmpId: z.string().max(64).optional(),
        pointId: pointIdSchema,
        title: z.string().max(2000),
        start: instant,
        end: instant,
        description: z.string().max(20000).optional(),
      }),
    )
    .max(MAX_SESSIONS_PER_EVENT),
});
export type ScheduleDraft = { savedAt: number; baseUpdatedAt: string; sessions: EditorSession[] };

/** Parsed draft, or null. An invalid, tampered or older-than-7-days draft is deleted on the spot. */
export function loadScheduleDraft(organizerId: string, eventId: string): ScheduleDraft | null {
  const ls = draftStore();
  if (!ls) return null;
  const k = scheduleDraftKey(organizerId, eventId);
  try {
    const raw = ls.getItem(k);
    if (raw === null) return null;
    const parsed = draftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || Date.now() - parsed.data.savedAt > DRAFT_MAX_AGE_MS) {
      ls.removeItem(k);
      return null;
    }
    const d = parsed.data;
    return {
      savedAt: d.savedAt,
      baseUpdatedAt: d.baseUpdatedAt,
      sessions: d.sessions.map((s) => ({ key: s.id ?? s.tmpId ?? newKey(), id: s.id, pointId: s.pointId, title: s.title, description: s.description ?? "", start: s.start, end: s.end })),
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
export function saveScheduleDraft(organizerId: string, eventId: string, baseUpdatedAt: string, sessions: EditorSession[]): "ok" | "quota" {
  const ls = draftStore();
  if (!ls) return "quota";
  const value = {
    v: 1,
    savedAt: Date.now(),
    baseUpdatedAt,
    sessions: sessions.map((s) => ({
      ...(s.id ? { id: s.id } : { tmpId: s.key }),
      pointId: s.pointId,
      title: s.title,
      start: s.start,
      end: s.end,
      ...(s.description ? { description: s.description } : {}),
    })),
  };
  try {
    ls.setItem(scheduleDraftKey(organizerId, eventId), JSON.stringify(value));
    return "ok";
  } catch {
    return "quota";
  }
}

export function clearScheduleDraft(organizerId: string, eventId: string) {
  try {
    draftStore()?.removeItem(scheduleDraftKey(organizerId, eventId));
  } catch {
    /* ignore */
  }
}

export const SCHEDULE_ONBOARDING_KEY = "atlas.scheduleOnboarding.v1";
export function scheduleOnboardingSeen(): boolean {
  try {
    return draftStore()?.getItem(SCHEDULE_ONBOARDING_KEY) === "1";
  } catch {
    return false;
  }
}
export function markScheduleOnboardingSeen() {
  try {
    draftStore()?.setItem(SCHEDULE_ONBOARDING_KEY, "1");
  } catch {
    /* ignore */
  }
}
