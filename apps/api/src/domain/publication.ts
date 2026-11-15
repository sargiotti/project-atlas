import { DAILY_TRANSITION_CAP, type EventStatus } from "@atlas/contract";

/**
 * Slice 08b, ADR 0012: the publish flow of an event. Pure: no I/O, no framework.
 *
 * Every state change is one of the actions below, and every action has exactly one rule: who may do it, from which
 * states, to which state. The adapter turns a rule into ONE conditional statement (`WHERE publish_state IN (...)`),
 * so there is no read-then-write race: when the guard fails nothing changes, and `classifyRefusal` explains why.
 */

export type PublishAction = "request" | "withdraw" | "unpublish" | "approve" | "reject" | "admin_unpublish";
export type Actor = "organizer" | "admin";

export interface TransitionRule {
  readonly action: PublishAction;
  readonly actor: Actor;
  readonly from: readonly EventStatus[];
  readonly to: EventStatus;
  /** A map must exist at the moment of the change (and the stored fields must pass `eventInputSchema`). */
  readonly needsMap: boolean;
  /** Slice 08c: at least one Point must exist at the moment of the change (publish requests and Admin approvals). */
  readonly needsPoints: boolean;
  /** The caller names the content version it saw (`updated_at`), and the change only applies to that version. */
  readonly versionGuard: boolean;
}

/** The allowed transitions. Anything not listed here is refused with `invalid_transition`. */
export const TRANSITIONS: readonly TransitionRule[] = [
  { action: "request", actor: "organizer", from: ["draft", "rejected", "unpublished_admin"], to: "in_review", needsMap: true, needsPoints: true, versionGuard: false },
  { action: "withdraw", actor: "organizer", from: ["in_review"], to: "draft", needsMap: false, needsPoints: false, versionGuard: false },
  { action: "unpublish", actor: "organizer", from: ["published"], to: "draft", needsMap: false, needsPoints: false, versionGuard: false },
  { action: "approve", actor: "admin", from: ["in_review"], to: "published", needsMap: true, needsPoints: true, versionGuard: true },
  { action: "reject", actor: "admin", from: ["in_review"], to: "rejected", needsMap: false, needsPoints: false, versionGuard: false },
  { action: "admin_unpublish", actor: "admin", from: ["published"], to: "unpublished_admin", needsMap: false, needsPoints: false, versionGuard: false },
];

const BY_ACTION = new Map(TRANSITIONS.map((r) => [r.action, r] as const));

export function ruleFor(action: PublishAction): TransitionRule {
  const rule = BY_ACTION.get(action);
  if (!rule) throw new Error(`unknown publish action: ${action}`);
  return rule;
}

/** Whether `action` may start from `state`. */
export function isAllowedFrom(action: PublishAction, state: EventStatus): boolean {
  return ruleFor(action).from.includes(state);
}

/** Whether any action leads from `from` to `to`. */
export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return TRANSITIONS.some((r) => r.from.includes(from) && r.to === to);
}

/** The events visitors can see. */
export const isPublic = (state: EventStatus): boolean => state === "published";

export { DAILY_TRANSITION_CAP };

export type RefusalReason = "not_found" | "invalid_transition" | "event_changed" | "map_required" | "points_required" | "cap_reached";

/** What a re-read found after a conditional statement changed nothing. `null` = the event does not exist for this caller. */
export interface RefusalFacts {
  state: EventStatus;
  updatedAt: number;
  hasMap: boolean;
  hasPoints: boolean;
  /** Organizer transitions already used today (UTC). */
  usedToday: number;
}

/**
 * Why a conditional transition changed nothing. Order matters: existence, then state, then the content version,
 * then the map, then the daily cap, so the answer is the most useful one for the caller.
 */
export function classifyRefusal(rule: TransitionRule, facts: RefusalFacts | null, expectedUpdatedAt: number | null): RefusalReason {
  if (facts === null) return "not_found";
  if (!rule.from.includes(facts.state)) return "invalid_transition";
  if (rule.versionGuard && expectedUpdatedAt !== null && facts.updatedAt !== expectedUpdatedAt) return "event_changed";
  if (rule.needsMap && !facts.hasMap) return "map_required";
  if (rule.needsPoints && !facts.hasPoints) return "points_required";
  if (rule.actor === "organizer" && facts.usedToday >= DAILY_TRANSITION_CAP) return "cap_reached";
  // The guard failed although every fact looks fine: the event changed between the read and the write.
  return "event_changed";
}
