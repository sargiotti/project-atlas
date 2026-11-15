import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import PointList from "../src/components/PointList";
import { displayName } from "../src/lib/pointLabel";
import { MESSAGES } from "../src/i18n/messages";
import { draftKey } from "../src/lib/pointsDraft";
import { errorBody, goTo, json } from "./fixtures";

const ID = "5b1c2d3e-0000-4000-8000-000000000001";
const ORG = "o1";
const T0 = "2026-11-14T18:20:00.000Z";
const T1 = "2026-11-15T10:00:00.000Z";
const MAP = {
  theme: "light",
  format: "webp",
  full: { url: "/media/maps/e1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-full.webp", width: 2400, height: 3200 },
  small: { url: "/media/maps/e1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-small.webp", width: 1200, height: 1600 },
  updatedAt: T0,
};
const EV = {
  id: ID, slug: "fiesta-x7k2q9", status: "draft", statusReason: null, requestedAt: null, approvedAt: null,
  name: "Fiesta de mi barrio", startDate: "2026-12-12", endDate: "2026-12-13", timeZone: "America/Buenos_Aires",
  city: "Rosario", country: "AR", language: "es", description: null, website: null, map: MAP,
  createdAt: T0, updatedAt: T0,
};
const organizer = { id: ORG, displayName: "Ada", email: "ada@example.com", role: "organizer" };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const h = routes[`${init?.method ?? "GET"} ${String(input).replace(/^.*\/api\/v1/, "")}`];
    return h ? h(String(input), init) : json(errorBody("event_not_found"), 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const baseRoutes = (points: any[] = [], event: any = EV, updatedAt = T0): Record<string, Handler> => ({
  "GET /auth/me": () => json({ organizer }),
  [`GET /panel/events/${ID}`]: () => json({ event }),
  [`GET /panel/events/${ID}/points`]: () => json({ points, eventUpdatedAt: updatedAt }),
});
const PUT = `PUT /panel/events/${ID}/points`;
const open = (lang: "en" | "es" | "da" = "en") => {
  localStorage.setItem("atlas.lang", lang); // the panel reads its own language choice
  goTo(`/panel/events/${ID}/points`);
  return render(<I18nProvider initial={lang}><Routes /></I18nProvider>);
};
const putBody = (fn: ReturnType<typeof vi.fn>) => {
  const call = fn.mock.calls.find(([, init]) => (init as any)?.method === "PUT");
  return call ? JSON.parse((call[1] as any).body) : null;
};

// jsdom has no layout: give the transformed map stage a 1000 x 1000 box so a click maps to 0..1.
const realRect = HTMLElement.prototype.getBoundingClientRect;
beforeEach(() => {
  localStorage.clear();
  HTMLElement.prototype.getBoundingClientRect = function () {
    if ((this as HTMLElement).classList?.contains("map-stage")) return { left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON() {} } as DOMRect;
    return realRect.call(this);
  };
});
afterEach(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
  vi.unstubAllGlobals();
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  goTo("/");
});

const rail = async () => {
  await waitFor(() => expect(document.querySelector(".ped-rail")).toBeTruthy());
  return document.querySelector(".ped-rail") as HTMLElement;
};
const viewer = async () => {
  await waitFor(() => expect(document.querySelector(".map-viewer")).toBeTruthy());
  return document.querySelector(".map-viewer") as HTMLElement;
};
/** Click-then-click placement (the WCAG 2.5.7 alternative to dragging). */
async function placeWithClicks(user: ReturnType<typeof userEvent.setup>, piece: string, x = 300, y = 300) {
  await user.click(within(await rail()).getByRole("button", { name: piece }));
  fireEvent.click(await viewer(), { clientX: x, clientY: y });
}

describe("small screens", () => {
  it("shows only the open-on-a-computer notice below 1024 px and loads nothing", async () => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    const fetchMock = mockApi(baseRoutes());
    open();
    expect(await screen.findByRole("heading", { name: "The map editor needs a bigger screen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(document.querySelector(".ped")).toBeNull();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/points"))).toBe(false);
  });
});

