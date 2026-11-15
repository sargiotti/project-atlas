import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { errorBody, goTo, json } from "./fixtures";

const ID = "5b1c2d3e-0000-4000-8000-000000000001";
const MAP = {
  theme: "light",
  format: "webp",
  full: { url: "/media/maps/e1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-full.webp", width: 2400, height: 3200 },
  small: { url: "/media/maps/e1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-small.webp", width: 1200, height: 1600 },
  updatedAt: "2026-11-14T18:20:00.000Z",
};
const EV = {
  id: ID, slug: "fiesta-x7k2q9", status: "draft", statusReason: null, requestedAt: null, approvedAt: null,
  name: "Fiesta de mi barrio", startDate: "2026-12-12", endDate: "2026-12-13", timeZone: "America/Buenos_Aires",
  city: "Rosario", country: "AR", language: "es", description: null, website: null, map: null,
  createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z",
};
const organizer = { id: "o1", displayName: "Ada", email: "ada@example.com", role: "organizer" };
const admin = { id: "a1", displayName: "Root", email: "root@example.com", role: "admin" };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const h = routes[`${init?.method ?? "GET"} ${String(input).replace(/^.*\/api\/v1/, "")}`];
    return h ? h(String(input), init) : json(errorBody("event_not_found"), 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const open = (path: string) => {
  goTo(path);
  return render(<I18nProvider initial="en"><Routes /></I18nProvider>);
};

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  goTo("/");
});

describe("organizer publish step", () => {
  it("keeps Request publish disabled and asks for a map first when there is none", async () => {
    mockApi({ "GET /auth/me": () => json({ organizer }), [`GET /panel/events/${ID}`]: () => json({ event: EV }) });
    open(`/panel/events/${ID}`);
    expect(await screen.findByText(/Then you can ask the Admin/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request publish" })).toBeDisabled();
  });

  it("requests publish, shows In review and the event can be withdrawn back to Draft", async () => {
    const inReview = { ...EV, map: MAP, status: "in_review", requestedAt: "2026-11-15T09:00:00.000Z" };
    const request = vi.fn(() => json({ event: inReview }));
    const withdraw = vi.fn(() => json({ event: { ...inReview, status: "draft", requestedAt: null } }));
    mockApi({
      "GET /auth/me": () => json({ organizer }),
      [`GET /panel/events/${ID}`]: () => json({ event: { ...EV, map: MAP } }),
      [`POST /panel/events/${ID}/publish-request`]: request,
      [`POST /panel/events/${ID}/withdraw`]: withdraw,
    });
    const user = userEvent.setup();
    open(`/panel/events/${ID}`);
    await user.click(await screen.findByRole("button", { name: "Request publish" }));
    expect(await screen.findByText(/Waiting for the Admin's review/i)).toBeInTheDocument();
    expect(request).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Withdraw request" }));
    expect(await screen.findByRole("button", { name: "Request publish" })).toBeInTheDocument();
    expect(withdraw).toHaveBeenCalledOnce();
  });

  it("explains the daily cap instead of failing silently", async () => {
    mockApi({
      "GET /auth/me": () => json({ organizer }),
      [`GET /panel/events/${ID}`]: () => json({ event: { ...EV, map: MAP } }),
      [`POST /panel/events/${ID}/publish-request`]: () => json(errorBody("transition_cap_reached"), 429),
    });
    const user = userEvent.setup();
    open(`/panel/events/${ID}`);
    await user.click(await screen.findByRole("button", { name: "Request publish" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/today.s limit of status changes/i);
  });
});

describe("Admin review", () => {
  const review = (updatedAt: string, name = "Fiesta de mi barrio") => ({
    event: { slug: "fiesta-x7k2q9", name, startDate: "2026-12-12", endDate: "2026-12-13", language: "es", timeZone: "America/Buenos_Aires", city: "Rosario", country: "AR" },
    map: null,
    points: [],
    sessions: [],
    review: {
      id: ID, status: "in_review", updatedAt, requestedAt: "2026-11-15T09:00:00.000Z", approvedAt: null, editedSinceApproval: false,
      organizer: { displayName: "Ada", email: "ada@example.com" },
    },
  });

  it("refuses an approval of a changed event and loads the new version", async () => {
    let version = 0;
    const approve = vi.fn((_u: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ updatedAt: "2026-11-15T10:00:00.000Z" });
      return json(errorBody("event_changed"), 409);
    });
    mockApi({
      "GET /auth/me": () => json({ organizer: admin, pendingCount: 1 }),
      [`GET /admin/events/${ID}/review`]: () => json(version++ === 0 ? review("2026-11-15T10:00:00.000Z") : review("2026-11-15T11:00:00.000Z", "Fiesta renombrada")),
      [`POST /admin/events/${ID}/approve`]: approve,
    });
    const user = userEvent.setup();
    open(`/panel/admin/review/${ID}`);
    await user.click(await screen.findByRole("button", { name: "Approve" }));
    const note = await screen.findByRole("alert");
    expect(note).toHaveTextContent(/changed since you opened it/i);
    await user.click(within(note).getByRole("button", { name: /Reload preview/ }));
    expect((await screen.findAllByText("Fiesta renombrada")).length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("counts the reason in code points and blocks Reject past 200", async () => {
    const reject = vi.fn(() => json({ event: { id: ID, status: "rejected", approvedAt: null }, pendingCount: 0 }));
    mockApi({
      "GET /auth/me": () => json({ organizer: admin, pendingCount: 1 }),
      [`GET /admin/events/${ID}/review`]: () => json(review("2026-11-15T10:00:00.000Z")),
      [`POST /admin/events/${ID}/reject`]: reject,
      "GET /admin/events/pending": () => json({ events: [], total: 0, nextCursor: null }),
    });
    const user = userEvent.setup();
    open(`/panel/admin/review/${ID}`);
    await user.click(await screen.findByRole("button", { name: /^Reject/ }));
    const dlg = await screen.findByRole("alertdialog");
    const box = within(dlg).getByRole("textbox");
    const confirm = within(dlg).getByRole("button", { name: "Don't approve" });
    // 200 emoji = 400 UTF-16 units but exactly 200 code points: allowed.
    await user.click(box);
    await user.paste("😀".repeat(200));
    expect(within(dlg).getByText("200/200")).toBeInTheDocument();
    expect(confirm).toBeEnabled();
    await user.paste("😀");
    expect(within(dlg).getByText("201/200")).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    expect(within(dlg).getByRole("alert")).toHaveTextContent(/too long/i);
    expect(reject).not.toHaveBeenCalled();
  });
});

describe("visitor", () => {
  it("shows the same unavailable page, with a way back home, for any 404 event", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(errorBody("event_not_found"), 404)));
    open("/e/draft-or-gone");
    expect(await screen.findByRole("heading", { name: "This event is no longer available" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See other events" })).toHaveAttribute("href", "/");
    await waitFor(() => expect(document.title).toMatch(/no longer available|not available/i));
  });
});
