import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { matchZone } from "../src/lib/timeZones";
import { errorBody, goTo, json } from "./fixtures";

const ID = "5b1c2d3e-0000-4000-8000-000000000001";
const EV = {
  id: ID,
  slug: "fiesta-de-mi-barrio-x7k2q9",
  status: "draft",
  statusReason: null,
  requestedAt: null,
  approvedAt: null,
  name: "Fiesta de mi barrio",
  startDate: "2026-12-12",
  endDate: "2026-12-13",
  timeZone: "America/Buenos_Aires",
  city: "Rosario",
  country: "AR",
  language: "es",
  description: null,
  website: null,
  venueAddress: null,
  map: null,
  cover: null,
  createdAt: "2026-11-14T10:00:00.000Z",
  updatedAt: "2026-11-14T10:00:00.000Z",
};
const me = { organizer: { id: "o1", displayName: "Ada", email: "s@example.com", role: "organizer" } };

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(input).replace(/^.*\/api\/v1/, "")}`;
    const h = routes[key];
    if (!h) return json(errorBody("event_not_found"), 404);
    return h(String(input), init);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const base = { "GET /auth/me": () => json(me) };

function renderAt(path: string) {
  goTo(path);
  return render(
    <I18nProvider initial="en">
      <Routes />
    </I18nProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  goTo("/");
});

/** Fills every required field with valid values (the country through the picker). */
async function fillValid(user: ReturnType<typeof userEvent.setup>, name = "Noche de murgas") {
  fireEvent.change(screen.getByLabelText("Event name"), { target: { value: name } });
  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2027-02-13" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2027-02-14" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Montevideo" } });
  await user.click(screen.getByRole("button", { name: /^Country Choose/ }));
  fireEvent.change(screen.getByRole("combobox", { name: "Search country" }), { target: { value: "Urug" } });
  await user.keyboard("{Enter}");
}
const saveButton = () => screen.getAllByRole("button", { name: /^Save$/ })[0];

describe("create flow", () => {
  it("shows client errors next to the fields and offers a one-tap https fix, sending nothing while invalid", async () => {
    const posted: any[] = [];
    mockApi({ ...base, "POST /panel/events": (_u, init) => { posted.push(JSON.parse(String(init!.body))); return json({ event: EV }, 201); } });
    const user = userEvent.setup();
    renderAt("/panel/events/new");
    await screen.findByRole("heading", { name: "New event" });

    fireEvent.change(screen.getByLabelText("Event name"), { target: { value: "Fi" } });
    fireEvent.change(screen.getByLabelText(/Website/), { target: { value: "http://fiesta.com.ar" } });
    await user.click(saveButton());

    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent(/Check \d fields before saving/);
    expect(screen.getAllByText("Needs at least 3 characters (it has 2).").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Use a secure address/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fill in this field.").length).toBeGreaterThan(0);
    expect(posted).toHaveLength(0); // nothing leaves the browser while the form is invalid

    // The fix is a button the user taps, never applied silently.
    expect(screen.getByLabelText(/Website/)).toHaveValue("http://fiesta.com.ar");
    await user.click(screen.getByRole("button", { name: "Use https://fiesta.com.ar" }));
    expect(screen.getByLabelText(/Website/)).toHaveValue("https://fiesta.com.ar");
    expect(posted).toHaveLength(0);
  });

  it("saves a valid form once and lands on the hub", async () => {
    const posted: any[] = [];
    mockApi({
      ...base,
      "POST /panel/events": (_u, init) => {
        posted.push(JSON.parse(String(init!.body)));
        return json({ event: { ...EV, name: "Noche de murgas" } }, 201);
      },
      [`GET /panel/events/${ID}`]: () => json({ event: { ...EV, name: "Noche de murgas" } }),
    });
    const user = userEvent.setup();
    renderAt("/panel/events/new");
    await screen.findByRole("heading", { name: "New event" });
    await fillValid(user);
    fireEvent.change(screen.getByLabelText(/Website/), { target: { value: "https://fiesta.com.ar" } });
    await user.click(saveButton());

    expect(await screen.findByText("Draft saved")).toBeInTheDocument();
    expect(window.location.pathname).toBe(`/panel/events/${ID}`);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ name: "Noche de murgas", country: "UY", website: "https://fiesta.com.ar", description: null });
  });

  it("shows the server's field error next to the field and keeps what was typed", async () => {
    mockApi({
      ...base,
      "POST /panel/events": () =>
        json({ error: { code: "validation_error", message: "x", requestId: "r", fields: [{ path: "name", code: "control_chars" }] } }, 400),
    });
    const user = userEvent.setup();
    renderAt("/panel/events/new");
    await screen.findByRole("heading", { name: "New event" });
    await fillValid(user);
    await user.click(saveButton());

    expect((await screen.findAllByText("This text has characters that can't be used.")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Event name")).toHaveValue("Noche de murgas");
    expect(screen.getByLabelText("City")).toHaveValue("Montevideo");
    expect(window.location.pathname).toBe("/panel/events/new");
  });

  it("keeps the typed data when the server refuses the 11th event (409)", async () => {
    mockApi({
      ...base,
      "POST /panel/events": () => json(errorBody("event_limit_reached"), 409),
    });
    const user = userEvent.setup();
    renderAt("/panel/events/new");
    await screen.findByRole("heading", { name: "New event" });
    await fillValid(user);
    await user.click(saveButton());

    expect(await screen.findByText(/Not saved: you already have 10 events/)).toBeInTheDocument();
    expect(screen.getByLabelText("Event name")).toHaveValue("Noche de murgas");
    expect(screen.getByLabelText("City")).toHaveValue("Montevideo");
    expect(window.location.pathname).toBe("/panel/events/new");
    expect(saveButton()).toBeEnabled();
  });
});

describe("discard changes", () => {
  it("asks before leaving a dirty form; Esc and Keep editing stay, Discard leaves", async () => {
    mockApi({ ...base, [`GET /panel/events/${ID}`]: () => json({ event: EV }) });
    const user = userEvent.setup();
    renderAt(`/panel/events/${ID}/edit`);
    const name = await screen.findByLabelText("Event name");

    // Untouched form: leaving is free.
    expect(name).toHaveValue("Fiesta de mi barrio");
    await user.type(name, " 2027");

    await user.click(screen.getByRole("link", { name: "Fiesta de mi barrio" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Discard changes?" });
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).toHaveFocus();
    expect(window.location.pathname).toBe(`/panel/events/${ID}/edit`);

    await user.keyboard("{Escape}"); // Esc = keep editing
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(window.location.pathname).toBe(`/panel/events/${ID}/edit`);
    expect(screen.getByLabelText("Event name")).toHaveValue("Fiesta de mi barrio 2027");

    await user.click(screen.getByRole("link", { name: "Fiesta de mi barrio" }));
    await user.click(await screen.findByRole("button", { name: "Discard" }));
    await waitFor(() => expect(window.location.pathname).toBe(`/panel/events/${ID}`));
  });

  it("does not ask when nothing changed", async () => {
    mockApi({ ...base, [`GET /panel/events/${ID}`]: () => json({ event: EV }) });
    const user = userEvent.setup();
    renderAt(`/panel/events/${ID}/edit`);
    await screen.findByLabelText("Event name");
    await user.click(screen.getByRole("link", { name: "Fiesta de mi barrio" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe(`/panel/events/${ID}`));
  });
});

describe("delete", () => {
  it("stays disabled until the exact, case-sensitive name is typed, then deletes and returns to the list", async () => {
    const del = vi.fn(() => new Response(null, { status: 204 }));
    mockApi({
      ...base,
      [`GET /panel/events/${ID}`]: () => json({ event: EV }),
      [`DELETE /panel/events/${ID}`]: del,
      "GET /panel/events": () => json({ events: [] }),
    });
    const user = userEvent.setup();
    renderAt(`/panel/events/${ID}`);
    await user.click(await screen.findByRole("button", { name: "Delete…" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Delete this event?" });
    const input = within(dialog).getByRole("textbox");
    const confirm = within(dialog).getByRole("button", { name: "Delete forever" });
    expect(confirm).toBeDisabled();

    await user.type(input, "fiesta de mi barrio"); // wrong case
    expect(confirm).toBeDisabled();
    await user.clear(input);
    await user.type(input, "Fiesta de mi barri");
    expect(confirm).toBeDisabled();
    await user.type(input, "o  "); // trailing spaces are trimmed
    expect(confirm).toBeEnabled();
    expect(del).not.toHaveBeenCalled();

    await user.click(confirm);
    await waitFor(() => expect(del).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("heading", { name: "Create your first event" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/panel");
  });
});

describe("access", () => {
  it("goes to the login page on 401 and shows the same generic not found whether or not the event exists", async () => {
    mockApi({ ...base, [`GET /panel/events/${ID}`]: () => json(errorBody("unauthenticated"), 401) });
    renderAt(`/panel/events/${ID}`);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/panel/login");
    cleanup();
    vi.unstubAllGlobals();

    mockApi({ ...base });
    renderAt(`/panel/events/${ID}`);
    expect(await screen.findByRole("heading", { name: "This page does not exist" })).toBeInTheDocument();
  });
});

describe("owner preview", () => {
  const preview = (over: object) =>
    json({
      event: { slug: EV.slug, name: "Fiesta <b>de</b> mi barrio", startDate: "2026-12-12", endDate: "2026-12-13", language: "es", timeZone: "UTC", dayStart: "06:00", city: "Rosario", country: "AR", ...over },
      map: null,
      cover: null,
      points: [],
      sessions: [],
    });

  it("shows the draft band and Map coming soon, and links only an https website", async () => {
    mockApi({
      ...base,
      [`GET /panel/events/${ID}`]: () => json({ event: { ...EV, status: "draft" } }),
      [`GET /panel/events/${ID}/preview`]: () => preview({ description: "Mirá https://evil.example y <script>x</script>", website: "https://fiesta.com.ar/info" }),
    });
    renderAt(`/panel/events/${ID}/preview`);
    expect(await screen.findByText("Draft: only you can see this")).toBeInTheDocument();
    expect(screen.getByText("Map coming soon")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /share/i })).not.toBeInTheDocument();

    // Text stays text: no markup from the name, no link from a URL in the description.
    expect(screen.getAllByText("Fiesta <b>de</b> mi barrio").length).toBeGreaterThan(0);
    expect(document.querySelector("h1 b, h2 b")).toBeNull();
    expect(screen.getByText(/Mirá https:\/\/evil\.example/)).toBeInTheDocument();
    const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("http"));
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://fiesta.com.ar/info");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer nofollow ugc");

    // Esc closes the About sheet.
    expect(screen.getByRole("dialog", { name: "About the event" })).toBeInTheDocument();
    await userEvent.setup().keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "About the event" })).not.toBeInTheDocument();
  });

  it("renders no link for a stored value that is not https", async () => {
    mockApi({ ...base, [`GET /panel/events/${ID}/preview`]: () => preview({ website: "javascript:alert(1)" }) });
    renderAt(`/panel/events/${ID}/preview`);
    // The contract parse already refuses a non-https website, so the preview fails to load instead of rendering it.
    await screen.findByRole("button", { name: "Try again" });
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
  });
});

describe("venue address", () => {
  const putSpy = (puts: any[]) => (_u: string, init?: RequestInit) => {
    puts.push(JSON.parse(String(init!.body)));
    return json({ event: EV });
  };
  const saveChanges = () => screen.getAllByRole("button", { name: /^Save changes$/ })[0];

  it("saves an edited venue address, counting code points", async () => {
    const puts: any[] = [];
    mockApi({ ...base, [`GET /panel/events/${ID}`]: () => json({ event: { ...EV, venueAddress: "Calle Falsa 123" } }), [`PUT /panel/events/${ID}`]: putSpy(puts) });
    const user = userEvent.setup();
    renderAt(`/panel/events/${ID}/edit`);
    const field = await screen.findByLabelText(/Venue address/);
    expect(field).toHaveValue("Calle Falsa 123");
    fireEvent.change(field, { target: { value: "Av. Pellegrini 1500 \u{1F389}" } });
    expect(screen.getByText("21/120")).toBeInTheDocument(); // code points, not UTF-16 units
    await user.click(saveChanges());
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].venueAddress).toBe("Av. Pellegrini 1500 \u{1F389}");
  });

  it("clearing the venue address sends null", async () => {
    const puts: any[] = [];
    mockApi({ ...base, [`GET /panel/events/${ID}`]: () => json({ event: { ...EV, venueAddress: "Calle Falsa 123" } }), [`PUT /panel/events/${ID}`]: putSpy(puts) });
    const user = userEvent.setup();
    renderAt(`/panel/events/${ID}/edit`);
    await user.clear(await screen.findByLabelText(/Venue address/));
    await user.click(saveChanges());
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0].venueAddress).toBeNull();
  });

  it.each(["www.example.com", "visit https://spam.example"])("refuses %s with a clear message and sends nothing", async (bad) => {
    const put = vi.fn(() => json({ event: EV }));
    mockApi({ ...base, [`GET /panel/events/${ID}`]: () => json({ event: EV }), [`PUT /panel/events/${ID}`]: put });
    const user = userEvent.setup();
    renderAt(`/panel/events/${ID}/edit`);
    await user.type(await screen.findByLabelText(/Venue address/), bad);
    await user.click(saveChanges());
    expect((await screen.findAllByText(/Remove the link/)).length).toBeGreaterThan(0);
    expect(put).not.toHaveBeenCalled();
  });

  it("maps the server's address_has_url error onto the field", async () => {
    mockApi({
      ...base,
      [`GET /panel/events/${ID}`]: () => json({ event: EV }),
      [`PUT /panel/events/${ID}`]: () =>
        json({ error: { code: "validation_error", message: "x", requestId: "r", fields: [{ path: "venueAddress", code: "address_has_url" }] } }, 400),
    });
    const user = userEvent.setup();
    renderAt(`/panel/events/${ID}/edit`);
    await user.type(await screen.findByLabelText(/Venue address/), "Calle 1");
    await user.click(saveChanges());
    expect((await screen.findAllByText(/Remove the link/)).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/Venue address/)).toHaveValue("Calle 1");
  });

  it("shows in the owner preview with Maps, and Share only when published", async () => {
    const pv = {
      event: { slug: EV.slug, name: "Fiesta", startDate: "2026-12-12", endDate: "2026-12-13", language: "es", timeZone: "UTC", dayStart: "06:00", city: "Rosario", country: "AR", venueAddress: "Calle Falsa 123" },
      map: null,
      cover: null,
      points: [],
      sessions: [],
    };
    const status = { current: "published" };
    mockApi({
      ...base,
      [`GET /panel/events/${ID}`]: () => json({ event: { ...EV, status: status.current } }),
      [`GET /panel/events/${ID}/preview`]: () => json(pv),
    });
    const first = renderAt(`/panel/events/${ID}/preview`);
    const sheet = await screen.findByRole("dialog", { name: "About the event" }); // no map: opens by itself
    expect(within(sheet).getByText("Calle Falsa 123")).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Open in Google Maps" })).toBeInTheDocument();
    expect(await within(sheet).findByRole("button", { name: "Share" })).toBeInTheDocument();
    first.unmount();

    status.current = "draft";
    renderAt(`/panel/events/${ID}/preview`);
    const draft = await screen.findByRole("dialog", { name: "About the event" });
    await within(draft).findByText("Calle Falsa 123");
    expect(within(draft).queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });
});

describe("owner preview status bar", () => {
  const pv = {
    event: { slug: EV.slug, name: "Fiesta", startDate: "2026-12-12", endDate: "2026-12-13", language: "es", timeZone: "UTC", dayStart: "06:00", city: "Rosario", country: "AR" },
    map: null,
    cover: null,
    points: [],
    sessions: [],
  };
  const open = (status: string) => {
    mockApi({
      ...base,
      [`GET /panel/events/${ID}`]: () => json({ event: { ...EV, status } }),
      [`GET /panel/events/${ID}/preview`]: () => json(pv),
    });
    renderAt(`/panel/events/${ID}/preview`);
  };

  it.each([
    ["published", "Published: this is how visitors see it", /Draft: only you can see this/],
    ["in_review", "In review: only you and the Admin can see this", /Published: this is how/],
    ["rejected", "Not approved: only you can see this", /Draft: only you can see this/],
    ["draft", "Draft: only you can see this", /Published: this is how/],
  ])("shows the %s notice", async (status, region, other) => {
    open(status);
    expect(await screen.findByRole("region", { name: region })).toBeInTheDocument();
    expect(screen.queryByText(other)).not.toBeInTheDocument();
  });

  it("shows no draft notice while the status is still loading", async () => {
    mockApi({
      ...base,
      [`GET /panel/events/${ID}`]: () => new Promise(() => {}),
      [`GET /panel/events/${ID}/preview`]: () => json(pv),
    });
    renderAt(`/panel/events/${ID}/preview`);
    expect(await screen.findByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByText(/Draft/)).not.toBeInTheDocument();
  });
});

describe("time zone prefill", () => {
  it("maps modern browser names onto the fixed list", () => {
    expect(matchZone("Europe/Kyiv")).toBe("Europe/Kiev");
    expect(matchZone("Asia/Kolkata")).toBe("Asia/Calcutta");
    expect(matchZone("America/Argentina/Buenos_Aires")).toBe("America/Buenos_Aires");
    expect(matchZone("Asia/Ho_Chi_Minh")).toBe("Asia/Saigon");
    expect(matchZone("Europe/Madrid")).toBe("Europe/Madrid");
    expect(matchZone("Mars/Olympus_Mons")).toBeNull();
    expect(matchZone(undefined)).toBeNull();
  });

  it("prefills the form from the browser zone and shows the modern label for a legacy stored name", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: "Asia/Kolkata" } as any);
    mockApi({ ...base });
    renderAt("/panel/events/new");
    const tz = await screen.findByRole("button", { name: /Time zone/ });
    expect(tz).toHaveTextContent("Kolkata");
    expect(tz).not.toHaveTextContent("Calcutta");
    expect(screen.getByText("Detected in your browser")).toBeInTheDocument();
  });

  it("leaves the zone unselected when the browser zone has no match", async () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: "Mars/Olympus_Mons" } as any);
    mockApi({ ...base });
    renderAt("/panel/events/new");
    expect(await screen.findByRole("button", { name: /Time zone/ })).toHaveTextContent("Choose a time zone");
  });
});
