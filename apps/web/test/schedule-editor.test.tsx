import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { scheduleDraftKey } from "../src/lib/scheduleDraft";
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
// Two festival days in Buenos Aires (UTC-3, no DST): Sat 12 and Sun 13 December 2026, day starts at 06:00.
const EV = {
  id: ID, slug: "fiesta-x7k2q9", status: "draft", statusReason: null, requestedAt: null, approvedAt: null,
  name: "Fiesta de mi barrio", startDate: "2026-12-12", endDate: "2026-12-13", timeZone: "America/Buenos_Aires",
  city: "Rosario", country: "AR", language: "es", description: null, website: null, venueAddress: null, map: MAP,
  createdAt: T0, updatedAt: T0,
};
const organizer = { id: ORG, displayName: "Ada", email: "ada@example.com", role: "organizer" };
const STAGE = { id: "stage-1", name: "Plaza Stage", category: "stage", description: "", x: 0.4, y: 0.3 };
const LANDMARK = { id: "church-1", name: "San Pedro church", category: "landmark", description: "", x: 0.7, y: 0.6 };
// 20:00-21:00 local on Sat 12 = 23:00Z-00:00Z
const BAND_A = { id: "ses-a", pointId: "stage-1", title: "Band A", start: "2026-12-12T23:00:00Z", end: "2026-12-13T00:00:00Z" };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const h = routes[`${init?.method ?? "GET"} ${String(input).replace(/^.*\/api\/v1/, "")}`];
    return h ? h(String(input), init) : json(errorBody("event_not_found"), 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const page = (sessions: any[] = [], points: any[] = [STAGE, LANDMARK], updatedAt = T0) => ({
  sessions, points, dayStart: "06:00", window: { from: "2026-12-12T09:00:00Z", until: "2026-12-14T09:00:00Z" }, eventUpdatedAt: updatedAt,
});
const baseRoutes = (sessions: any[] = [], points: any[] = [STAGE, LANDMARK], event: any = EV, updatedAt = T0): Record<string, Handler> => ({
  "GET /auth/me": () => json({ organizer }),
  [`GET /panel/events/${ID}`]: () => json({ event }),
  [`GET /panel/events/${ID}/sessions`]: () => json(page(sessions, points, updatedAt)),
});
const PUT = `PUT /panel/events/${ID}/sessions`;
const saved = (sessions: any[], created: any[] = [], updatedAt = T1, points: any[] = [STAGE, LANDMARK]) => ({
  ...page(sessions, points, updatedAt), counts: { created: created.length, updated: 0, deleted: 0 }, created,
});
const open = (path = `/panel/events/${ID}/schedule`) => {
  localStorage.setItem("atlas.lang", "en");
  goTo(path);
  return render(<I18nProvider initial="en"><Routes /></I18nProvider>);
};
const putBody = (fn: ReturnType<typeof vi.fn>) => {
  const call = fn.mock.calls.find(([, init]) => (init as any)?.method === "PUT");
  return call ? JSON.parse((call[1] as any).body) : null;
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("atlas.scheduleOnboarding.v1", "1"); // the quests have their own test
});
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(window, "innerWidth", { value: 1024, configurable: true });
  goTo("/");
});

const pickPlace = async (user: ReturnType<typeof userEvent.setup>, name: RegExp | string) => user.click(await screen.findByRole("button", { name: new RegExp(typeof name === "string" ? name : name.source) }));
const nameField = () => screen.getByLabelText(/^(Show|Activity) name/);
const startField = () => screen.getByLabelText("Starts");
const endField = () => screen.getByLabelText("Ends");
// the shows of the open day (the timeline also repeats the titles, hidden from assistive tech)
const slist = () => screen.getByRole("list", { name: /^\S+ \d+$/ });
const clearAndType = async (user: ReturnType<typeof userEvent.setup>, el: HTMLElement, text: string) => {
  await user.clear(el);
  await user.type(el, text);
};

describe("small screens", () => {
  it("shows only the open-on-a-computer notice below 1024 px and loads nothing", async () => {
    Object.defineProperty(window, "innerWidth", { value: 800, configurable: true });
    const fetchMock = mockApi(baseRoutes());
    open();
    expect(await screen.findByText(/needs a bigger screen/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("/sessions"))).toHaveLength(0);
  });
});