describe("saving", () => {
  it("blocks Save while a Name-it pin has no name, takes the organizer to it, then saves the full set", async () => {
    const fetchMock = mockApi({
      ...baseRoutes(),
      [PUT]: () => json({ points: [{ id: "srv-1", name: "Main stage", category: "stage", description: "", x: 0.3, y: 0.3 }], eventUpdatedAt: T1, counts: { created: 1, updated: 0, deleted: 0 }, created: [{ index: 0, id: "srv-1" }] }),
    });
    const user = userEvent.setup();
    open();
    await placeWithClicks(user, "Stage");

    // The pin needs a name: the Inspector has the cursor in Name and the counter says 1.
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveFocus();
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();

    // Leave the field and press Save: nothing is sent, the pin is selected and the field is focused again.
    await user.click(document.body);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findAllByText(/A point still needs a name/)).length).toBeGreaterThan(0);
    expect(putBody(fetchMock)).toBeNull();
    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveFocus());

    await user.type(screen.getByLabelText("Name"), "Main stage{Enter}");
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ unsaved changes?$/)).not.toBeInTheDocument();
    // New points carry no id; the baseUpdatedAt is the one the editor received.
    expect(putBody(fetchMock)).toEqual({ baseUpdatedAt: T0, points: [{ category: "stage", name: "Main stage", description: "", x: 0.3, y: 0.3 }] });
  });

  it("says the points are visible within a few minutes when the event is published", async () => {
    mockApi({
      ...baseRoutes([], { ...EV, status: "published" }),
      [PUT]: () => json({ points: [{ id: "srv-1", name: null, category: "toilets", description: "", x: 0.3, y: 0.3 }], eventUpdatedAt: T1, counts: { created: 1, updated: 0, deleted: 0 }, created: [{ index: 0, id: "srv-1" }] }),
    });
    const user = userEvent.setup();
    open();
    await placeWithClicks(user, "Toilets");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Saved · visible on the map within a few minutes")).toBeInTheDocument();
  });

  it("counts unsaved changes and lets undo take one back", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    await placeWithClicks(user, "Toilets", 200, 200);
    await placeWithClicks(user, "Info", 600, 600);
    expect(await screen.findByText("2 unsaved changes")).toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Undo" })[0]!);
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
  });

  it("refuses a stale save with a reload prompt and offers the local changes back; nothing is overwritten", async () => {
    const other = { id: "srv-9", name: "Elsewhere", category: "food", description: "", x: 0.5, y: 0.5 };
    let loads = 0;
    const fetchMock = mockApi({
      ...baseRoutes(),
      [`GET /panel/events/${ID}/points`]: () => json(loads++ === 0 ? { points: [], eventUpdatedAt: T0 } : { points: [other], eventUpdatedAt: T1 }),
      [PUT]: () => json(errorBody("event_changed"), 409),
    });
    const user = userEvent.setup();
    open();
    await placeWithClicks(user, "Toilets");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alertdialog", { name: "This event changed elsewhere" })).toBeInTheDocument();
    // No automatic retry.
    expect(fetchMock.mock.calls.filter(([, i]) => (i as any)?.method === "PUT")).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Reload" }));
    // The server's newer set is loaded, and the unsaved work is offered, not applied.
    expect(await screen.findByRole("alertdialog", { name: "Recover your unsaved changes?" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([, i]) => (i as any)?.method === "PUT")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "Restore changes" }));
    // The elsewhere point is there and so is the restored one: 1 change against the new base (the new toilets).
    expect(await screen.findByText("1 unsaved change")).toBeInTheDocument();
    const r = await rail();
    await user.click(within(r).getByRole("tab", { name: "Placed (2)" }));
    expect(within(r).getByText("Elsewhere")).toBeInTheDocument();
  });

  it("explains a rate limit and does not retry on its own", async () => {
    const fetchMock = mockApi({ ...baseRoutes(), [PUT]: () => json(errorBody("rate_limited"), 429, { "Retry-After": "30" }) });
    const user = userEvent.setup();
    open();
    await placeWithClicks(user, "Toilets");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Try again in 30 seconds/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(fetchMock.mock.calls.filter(([, i]) => (i as any)?.method === "PUT")).toHaveLength(1);
  });

  it("will not save a name over 80 characters", async () => {
    const fetchMock = mockApi({ ...baseRoutes() });
    const user = userEvent.setup();
    open();
    await placeWithClicks(user, "Stage");
    await user.type(await screen.findByLabelText("Name"), "x".repeat(81));
    expect(screen.getByText("Names can have up to 80 characters.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(putBody(fetchMock)).toBeNull();
  });
});

