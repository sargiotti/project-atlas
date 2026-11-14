import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { pickPanelLang } from "../src/i18n/detect";
import { Routes } from "../src/App";
import { matchZone } from "../src/lib/timeZones";
import { errorBody, goTo, json } from "./fixtures";

const ID = "5b1c2d3e-0000-4000-8000-000000000001";
const EV = {
  id: ID,
  slug: "fiesta-de-mi-barrio-x7k2q9",
  status: "draft",
  name: "Fiesta de mi barrio",
  startDate: "2026-12-12",
  endDate: "2026-12-13",
  timeZone: "America/Buenos_Aires",
  city: "Rosario",
  country: "AR",
  language: "es",
  description: null,
  website: null,
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
  await user.type(screen.getByLabelText("Event name"), name);
  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2027-02-13" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2027-02-14" } });
  await user.type(screen.getByLabelText("City"), "Montevideo");
  await user.click(screen.getByRole("button", { name: /^Country Choose/ }));
  await user.type(screen.getByRole("combobox", { name: "Search country" }), "Urug");
  await user.keyboard("{Enter}");
}
const saveButton = () => screen.getAllByRole("button", { name: /Save draft/ })[0];

describe("create flow", () => {
  it("shows client errors next to the fields, offers a one-tap https fix, then saves and lands on the hub", async () => {
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

    await user.type(screen.getByLabelText("Event name"), "Fi");
    await user.type(screen.getByLabelText(/Website/), "http://fiesta.com.ar");
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

    await user.clear(screen.getByLabelText("Event name"));
    await fillValid(user);
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
  it("goes to the login page on 401 and shows a generic not found on 404", async () => {
    mockApi({ ...base, [`GET /panel/events/${ID}`]: () => json(errorBody("unauthenticated"), 401) });
    renderAt(`/panel/events/${ID}`);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/panel/login");
  });

  it("does not say whether an event exists", async () => {
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
      points: [],
      sessions: [],
    });

  it("shows the draft band and Map coming soon, and links only an https website", async () => {
    mockApi({
      ...base,
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
    await screen.findByText("Map coming soon");
    expect(document.querySelector("a[href^='javascript']")).toBeNull();
    expect(screen.queryByText(/alert/)).not.toBeInTheDocument();
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

describe("panel language", () => {
  it("uses the browser's en, es or da (language part), otherwise English", () => {
    expect(pickPanelLang(["da-DK", "en"])).toBe("da");
    expect(pickPanelLang(["es-AR"])).toBe("es");
    expect(pickPanelLang(["fr-FR", "de"])).toBe("en");
    expect(pickPanelLang([])).toBe("en");
  });
});
