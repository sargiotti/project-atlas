import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { errorBody, goTo, json } from "./fixtures";

// Slice 13 changes to the Points editor: shows count and link in the Inspector, the delete-with-shows modal and its
// acknowledgement, the 409 `point_has_sessions`, and Ctrl+S.
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
  city: "Rosario", country: "AR", language: "es", description: null, website: null, venueAddress: null, map: MAP, cover: null,
  createdAt: T0, updatedAt: T0,
};
const organizer = { id: ORG, displayName: "Ada", email: "ada@example.com", role: "organizer" };
const STAGE = { id: "stage-1", name: "Plaza Stage", category: "stage", description: "", x: 0.4, y: 0.3 };
const FOOD = { id: "food-1", name: "Tacos", category: "food", description: "", x: 0.6, y: 0.6 };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const h = routes[`${init?.method ?? "GET"} ${String(input).replace(/^.*\/api\/v1/, "")}`];
    return h ? h(String(input), init) : json(errorBody("event_not_found"), 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const routes = (sessionCounts: Record<string, number> = { "stage-1": 3 }): Record<string, Handler> => ({
  "GET /auth/me": () => json({ organizer }),
  [`GET /panel/events/${ID}`]: () => json({ event: EV }),
  [`GET /panel/events/${ID}/points`]: () => json({ points: [STAGE, FOOD], eventUpdatedAt: T0, sessionCounts }),
});
const PUT = `PUT /panel/events/${ID}/points`;
const saved = (points: any[], sessionsDeleted = 0) => ({ points, eventUpdatedAt: T1, sessionCounts: {}, counts: { created: 0, updated: 0, deleted: 1, sessionsDeleted }, created: [] });
const putBody = (fn: ReturnType<typeof vi.fn>) => {
  const call = fn.mock.calls.find(([, init]) => (init as any)?.method === "PUT");
  return call ? JSON.parse((call[1] as any).body) : null;
};
const open = () => {
  localStorage.setItem("atlas.lang", "en");
  goTo(`/panel/events/${ID}/points`);
  return render(<I18nProvider initial="en"><Routes /></I18nProvider>);
};
const selectPlaced = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await waitFor(() => expect(document.querySelector(".ped-rail")).toBeTruthy());
  const rail = document.querySelector(".ped-rail") as HTMLElement;
  await user.click(within(rail).getByRole("tab", { name: /^Placed/ }));
  await user.click(within(rail).getByRole("button", { name: new RegExp(name) }));
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("atlas.pointsOnboarding.v1", "1");
});
afterEach(() => {
  vi.unstubAllGlobals();
  goTo("/");
});

describe("Inspector shows block", () => {
  it("shows the count and a link to the Schedule editor for that place", async () => {
    mockApi(routes());
    const user = userEvent.setup();
    open();
    await selectPlaced(user, "Plaza Stage");
    const insp = await screen.findByRole("complementary", { name: "Selected point" });
    expect(within(insp).getByText("3 shows")).toBeInTheDocument();
    expect(within(insp).getByRole("link", { name: "Edit shows" })).toHaveAttribute("href", `/panel/events/${ID}/schedule?place=stage-1`);
    // a place with shows cannot become something that takes none
    expect(within(insp).getByRole("button", { name: "Toilets" })).toBeDisabled();
    expect(within(insp).getByRole("button", { name: "Landmark" })).toBeEnabled();
    expect(within(insp).getByText(/can only be a stage or a landmark/)).toBeInTheDocument();
  });

  it("has no block for a place that cannot have shows, and says to save a new stage first", async () => {
    mockApi(routes());
    const user = userEvent.setup();
    open();
    await selectPlaced(user, "Tacos");
    const insp = await screen.findByRole("complementary", { name: "Selected point" });
    expect(within(insp).queryByText("Shows")).toBeNull();
    // change the saved food place into a stage: it is still not saved as one
    await user.click(within(insp).getByRole("button", { name: "Stage" }));
    expect(within(insp).getByText("Save the place first, then add its shows.")).toBeInTheDocument();
    expect(within(insp).queryByRole("link", { name: "Edit shows" })).toBeNull();
  });
});