describe("places", () => {
  it("lists only the saved stage and landmark places; none gives an empty state that links to the Points editor", async () => {
    mockApi(baseRoutes());
    open();
    expect(await screen.findByRole("button", { name: /Plaza Stage/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /San Pedro church/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Plaza Stage/ })).toHaveTextContent("Stage · 0 shows");
    expect(screen.getByRole("button", { name: /San Pedro church/ })).toHaveTextContent("Landmark · 0 activities");
  });

  it("with no places, says so and links to the Points editor", async () => {
    mockApi(baseRoutes([], []));
    open();
    expect(await screen.findByText("No stages or landmarks yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the Points editor" })).toHaveAttribute("href", `/panel/events/${ID}/points`);
  });

  it("opens on the place of the deep link and its first day with shows", async () => {
    mockApi(baseRoutes([{ ...BAND_A, id: "ses-sun", title: "Sunday set", start: "2026-12-13T23:00:00Z", end: "2026-12-14T00:00:00Z" }]));
    open(`/panel/events/${ID}/schedule?place=stage-1`);
    expect(await screen.findByRole("button", { name: /Sun 13/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(slist()).getByText("Sunday set")).toBeInTheDocument();
  });
});

describe("adding shows", () => {
  it("adds with Enter, then the next start is the previous end and the last length is kept", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    await pickPlace(user, "Plaza Stage");
    await user.type(nameField(), "Band A");
    await user.type(startField(), "2000");
    await user.click(screen.getByRole("button", { name: "1 h" }));
    expect(endField()).toHaveValue("21:00");
    await user.type(nameField(), "{Enter}");
    expect(await within(slist()).findByText("20:00–21:00")).toBeInTheDocument();
    // the form is ready for the next one
    expect(nameField()).toHaveValue("");
    expect(startField()).toHaveValue("21:00");
    await user.type(nameField(), "Band B{Enter}");
    expect(await within(slist()).findByText("21:00–22:00")).toBeInTheDocument();
    expect(startField()).toHaveValue("22:00");
    expect(screen.getByText("2 unsaved changes")).toBeInTheDocument();
  });

  it("forgives typed times (9pm, 21h, 2130) and says so in words for after midnight", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    await pickPlace(user, "Plaza Stage");
    await user.type(startField(), "9pm");
    await user.tab();
    expect(startField()).toHaveValue("21:00");
    await clearAndType(user, startField(), "0130");
    await user.tab();
    expect(startField()).toHaveValue("01:30");
    expect(screen.getByText(/After midnight: early on Sun 13/)).toBeInTheDocument();
    await clearAndType(user, startField(), "9.45");
    await user.tab();
    expect(startField()).toHaveValue("09:45");
    await clearAndType(user, startField(), "banana");
    await user.type(nameField(), "X{Enter}");
    expect(await screen.findByText("Type a time like 21:30.")).toBeInTheDocument();
  });

  it("labels an after-midnight show in that night's tab and says activity on landmarks", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    await pickPlace(user, "Plaza Stage");
    await user.type(nameField(), "Late DJ");
    await user.type(startField(), "0130");
    await user.click(screen.getByRole("button", { name: "1 h" }));
    await user.type(nameField(), "{Enter}");
    const row = await screen.findByRole("button", { name: /Edit Late DJ/ });
    expect(row).toHaveTextContent("01:30–02:30");
    expect(row).toHaveTextContent("Sat 12 01:30 (Sun)");
    await pickPlace(user, "San Pedro church");
    expect(screen.getByText("Add an activity")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add activity" })).toBeInTheDocument();
    expect(screen.getByText(/No activities on this day yet/)).toBeInTheDocument();
  });

  it("requires a name and a start, without adding anything", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    await pickPlace(user, "Plaza Stage");
    await user.click(screen.getByRole("button", { name: "Add show" }));
    expect(await screen.findByText("Give it a name.")).toBeInTheDocument();
    await user.type(nameField(), "Band A");
    await user.click(screen.getByRole("button", { name: "Add show" }));
    expect(await screen.findByText("When does it start?")).toBeInTheDocument();
    expect(screen.queryByText("1 unsaved change")).toBeNull();
  });
});