describe("Just-drop points and their localized label", () => {
  it("sends name null and shows the label in the viewer's language; a custom name is kept as-is; clearing it goes back to null", async () => {
    const fetchMock = mockApi({
      ...baseRoutes(),
      [PUT]: () => json({ points: [{ id: "srv-1", name: null, category: "toilets", description: "", x: 0.3, y: 0.3 }], eventUpdatedAt: T1, counts: { created: 1, updated: 0, deleted: 0 }, created: [{ index: 0, id: "srv-1" }] }),
    });
    const user = userEvent.setup();
    open("es");
    await placeWithClicks(user, "Baños");
    // Spanish label as the Name placeholder (never as real text), the pin is labelled once ("Baños", not "Baños, Baños").
    const name = await screen.findByLabelText(/^Nombre/);
    expect(name).toHaveValue("");
    expect(name).toHaveAttribute("placeholder", "Baños");
    expect(within(await viewer()).getByRole("button", { name: "Baños", pressed: true })).toBeInTheDocument();

    await user.type(name, "Puerta norte");
    expect(within(await viewer()).getByRole("button", { name: "Puerta norte, Baños" })).toBeInTheDocument();
    await user.clear(name);
    expect(within(await viewer()).getByRole("button", { name: "Baños", pressed: true })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(putBody(fetchMock)).not.toBeNull());
    expect(putBody(fetchMock).points[0].name).toBeNull();
  });

  it("the shared helper shows the custom name as-is and the label in the UI language otherwise", () => {
    const es = (k: string) => (MESSAGES.es as any)[k];
    const da = (k: string) => (MESSAGES.da as any)[k];
    expect(displayName({ name: null, category: "toilets" }, es)).toBe("Baños");
    expect(displayName({ name: null, category: "toilets" }, da)).toBe("Toiletter");
    expect(displayName({ name: "North gate", category: "entrance-exit" }, es)).toBe("North gate");
  });

  it("the visitor list shows the label and sorts by the displayed name in the viewer's language", () => {
    const points: any[] = [
      { id: "a", name: "Zumo", category: "drinks", description: "", x: 0, y: 0 },
      { id: "b", name: null, category: "drinks", description: "", x: 0, y: 0 },
      { id: "c", name: "Agua", category: "drinks", description: "", x: 0, y: 0 },
    ];
    render(<I18nProvider initial="es"><PointList points={points} onPick={() => {}} /></I18nProvider>);
    const names = [...document.querySelectorAll(".list-name")].map((n) => n.textContent);
    expect(names).toEqual(["Agua", "Bebidas", "Zumo"]);
  });
});

