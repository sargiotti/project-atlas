import { describe, expect, it } from "vitest";
import { EVENT_STATUSES, type EventStatus } from "@atlas/contract";
import { TRANSITIONS, canTransition, classifyRefusal, isAllowedFrom, ruleFor, type PublishAction } from "./publication";

const EDGES = new Set(TRANSITIONS.flatMap((r) => r.from.map((f) => `${f}>${r.to}`)));

describe("allowed transitions", () => {
  it("are exactly the eight edges of ADR 0012, and nothing else", () => {
    expect([...EDGES].sort()).toEqual(
      [
        "draft>in_review", // request
        "in_review>draft", // withdraw
        "in_review>published", // approve
        "in_review>rejected", // reject
        "published>draft", // organizer unpublish
        "published>unpublished_admin", // Admin unpublish
        "rejected>in_review", // request again
        "unpublished_admin>in_review", // request again
      ].sort(),
    );
    for (const from of EVENT_STATUSES) {
      for (const to of EVENT_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(EDGES.has(`${from}>${to}`));
      }
    }
  });

  it("only an Admin action can produce published, and only from in_review (no self-approval, no direct republish)", () => {
    const toPublished = TRANSITIONS.filter((r) => r.to === "published");
    expect(toPublished.map((r) => r.action)).toEqual(["approve"]);
    expect(toPublished[0]).toMatchObject({ actor: "admin", from: ["in_review"] });
    for (const r of TRANSITIONS.filter((x) => x.actor === "organizer")) expect(r.to).not.toBe("published");
  });

  it("every way back to public goes through in_review", () => {
    const leaving: EventStatus[] = ["draft", "rejected", "unpublished_admin"];
    for (const from of leaving) expect(canTransition(from, "published")).toBe(false);
    for (const from of leaving) expect(canTransition(from, "in_review")).toBe(true);
  });

  it("who may do what", () => {
    const actors = Object.fromEntries(TRANSITIONS.map((r) => [r.action, r.actor]));
    expect(actors).toEqual({
      request: "organizer",
      withdraw: "organizer",
      unpublish: "organizer",
      approve: "admin",
      reject: "admin",
      admin_unpublish: "admin",
    } satisfies Record<PublishAction, string>);
  });

  it("request and approve need a map; only approve is version-guarded", () => {
    expect(TRANSITIONS.filter((r) => r.needsMap).map((r) => r.action)).toEqual(["request", "approve"]);
    expect(TRANSITIONS.filter((r) => r.versionGuard).map((r) => r.action)).toEqual(["approve"]);
  });

  it("isAllowedFrom follows the table", () => {
    expect(isAllowedFrom("withdraw", "in_review")).toBe(true);
    expect(isAllowedFrom("withdraw", "published")).toBe(false);
    expect(isAllowedFrom("approve", "draft")).toBe(false);
    expect(() => ruleFor("nope" as PublishAction)).toThrow();
  });
});

describe("classifyRefusal", () => {
  const approve = ruleFor("approve");
  const request = ruleFor("request");
  const facts = { state: "in_review" as const, updatedAt: 100, hasMap: true, usedToday: 0 };

  it("explains a refusal in the most useful order", () => {
    expect(classifyRefusal(approve, null, 100)).toBe("not_found");
    expect(classifyRefusal(approve, { ...facts, state: "published" }, 100)).toBe("invalid_transition");
    expect(classifyRefusal(approve, { ...facts, updatedAt: 101 }, 100)).toBe("event_changed");
    expect(classifyRefusal(approve, { ...facts, hasMap: false }, 100)).toBe("map_required");
    expect(classifyRefusal(request, { ...facts, state: "draft", usedToday: 30 }, null)).toBe("cap_reached");
    expect(classifyRefusal(request, { ...facts, state: "draft", usedToday: 29 }, null)).toBe("event_changed"); // lost a race
  });

  it("the daily cap is for organizers only", () => {
    expect(classifyRefusal(approve, { ...facts, usedToday: 99 }, 100)).toBe("event_changed");
  });
});