describe("overlaps", () => {
  it("blocks a show that overlaps, names the clash and offers one-click fixes; touching is allowed", async () => {
    mockApi(baseRoutes([BAND_A]));
    const user = userEvent.setup();
    open(`/panel/events/${ID}/schedule?place=stage-1`);
    await screen.findByText("Band A", { selector: "b" });
    await user.type(nameField(), "Band C");
    await user.type(startField(), "2030");
    await user.click(screen.getByRole("button", { name: "1 h" }));
    // 20:30-21:30 clashes with 20:00-21:00
    const clash = await screen.findByText(/Overlaps “Band A” \(20:00–21:00\)\. Two shows can’t be at Plaza Stage at the same time\./);
    expect(clash).toBeInTheDocument();
    await user.type(nameField(), "{Enter}");
    expect(screen.queryByText("1 unsaved change")).toBeNull(); // refused
    // the fix: start when Band A ends
    await user.click(screen.getByRole("button", { name: "Start at 21:00" }));
    expect(startField()).toHaveValue("21:00");
    expect(endField()).toHaveValue("22:00");
    expect(screen.queryByText(/Overlaps “Band A”/)).toBeNull();
    await user.type(nameField(), "{Enter}");
    expect(await screen.findByText("1 unsaved change")).toBeInTheDocument();
  });

  it("an end earlier than the start means the next morning; equal is refused", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    await pickPlace(user, "Plaza Stage");
    await user.type(nameField(), "Night set");
    await user.type(startField(), "2300");
    await user.type(endField(), "0100");
    await user.tab();
    expect(screen.getByText(/Length: 2 h/)).toBeInTheDocument();
    await clearAndType(user, endField(), "2300");
    await user.tab();
    expect(await screen.findByText("It has to end after it starts.")).toBeInTheDocument();
  });
});

describe("editing and deleting", () => {
  it("edits a show in place and deletes with Undo and no confirmation", async () => {
    mockApi(baseRoutes([BAND_A]));
    const user = userEvent.setup();
    open(`/panel/events/${ID}/schedule?place=stage-1`);
    await user.click(await screen.findByRole("button", { name: /Edit Band A, 20:00–21:00/ }));
    const title = screen.getByLabelText("Show name");
    await clearAndType(user, title, "Band A+");
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(await within(slist()).findByText("Band A+")).toBeInTheDocument();
    expect(screen.getByText("1 unsaved change")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete Band A+" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /Edit Band A\+/ })).toBeNull();
    expect(screen.getAllByText("Deleted “Band A+”").length).toBeGreaterThan(0);
    await user.click(document.querySelector(".ped-toast button") as HTMLElement);
    expect(await within(slist()).findByText("Band A+")).toBeInTheDocument();
  });
});

describe("What visitors see", () => {
  it("shows this place's shows from the unsaved state, in the visitors' sheet", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    await pickPlace(user, "Plaza Stage");
    await user.type(nameField(), "Band A");
    await user.type(startField(), "2000");
    await user.click(screen.getByRole("button", { name: "1 h" }));
    await user.type(nameField(), "{Enter}");
    const prev = screen.getByRole("complementary", { name: "What visitors see" });
    expect(await within(prev).findByText("Band A")).toBeInTheDocument();
    expect(within(prev).getByText(/Includes unsaved changes/)).toBeInTheDocument();
    expect(within(prev).queryByRole("button", { name: /calendar/i })).toBeNull();
  });
});

