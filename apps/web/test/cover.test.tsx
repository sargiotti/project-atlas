import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { clearCoverHandoff } from "../src/lib/coverHandoff";
import { errorBody, goTo, json } from "./fixtures";

// The browser pipeline (canvas, createImageBitmap) is stubbed; the pure rules are covered by cover-rules.test.ts.
const pipe = vi.hoisted(() => ({ inspect: vi.fn(), encode: vi.fn(), loadStored: vi.fn(), refocus: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock("../src/lib/coverImage", () => ({
  inspectCover: pipe.inspect,
  encodeCover: pipe.encode,
  loadStored: pipe.loadStored,
  refocusOg: pipe.refocus,
  drawCrop: () => {},
}));
vi.mock("../src/api/panelCover", async (orig) => ({
  ...(await orig<typeof import("../src/api/panelCover")>()),
  putCover: pipe.put,
  patchFocal: pipe.patch,
  deleteCover: pipe.del,
}));

const ID = "5b1c2d3e-0000-4000-8000-000000000001";
const VERSION = "a".repeat(32);
const COVER = {
  url: `/media/covers/${ID}/${VERSION}-full.webp`,
  url800: `/media/covers/${ID}/${VERSION}-800.webp`,
  width: 1600,
  height: 1000,
  focal: { x: 0.5, y: 0.5 },
  version: VERSION,
  updatedAt: "2026-11-15T10:00:00.000Z",
};
const EV = {
  id: ID, slug: "fiesta-x7k2q9", status: "draft", statusReason: null, requestedAt: null, approvedAt: null, name: "Fiesta de mi barrio",
  startDate: "2026-12-12", endDate: "2026-12-13", timeZone: "America/Buenos_Aires", city: "Rosario", country: "AR", language: "es",
  description: null, website: null, venueAddress: null, map: null, cover: null,
  createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z",
};
const me = { organizer: { id: "o1", displayName: "Ada", email: "s@example.com", role: "organizer" } };
const bitmap = () => ({ width: 2400, height: 1600, close: vi.fn() });
const goodInspect = () => ({ ok: true, value: { bitmap: bitmap(), width: 2400, height: 1600, soft: false, format: "jpeg" } });
const files = () => ({ ok: true, value: { full: new Blob(["f"]), small: new Blob(["s"]), og: new Blob(["o"]), width: 1600, height: 1000 } });
const pic = (name = "foto.jpg") => new File(["x"], name, { type: "image/jpeg" });

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(routes: Record<string, Handler>) {
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const h = routes[`${init?.method ?? "GET"} ${String(input).replace(/^.*\/api\/v1/, "")}`];
    return h ? h(String(input), init) : json(errorBody("event_not_found"), 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const base = { "GET /auth/me": () => json(me) };
const calls = (fn: ReturnType<typeof vi.fn>, key: string) => fn.mock.calls.filter(([u, i]) => `${(i as any)?.method ?? "GET"} ${String(u).replace(/^.*\/api\/v1/, "")}` === key);
const open = (path: string) => {
  goTo(path);
  return render(<I18nProvider initial="en"><Routes /></I18nProvider>);
};

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Event name"), "Noche de murgas");
  fireEvent.change(screen.getByLabelText("Starts"), { target: { value: "2027-02-13" } });
  fireEvent.change(screen.getByLabelText("Ends"), { target: { value: "2027-02-14" } });
  await user.type(screen.getByLabelText("City"), "Montevideo");
  await user.click(screen.getByRole("button", { name: /^Country Choose/ }));
  await user.type(screen.getByRole("combobox", { name: "Search country" }), "Urug");
  await user.keyboard("{Enter}");
}

beforeEach(() => {
  localStorage.clear();
  clearCoverHandoff();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null); // jsdom has no canvas; previews are not asserted
  for (const f of Object.values(pipe)) f.mockReset();
  pipe.inspect.mockResolvedValue(goodInspect());
  pipe.encode.mockResolvedValue(files());
  pipe.loadStored.mockResolvedValue(bitmap());
  pipe.refocus.mockResolvedValue(new Blob(["o2"]));
});
afterEach(() => {
  vi.unstubAllGlobals();
  goTo("/");
});

describe("cover in the create form", () => {
  const createRoutes = (extra: Record<string, Handler> = {}) => ({
    ...base,
    "POST /panel/events": () => json({ event: EV }, 201),
    [`GET /panel/events/${ID}`]: () => json({ event: EV }),
    ...extra,
  });

  it("picks a cover, sends nothing until Save, then creates the event once and uploads the cover", async () => {
    pipe.put.mockResolvedValue({ status: "ok", cover: COVER });
    const api = mockApi(createRoutes());
    const user = userEvent.setup();
    open("/panel/events/new");
    const input = await screen.findByLabelText("Choose image");
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/webp,image/avif");
    await user.upload(input, pic());

    // The local focal step: nothing was sent, and the point can be moved with the keyboard and the quick grid.
    const stage = await screen.findByRole("group", { name: /Focal point/ });
    expect(pipe.put).not.toHaveBeenCalled();
    expect(calls(api, "POST /panel/events")).toHaveLength(0);
    stage.focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Middle centre" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "Top left" }));
    expect(screen.getByRole("button", { name: "Top left" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("The cover uploads right after your event is created. Nothing is sent before that.")).toBeInTheDocument();

    await fillValid(user);
    await user.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => expect(window.location.pathname).toBe(`/panel/events/${ID}`));
    expect(calls(api, "POST /panel/events")).toHaveLength(1);
    expect(pipe.put).toHaveBeenCalledTimes(1);
    const [eventId, sent] = pipe.put.mock.calls[0];
    expect(eventId).toBe(ID);
    expect(sent).toMatchObject({ fx: 0.15, fy: 0.15 });
  });

  it("disables Save while the event is being created", async () => {
    let finish!: (r: Response) => void;
    mockApi(createRoutes({ "POST /panel/events": () => new Promise<Response>((r) => (finish = r)) }));
    pipe.put.mockResolvedValue({ status: "ok", cover: COVER });
    const user = userEvent.setup();
    open("/panel/events/new");
    await user.upload(await screen.findByLabelText("Choose image"), pic());
    await screen.findByRole("group", { name: /Focal point/ });
    await fillValid(user);
    await user.click(screen.getAllByRole("button", { name: "Save" })[0]);
    const busy = await screen.findAllByRole("button", { name: /Creating event, then uploading cover/ });
    for (const b of busy) expect(b).toBeDisabled();
    finish(json({ event: EV }, 201));
    await waitFor(() => expect(window.location.pathname).toBe(`/panel/events/${ID}`));
  });

  it("if the cover upload fails after the event exists: edit form with Try again / Skip, and the event is never created twice", async () => {
    pipe.put.mockResolvedValueOnce({ status: "error", key: "cvFailNet", retryable: true });
    const api = mockApi(createRoutes());
    const user = userEvent.setup();
    open("/panel/events/new");
    await user.upload(await screen.findByLabelText("Choose image"), pic());
    await screen.findByRole("group", { name: /Focal point/ });
    await fillValid(user);
    await user.click(screen.getAllByRole("button", { name: "Save" })[0]);

    await waitFor(() => expect(window.location.pathname).toBe(`/panel/events/${ID}/edit`));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your event was created, but the cover didn't upload.");
    expect(alert).toHaveTextContent("The upload didn't finish");
    const retry = within(alert).getByRole("button", { name: "Try again" });
    expect(within(alert).getByRole("button", { name: "Skip, add it later" })).toBeInTheDocument();

    pipe.put.mockResolvedValueOnce({ status: "ok", cover: COVER });
    await user.click(retry);
    await waitFor(() => expect(window.location.pathname).toBe(`/panel/events/${ID}`));
    expect(pipe.put).toHaveBeenCalledTimes(2);
    expect(pipe.put.mock.calls[1][0]).toBe(ID);
    expect(calls(api, "POST /panel/events")).toHaveLength(1); // never re-POSTed
  });

  it("Skip leaves for the hub without another upload", async () => {
    pipe.put.mockResolvedValueOnce({ status: "error", key: "cvFailServer", retryable: true });
    const api = mockApi(createRoutes());
    const user = userEvent.setup();
    open("/panel/events/new");
    await user.upload(await screen.findByLabelText("Choose image"), pic());
    await screen.findByRole("group", { name: /Focal point/ });
    await fillValid(user);
    await user.click(screen.getAllByRole("button", { name: "Save" })[0]);
    await user.click(await screen.findByRole("button", { name: "Skip, add it later" }));
    await waitFor(() => expect(window.location.pathname).toBe(`/panel/events/${ID}`));
    expect(pipe.put).toHaveBeenCalledTimes(1);
    expect(calls(api, "POST /panel/events")).toHaveLength(1);
  });
});

describe("cover errors", () => {
  const errors: [string, any, string][] = [
    ["too big", { key: "cvErrBig", mb: 31 }, "This image is too big (31 MB)."],
    ["wrong type", { key: "cvErrType" }, "This file type isn't supported."],
    ["too small", { key: "cvErrSmall", w: 800, h: 450 }, "This image is too small (800 × 450 px)."],
    ["can't read", { key: "cvErrDecode" }, "We couldn't read this image."],
    ["HEIC the browser can't open", { key: "cvErrHeic" }, "This browser can't open HEIC photos."],
  ];
  it.each(errors)("refuses an image that is %s with a clear message and keeps the colour cover", async (_n, error, text) => {
    pipe.inspect.mockResolvedValue({ ok: false, error });
    mockApi({ ...base });
    const user = userEvent.setup();
    open("/panel/events/new");
    await user.upload(await screen.findByLabelText("Choose image"), pic("malo.pdf"));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByLabelText("Choose image")).toBeInTheDocument(); // still on the empty drop zone
    expect(pipe.put).not.toHaveBeenCalled();
  });

  it("warns about a small image and continues with Use anyway", async () => {
    pipe.inspect.mockResolvedValue({ ok: true, value: { bitmap: bitmap(), width: 1280, height: 800, soft: true, format: "png" } });
    mockApi({ ...base });
    const user = userEvent.setup();
    open("/panel/events/new");
    await user.upload(await screen.findByLabelText("Choose image"), pic());
    expect(await screen.findByRole("alert")).toHaveTextContent("This image is a bit small (1280 px wide).");
    await user.click(screen.getByRole("button", { name: "Use anyway" }));
    expect(await screen.findByRole("group", { name: /Focal point/ })).toBeInTheDocument();
  });
});

describe("cover in the edit form", () => {
  const withCover = { ...EV, cover: COVER };
  const routes = (ev = withCover) => ({ ...base, [`GET /panel/events/${ID}`]: () => json({ event: ev }) });

  it("replaces the cover: the old one stays until Save cover", async () => {
    pipe.put.mockResolvedValue({ status: "ok", cover: { ...COVER, version: "b".repeat(32) } });
    mockApi(routes());
    const user = userEvent.setup();
    open(`/panel/events/${ID}/edit`);
    await screen.findByRole("button", { name: "Replace image" });
    await user.upload(screen.getByLabelText("Replace image", { selector: "input" }), pic("nueva.jpg"));
    await screen.findByRole("group", { name: /Focal point/ });
    expect(pipe.put).not.toHaveBeenCalled(); // picking only opens the local step
    await user.click(screen.getByRole("button", { name: "Save cover" }));
    await waitFor(() => expect(pipe.put).toHaveBeenCalledTimes(1));
    expect(pipe.put.mock.calls[0][0]).toBe(ID);
    expect(await screen.findByText(/Cover saved\./)).toBeInTheDocument();
  });

  it("changes only the focal point: one small upload, and only when Save focal point is pressed", async () => {
    pipe.patch.mockResolvedValue({ status: "ok", cover: { ...COVER, focal: { x: 0.85, y: 0.85 } } });
    mockApi(routes());
    const user = userEvent.setup();
    open(`/panel/events/${ID}/edit`);
    await user.click(await screen.findByRole("button", { name: "Change focal point" }));
    await screen.findByRole("group", { name: /Focal point/ });
    await user.click(screen.getByRole("button", { name: "Bottom right" }));
    await user.click(screen.getByRole("button", { name: "Top left" }));
    await user.click(screen.getByRole("button", { name: "Bottom right" }));
    expect(pipe.patch).not.toHaveBeenCalled(); // never per click
    expect(pipe.put).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save focal point" }));
    await waitFor(() => expect(pipe.patch).toHaveBeenCalledTimes(1));
    expect(pipe.patch.mock.calls[0][1]).toMatchObject({ fx: 0.85, fy: 0.85, baseVersion: VERSION });
    expect(pipe.put).not.toHaveBeenCalled();
  });

  it("keeps the old cover and says so when the upload fails; Try again re-sends", async () => {
    pipe.put.mockResolvedValueOnce({ status: "rate_limited", kind: "minute", retryAfter: 40, key: "cvFailRateMin" });
    mockApi(routes({ ...withCover, status: "published" }));
    const user = userEvent.setup();
    open(`/panel/events/${ID}/edit`);
    await screen.findByRole("button", { name: "Replace image" });
    await user.upload(screen.getByLabelText("Replace image", { selector: "input" }), pic());
    await screen.findByRole("group", { name: /Focal point/ });
    await user.click(screen.getByRole("button", { name: "Save cover" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't save the cover.");
    expect(alert).toHaveTextContent("about 40 s");
    expect(alert).toHaveTextContent("Your previous cover is still the one people see.");
    pipe.put.mockResolvedValueOnce({ status: "ok", cover: COVER });
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(pipe.put).toHaveBeenCalledTimes(2));
    expect(pipe.encode).toHaveBeenCalledTimes(1); // the same encoded files are re-sent
  });

  it("removes the cover only after a confirmation that shows the colour cover", async () => {
    pipe.del.mockResolvedValue({ status: "ok" });
    mockApi(routes());
    const user = userEvent.setup();
    open(`/panel/events/${ID}/edit`);
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    const dlg = await screen.findByRole("alertdialog", { name: "Remove the cover?" });
    expect(pipe.del).not.toHaveBeenCalled();
    expect(dlg.querySelector("svg.cv-fb")).not.toBeNull(); // what it switches to
    await user.click(within(dlg).getByRole("button", { name: "Keep cover" }));
    expect(pipe.del).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    await user.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remove cover" }));
    await waitFor(() => expect(pipe.del).toHaveBeenCalledWith(ID));
    expect(await screen.findByLabelText("Choose image")).toBeInTheDocument();
  });
});

describe("hub", () => {
  it("suggests a cover (optional, not blocking) while there is none and shows the cover in the hero once there is one", async () => {
    mockApi({ ...base, [`GET /panel/events/${ID}`]: () => json({ event: EV }) });
    const { unmount } = open(`/panel/events/${ID}`);
    const sugg = (await screen.findByText("Add a cover")).closest(".pe-sugg") as HTMLElement;
    expect(within(sugg).getByText("Optional")).toBeInTheDocument();
    expect(within(sugg).getByRole("link", { name: "Add" })).toHaveAttribute("href", `/panel/events/${ID}/edit?focus=cover`);
    unmount();

    mockApi({ ...base, [`GET /panel/events/${ID}`]: () => json({ event: { ...EV, cover: COVER } }) });
    const { container } = open(`/panel/events/${ID}`);
    await screen.findByRole("heading", { name: "Fiesta de mi barrio" });
    expect(screen.queryByText("Add a cover")).not.toBeInTheDocument();
    expect(container.querySelector(".pe-hhero img")).toHaveAttribute("src", COVER.url);
  });
});