describe("deleting a place that has shows", () => {
  it("asks with the server's count; Cancel keeps both, confirming deletes and sends the acknowledgement", async () => {
    const fetchMock = mockApi({ ...routes(), [PUT]: () => json(saved([FOOD], 3)) });
    const user = userEvent.setup();
    open();
    await selectPlaced(user, "Plaza Stage");
    const insp = await screen.findByRole("complementary", { name: "Selected point" });
    await user.click(within(insp).getByRole("button", { name: /^Delete/ }));
    const dlg = await screen.findByRole("alertdialog", { name: "Delete this place?" });
    expect(dlg).toHaveTextContent("This place has 3 shows. Delete it and its shows?");
    expect(dlg).toHaveTextContent("Plaza Stage");
    await user.click(within(dlg).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByText(/unsaved change/)).toBeNull(); // nothing was deleted

    await user.click(within(insp).getByRole("button", { name: /^Delete/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete place and shows" }));
    expect(screen.getAllByText("Deleted Plaza Stage and 3 shows").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putBody(fetchMock)).not.toBeNull());
    expect(putBody(fetchMock)).toEqual({
      baseUpdatedAt: T0,
      points: [{ id: "food-1", category: "food", name: "Tacos", description: "", x: 0.6, y: 0.6 }],
      deleteSessionsOf: ["stage-1"],
    });
  });

  it("a place without shows is deleted straight away with Undo, no modal, and no acknowledgement", async () => {
    const fetchMock = mockApi({ ...routes(), [PUT]: () => json(saved([STAGE])) });
    const user = userEvent.setup();
    open();
    await selectPlaced(user, "Tacos");
    await user.click(within(await screen.findByRole("complementary", { name: "Selected point" })).getByRole("button", { name: /^Delete/ }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(putBody(fetchMock)).not.toBeNull());
    expect(putBody(fetchMock)).not.toHaveProperty("deleteSessionsOf");
  });

  it("Undo of a confirmed deletion leaves nothing to acknowledge", async () => {
    const fetchMock = mockApi({ ...routes(), [PUT]: () => json(saved([STAGE, FOOD])) });
    const user = userEvent.setup();
    open();
    await selectPlaced(user, "Plaza Stage");
    await user.click(within(await screen.findByRole("complementary", { name: "Selected point" })).getByRole("button", { name: /^Delete/ }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete place and shows" }));
    await user.click(document.querySelector(".ped-toast button") as HTMLElement);
    expect(screen.queryByText(/unsaved change/)).toBeNull();
    expect(fetchMock.mock.calls.some(([, i]) => (i as any)?.method === "PUT")).toBe(false);
  });

  it("when the server says a place has shows (409 point_has_sessions) it explains, keeps the draft and offers a reload", async () => {
    const body = { error: { code: "point_has_sessions", message: "x", requestId: "r", affected: [{ pointId: "stage-1", sessions: 4 }] } };
    const fetchMock = mockApi({ ...routes({}), [PUT]: () => json(body, 409) });
    const user = userEvent.setup();
    open();
    await selectPlaced(user, "Plaza Stage");
    await user.click(within(await screen.findByRole("complementary", { name: "Selected point" })).getByRole("button", { name: /^Delete/ })); // no shows known: no modal
    await user.click(screen.getByRole("button", { name: "Save" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Some places have shows");
    expect(fetchMock.mock.calls.filter(([, i]) => (i as any)?.method === "PUT")).toHaveLength(1); // no retry
    expect(localStorage.getItem(`atlas.pointsDraft.v1.${ORG}.${ID}`)).not.toBeNull();
  });
});

describe("Ctrl+S", () => {
  it("saves from the Points editor, also while typing in a field", async () => {
    const fetchMock = mockApi({ ...routes({}), [PUT]: () => json(saved([STAGE])) });
    const user = userEvent.setup();
    open();
    await selectPlaced(user, "Tacos");
    const insp = await screen.findByRole("complementary", { name: "Selected point" });
    const name = within(insp).getByLabelText("Name");
    await user.type(name, "{Control>}s{/Control}"); // nothing changed yet: nothing to save
    expect(putBody(fetchMock)).toBeNull();
    fireEvent.change(name, { target: { value: "Tacos Don Pepe" } });
    await user.type(name, "{Control>}s{/Control}");
    await waitFor(() => expect(putBody(fetchMock)).not.toBeNull());
    expect(putBody(fetchMock).points.find((p: any) => p.id === "food-1").name).toBe("Tacos Don Pepe");
  });
});
