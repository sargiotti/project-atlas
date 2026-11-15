// Slice 14: the one thing that crosses from the create form to the edit form of the new event: the encoded cover files, when
// the event was created but the cover upload failed. Memory only (never localStorage or IndexedDB), expires, and is dropped
// as soon as the edit form is left. The event is never re-created: the edit form retries the upload only.
import type { CoverMessageKey, CoverUpload } from "../api/panelCover";

export type CoverHandoff = { eventId: string; files: CoverUpload; error: CoverMessageKey; retryAfter?: number; at: number };

const TTL_MS = 15 * 60 * 1000;
let held: CoverHandoff | null = null;

export function setCoverHandoff(h: Omit<CoverHandoff, "at">) {
  held = { ...h, at: Date.now() };
}

/** Non-destructive on purpose (React may run an initializer twice); clear it with `clearCoverHandoff`. */
export function peekCoverHandoff(eventId: string): CoverHandoff | null {
  if (!held || held.eventId !== eventId || Date.now() - held.at > TTL_MS) return null;
  return held;
}

export function clearCoverHandoff() {
  held = null;
}
