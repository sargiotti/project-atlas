import { eventInputSchema, toFieldErrors, type EventStatus, type FieldError } from "@atlas/contract";
import {
  classifyRefusal,
  isAllowedFrom,
  ruleFor,
  type PublishAction,
  type RefusalFacts,
  type RefusalReason,
  type TransitionRule,
} from "../domain/publication";

/** The stored fields as the organizer saved them, ready to be checked against the slice 07 required fields. */
export interface StoredForTransition {
  state: EventStatus;
  updatedAt: number;
  hasMap: boolean;
  fields: Record<string, unknown>;
}

export interface TransitionCommand {
  rule: TransitionRule;
  eventId: string;
  /** Organizer id for organizer actions (the event must be theirs), `null` for Admin actions. */
  ownerScope: string | null;
  actorId: string;
  now: number;
  /** Reject and Admin unpublish only (already cleaned), else null. */
  reason: string | null;
}

/** Port. Implemented by the D1 adapter. */
export interface PublicationPort {
  readForTransition(eventId: string, ownerScope: string | null): Promise<StoredForTransition | null>;
  /** One conditional statement (plus audit and quota in the same batch). True when it changed the event. */
  apply(command: TransitionCommand, from: EventStatus, guardUpdatedAt: number | null): Promise<boolean>;
  refusalFacts(eventId: string, ownerScope: string | null, organizerId: string, now: number): Promise<RefusalFacts | null>;
}

export type TransitionResult = { ok: true } | { ok: false; reason: RefusalReason } | { ok: false; reason: "validation_error"; fields: FieldError[] };

export interface TransitionInput {
  action: PublishAction;
  eventId: string;
  actorId: string;
  now: number;
  /** Approve only: the content version (`updated_at`, ms) the Admin reviewed. */
  expectedUpdatedAt?: number;
  reason?: string | null;
}

/**
 * Runs one publish-flow action. Request and approve first read the row, so the stored fields can be validated
 * and the write can be guarded by the exact version that was validated. The other actions need no read.
 * Whatever the path, the change itself is one conditional statement; when it changes nothing, one re-read says why.
 */
export async function runTransition(repo: PublicationPort, input: TransitionInput): Promise<TransitionResult> {
  const rule = ruleFor(input.action);
  const command: TransitionCommand = {
    rule,
    eventId: input.eventId,
    ownerScope: rule.actor === "organizer" ? input.actorId : null,
    actorId: input.actorId,
    now: input.now,
    reason: input.reason ?? null,
  };
  const expected = input.expectedUpdatedAt ?? null;

  let from: EventStatus = rule.from[0]!;
  let guardUpdatedAt: number | null = null;

  if (rule.needsMap) {
    const stored = await repo.readForTransition(command.eventId, command.ownerScope);
    if (!stored) return { ok: false, reason: "not_found" };
    if (!isAllowedFrom(rule.action, stored.state)) return { ok: false, reason: "invalid_transition" };
    if (rule.versionGuard && expected !== null && stored.updatedAt !== expected) return { ok: false, reason: "event_changed" };
    if (!stored.hasMap) return { ok: false, reason: "map_required" };
    const valid = eventInputSchema.safeParse(stored.fields);
    if (!valid.success) return { ok: false, reason: "validation_error", fields: toFieldErrors(valid.error) };
    from = stored.state;
    guardUpdatedAt = stored.updatedAt;
  }

  if (await repo.apply(command, from, guardUpdatedAt)) return { ok: true };

  const facts = await repo.refusalFacts(command.eventId, command.ownerScope, command.actorId, command.now);
  return { ok: false, reason: classifyRefusal(rule, facts, expected) };
}