describe("saving", () => {
  it("sends the whole set without temporary ids, on Save and on Ctrl+S, then shows it as saved", async () => {
    const fetchMock = mockApi({
      ...baseRoutes(),
      [PUT]: () => json(saved([{ id: "srv-1", pointId: "stage-1", title: "Band A", start: "2026-12-12T23:00:00Z", end: "2026-12-13T00:00:00Z" }], [{ index: 0, id: "srv-1" }])),
    });
    const user = userEvent.setup();
    open();
    await pickPlace(user, "Plaza Stage");
    await user.type(nameField(), "Band A");
    await user.type(startField(), "2000");
    await user.click(screen.getByRole("button", { name: "1 h" }));
    await user.type(nameField(), "{Enter}");
    // Ctrl+S works from inside a field, too
    await user.type(nameField(), "{Control>}s{/Control}");
    await waitFor(() => expect(putBody(fetchMock)).not.toBeNull());
    expect(putBody(fetchMock)).toEqual({
      baseUpdatedAt: T0,
      sessions: [{ pointId: "stage-1", title: "Band A", start: "2026-12-12T23:00:00Z", end: "2026-12-13T00:00:00Z" }],
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ unsaved change/)).toBeNull();
    expect(localStorage.getItem(scheduleDraftKey(ORG, ID))).toBeNull();
  });

  it("saves a partial programme and sends nothing when there are no changes", async () => {
    const put = vi.fn(() => json(saved([])));
    mockApi({ ...baseRoutes(), [PUT]: put });
    open();
    const save = await screen.findByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(put).not.toHaveBeenCalled();
  });

  it("refuses a body over 1 MiB before sending, with a clear message", async () => {
    const put = vi.fn(() => json(saved([])));
    // 1000 one-minute shows with 300 four-byte characters each: about 1.2 MB once encoded
    const heavy = Array.from({ length: 1000 }, (_, i) => ({
      id: `s${i}`, pointId: "stage-1", title: `Show ${i}`, description: "\u{1F600}".repeat(300),
      start: new Date(Date.UTC(2026, 11, 12, 9, 0) + i * 120_000).toISOString().slice(0, 19) + "Z",
      end: new Date(Date.UTC(2026, 11, 12, 9, 1) + i * 120_000).toISOString().slice(0, 19) + "Z",
    }));
    mockApi({ ...baseRoutes(heavy), [PUT]: put });
    const user = userEvent.setup();
    open(`/panel/events/${ID}/schedule?place=stage-1`);
    await user.click(await screen.findByRole("button", { name: "Delete Show 0" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/over 1 MB/)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("on 409 offers reload, then the draft is rebased on the server's set with dropped shows counted", async () => {
    let loads = 0;
    const gone = { ...BAND_A, id: "ses-gone", pointId: "church-1", title: "Church tour", start: "2026-12-12T14:00:00Z", end: "2026-12-12T15:00:00Z" };
    mockApi({
      ...baseRoutes(),
      [`GET /panel/events/${ID}/sessions`]: () =>
        // the second load: someone added "Server show" and the church place no longer exists
        json(loads++ === 0 ? page([gone]) : page([{ ...BAND_A, id: "ses-server", title: "Server show" }], [STAGE], T1)),
      [PUT]: () => json(errorBody("event_changed"), 409),
    });
    const user = userEvent.setup();
    open(`/panel/events/${ID}/schedule?place=stage-1`);
    await user.type(await screen.findByLabelText(/^Show name/), "Mine");
    await user.type(startField(), "1800");
    await user.click(screen.getByRole("button", { name: "1 h" }));
    await user.type(nameField(), "{Enter}");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("This event changed elsewhere");
    expect(localStorage.getItem(scheduleDraftKey(ORG, ID))).not.toBeNull(); // the draft is kept before anything else
    await user.click(screen.getByRole("button", { name: "Reload" }));
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Recover your unsaved changes?");
    expect(dlg).toHaveTextContent("1 of your unsaved shows cannot be restored");
    await user.click(screen.getByRole("button", { name: "Restore changes" }));
    // server-only shows stay (union), my new show is back, the dropped one is counted and not sent
    expect(await within(slist()).findByText("Server show")).toBeInTheDocument();
    expect(within(slist()).getByText("Mine")).toBeInTheDocument();
    expect(screen.getByText(/1 unsaved shows were dropped/)).toBeInTheDocument();
  }, 20000);

  it("does not retry on 429: it waits for Retry-After and then lets the organizer save again", async () => {
    const put = vi.fn(() => json(errorBody("rate_limited"), 429, { "Retry-After": "3" }));
    mockApi({ ...baseRoutes([BAND_A]), [PUT]: put });
    const user = userEvent.setup();
    open(`/panel/events/${ID}/schedule?place=stage-1`);
    await user.click(await screen.findByRole("button", { name: "Delete Band A" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(/Try again in 3 seconds/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(put).toHaveBeenCalledTimes(1);
  });
});

describe("draft and leaving", () => {
  it("writes the unsaved programme scoped by organizer and event, and offers it back after a forced close", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    const first = open();
    await pickPlace(user, "Plaza Stage");
    await user.type(nameField(), "Band A");
    await user.type(startField(), "2000");
    await user.click(screen.getByRole("button", { name: "1 h" }));
    await user.type(nameField(), "{Enter}");
    await waitFor(() => expect(localStorage.getItem(scheduleDraftKey(ORG, ID))).not.toBeNull());
    const draft = JSON.parse(localStorage.getItem(scheduleDraftKey(ORG, ID))!);
    expect(draft.v).toBe(1);
    expect(draft.baseUpdatedAt).toBe(T0);
    expect(draft.sessions).toHaveLength(1);
    expect(draft.sessions[0].tmpId).toBeTruthy();
    expect(JSON.stringify(draft)).not.toMatch(/ada@example|token/);
    first.unmount();

    open();
    const dlg = await screen.findByRole("alertdialog");
    expect(dlg).toHaveTextContent("Recover your unsaved changes?");
    await user.click(screen.getByRole("button", { name: "Restore changes" }));
    expect(await screen.findByText("1 unsaved change")).toBeInTheDocument();
  });

  it("drops an invalid or tampered draft instead of offering it", async () => {
    localStorage.setItem(scheduleDraftKey(ORG, ID), JSON.stringify({ v: 1, savedAt: Date.now(), baseUpdatedAt: T0, sessions: [{ tmpId: "x", pointId: "stage-1", title: "T", start: "tomorrow", end: "later" }] }));
    mockApi(baseRoutes());
    open();
    await screen.findByRole("button", { name: /Plaza Stage/ });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(localStorage.getItem(scheduleDraftKey(ORG, ID))).toBeNull();
  });

  it("asks before leaving with unsaved changes, and not otherwise", async () => {
    mockApi(baseRoutes());
    const user = userEvent.setup();
    open();
    await pickPlace(user, "Plaza Stage");
    await user.click(screen.getByRole("link", { name: "Back to event" }));
    expect(screen.queryByRole("alertdialog")).toBeNull(); // nothing to lose
  });
});

describe("onboarding", () => {
  it("walks the three quests once and is not shown again", async () => {
    localStorage.removeItem("atlas.scheduleOnboarding.v1");
    mockApi(baseRoutes());
    const user = userEvent.setup();
    const first = open();
    expect(await screen.findByRole("region", { name: "QUEST 1 OF 3" })).toBeInTheDocument();
    await pickPlace(user, "Plaza Stage");
    expect(await screen.findByRole("region", { name: "QUEST 2 OF 3" })).toBeInTheDocument();
    await user.type(nameField(), "Band A");
    await user.type(startField(), "2000");
    await user.click(screen.getByRole("button", { name: "1 h" }));
    await user.type(nameField(), "{Enter}");
    expect(await screen.findByRole("region", { name: "QUEST 3 OF 3" })).toBeInTheDocument();
    await user.type(nameField(), "Band B{Enter}");
    expect(await screen.findByText("Lineup started!", { selector: "h2" })).toBeInTheDocument();
    first.unmount();
    mockApi(baseRoutes());
    open();
    await screen.findByRole("button", { name: /Plaza Stage/ });
    expect(screen.queryByRole("region", { name: /QUEST/ })).toBeNull();
  });
});

describe("event dates", () => {
  it("explains a refused date change with how many shows would fall outside", async () => {
    mockApi({
      "GET /auth/me": () => json({ organizer }),
      [`GET /panel/events/${ID}`]: () => json({ event: EV }),
      [`PUT /panel/events/${ID}`]: () => json({ error: { code: "sessions_outside_dates", message: "x", requestId: "r", count: 3 } }, 409),
    });
    const user = userEvent.setup();
    open(`/panel/events/${ID}/edit`);
    fireEvent.change(await screen.findByLabelText("Ends"), { target: { value: "2026-12-12" } });
    await user.click(screen.getAllByRole("button", { name: /^Save changes$/ })[0]!);
    expect(await screen.findByText(/These dates would leave 3 shows outside the event/)).toBeInTheDocument();
    // what was typed stays
    expect(screen.getByLabelText("Ends")).toHaveValue("2026-12-12");
  });
});

describe("visitors keep seeing organizer sessions", () => {
  it("the Point sheet lists a last-night, after-midnight show of an organizer-style bundle", async () => {
    const { default: SessionsPanel } = await import("../src/components/SessionsPanel");
    const { withTimes } = await import("../src/lib/schedule");
    const sessions = withTimes(
      [{ id: "ses-dj", pointId: "stage-1", title: "DJ <b>Night</b>", start: "2026-12-14T04:30:00Z", end: "2026-12-14T06:00:00Z", description: "late\nset" }],
      "America/Buenos_Aires",
      "06:00",
    );
    render(
      <I18nProvider initial="en">
        <SessionsPanel point={STAGE as any} event={{ slug: "x", name: "X", timeZone: "America/Buenos_Aires", dayStart: "06:00" }} sessions={sessions} atMs={Date.UTC(2026, 11, 13, 20, 0)} />
      </I18nProvider>,
    );
    // 01:30 on Mon 14 belongs to Sun 13's programme; rendered as text, never as HTML
    expect(await screen.findByText("DJ <b>Night</b>")).toBeInTheDocument();
    expect(screen.getByText(/01:30/)).toBeInTheDocument();
  });
});