describe("local draft", () => {
  const draft = (extra: object = {}) => ({
    v: 1, savedAt: Date.now() - 60_000, baseUpdatedAt: T0,
    points: [{ tmpId: "tmp-1", category: "toilets", name: null, description: "", x: 0.2, y: 0.2 }], ...extra,
  });

  it("offers a saved draft on open and applies it only when asked", async () => {
    localStorage.setItem(draftKey(ORG, ID), JSON.stringify(draft()));
    const fetchMock = mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    expect(await screen.findByRole("alertdialog", { name: "Recover your unsaved changes?" })).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ unsaved changes?$/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Restore changes" }));
    expect(await screen.findByText("1 unsaved change")).toBeInTheDocument();
    // Restoring never sends anything.
    expect(putBody(fetchMock)).toBeNull();
  });

  it("discarding removes it", async () => {
    localStorage.setItem(draftKey(ORG, ID), JSON.stringify(draft()));
    mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    expect(localStorage.getItem(draftKey(ORG, ID))).toBeNull();
  });

  it("silently drops a draft that is tampered with or older than 7 days", async () => {
    localStorage.setItem(draftKey(ORG, ID), JSON.stringify(draft({ savedAt: Date.now() - 8 * 24 * 3600 * 1000 })));
    mockApi(baseRoutes());
    open();
    await viewer();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(localStorage.getItem(draftKey(ORG, ID))).toBeNull();

    localStorage.setItem(draftKey(ORG, ID), JSON.stringify(draft({ points: [{ category: "nope", name: null, description: "", x: 5, y: 0 }] })));
    open();
    await waitFor(() => expect(localStorage.getItem(draftKey(ORG, ID))).toBeNull());
  });

  it("is written while there are unsaved changes, scoped by organizer and event, and removed after a save", async () => {
    mockApi({
      ...baseRoutes(),
      [PUT]: () => json({ points: [{ id: "srv-1", name: null, category: "toilets", description: "", x: 0.3, y: 0.3 }], eventUpdatedAt: T1, counts: { created: 1, updated: 0, deleted: 0 }, created: [{ index: 0, id: "srv-1" }] }),
    });
    const user = userEvent.setup();
    open();
    await placeWithClicks(user, "Toilets");
    await waitFor(() => expect(localStorage.getItem(draftKey(ORG, ID))).not.toBeNull());
    const stored = JSON.parse(localStorage.getItem(draftKey(ORG, ID))!);
    expect(Object.keys(stored).sort()).toEqual(["baseUpdatedAt", "points", "savedAt", "v"]);
    expect(stored.points[0].name).toBeNull(); // a Just-drop default is never frozen into the draft
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved");
    expect(localStorage.getItem(draftKey(ORG, ID))).toBeNull();
  });

  it("another account's drafts are deleted after sign-in, and sign out wipes every draft", async () => {
    localStorage.setItem(draftKey("someone-else", ID), JSON.stringify(draft()));
    localStorage.setItem(draftKey(ORG, "other-event"), JSON.stringify(draft()));
    mockApi({ "GET /auth/me": () => json({ organizer }), "POST /auth/logout": () => new Response(null, { status: 204 }) });
    const user = userEvent.setup();
    goTo("/panel");
    render(<I18nProvider initial="en"><Routes /></I18nProvider>);
    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(localStorage.getItem(draftKey("someone-else", ID))).toBeNull();
    expect(localStorage.getItem(draftKey(ORG, "other-event"))).not.toBeNull(); // same account: kept
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    await screen.findByRole("heading", { name: "Sign in" });
    expect(localStorage.getItem(draftKey(ORG, "other-event"))).toBeNull();
  });
});

describe("onboarding", () => {
  it("walks the three quests once and is not shown again", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    const first = open();
    expect(await screen.findByText("Drop a stage")).toBeInTheDocument();
    await placeWithClicks(user, "Stage");
    await user.type(await screen.findByLabelText("Name"), "Main{Enter}");
    expect(await screen.findByText("Drop the toilets")).toBeInTheDocument();
    await placeWithClicks(user, "Toilets", 600, 600);
    expect(await screen.findByText("Quests complete", { selector: "h2" })).toBeInTheDocument();
    first.unmount();
    open();
    await viewer();
    expect(screen.queryByText("Drop a stage")).not.toBeInTheDocument();
    expect(screen.queryByText("Quests complete", { selector: "h2" })).not.toBeInTheDocument();
  });
});

describe("hub entry and publish", () => {
  it("links to the editor from the hub when the event has a map, and explains points_required", async () => {
    mockApi({
      "GET /auth/me": () => json({ organizer }),
      [`GET /panel/events/${ID}`]: () => json({ event: EV }),
      [`POST /panel/events/${ID}/publish-request`]: () => json(errorBody("points_required"), 409),
    });
    const user = userEvent.setup();
    goTo(`/panel/events/${ID}`);
    render(<I18nProvider initial="en"><Routes /></I18nProvider>);
    expect(await screen.findByRole("link", { name: "Open the points editor" })).toHaveAttribute("href", `/panel/events/${ID}/points`);
    await user.click(screen.getByRole("button", { name: "Request publish" }));
    expect(await screen.findByText("Your event needs at least 1 point on the map before it can be published.")).toBeInTheDocument();
  });
});
