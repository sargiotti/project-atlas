import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { errorBody, goTo, json } from "./fixtures";

// The browser pipeline (canvas, createImageBitmap) is covered by map-upload.test.ts (pure rules); here it is stubbed.
const pipeline = vi.hoisted(() => ({ inspect: vi.fn(), encode: vi.fn(), upload: vi.fn() }));
vi.mock("../src/lib/mapImage", () => ({ inspectImage: pipeline.inspect, encodeMap: pipeline.encode }));
vi.mock("../src/api/panelMap", async (orig) => ({ ...(await orig<typeof import("../src/api/panelMap")>()), uploadMap: pipeline.upload }));

const ID = "5b1c2d3e-0000-4000-8000-000000000001";
const MAP = {
  theme: "light",
  format: "webp",
  full: { url: "/media/maps/e1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-full.webp", width: 2400, height: 3200 },
  small: { url: "/media/maps/e1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-small.webp", width: 1200, height: 1600 },
  updatedAt: "2026-11-14T18:20:00.000Z",
};
const NEW_MAP = { ...MAP, small: { ...MAP.small, url: "/media/maps/e1/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb-small.webp" } };
const EV = {
  id: ID, slug: "fiesta-x7k2q9", status: "draft", name: "Fiesta de mi barrio", startDate: "2026-12-12", endDate: "2026-12-13",
  timeZone: "America/Buenos_Aires", city: "Rosario", country: "AR", language: "es", description: null, website: null, map: null,
  createdAt: "2026-11-14T10:00:00.000Z", updatedAt: "2026-11-14T10:00:00.000Z",
};
const me = { organizer: { id: "o1", displayName: "Ada", email: "s@example.com", role: "organizer" } };
const encoded = (theme = "light") => ({
  ok: true,
  value: { full: { blob: new Blob(["f"]), width: 2400, height: 3200 }, small: { blob: new Blob(["s"]), width: 1200, height: 1600 }, theme, ambiguous: false, format: "webp", meanL: 80 },
});

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
function mockApi(event: object, extra: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = { "GET /auth/me": () => json(me), [`GET /panel/events/${ID}`]: () => json({ event }), ...extra };
  const fn = vi.fn(async (input: any, init?: RequestInit) => {
    const h = routes[`${init?.method ?? "GET"} ${String(input).replace(/^.*\/api\/v1/, "")}`];
    return h ? h(String(input), init) : json(errorBody("event_not_found"), 404);
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
const open = () => {
  goTo(`/panel/events/${ID}`);
  return render(<I18nProvider initial="en"><Routes /></I18nProvider>);
};
const png = (name = "plano.png") => new File(["x"], name, { type: "image/png" });

beforeEach(() => {
  localStorage.clear();
  pipeline.inspect.mockReset();
  pipeline.encode.mockReset().mockResolvedValue(encoded());
  pipeline.upload.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  goTo("/");
});

describe("map upload card", () => {
  it("shows the reason for a rejected file and uploads nothing", async () => {
    pipeline.inspect.mockResolvedValue({ ok: false, error: { key: "errFormatPdf" } });
    mockApi(EV);
    const user = userEvent.setup();
    open();
    const input = await screen.findByLabelText("Choose image");
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg,image/webp,image/avif");
    await user.upload(input, png("mapa.png"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("mapa.png");
    expect(alert).toHaveTextContent("PDFs aren't supported yet");
    expect(screen.getByLabelText("Choose another image")).toHaveAttribute("aria-invalid", "true");
    expect(pipeline.upload).not.toHaveBeenCalled();
  });

  it("warns about a small image, uploads it after Use anyway and then shows the map and Done", async () => {
    pipeline.inspect.mockResolvedValue({ ok: true, value: { bitmap: {}, width: 1800, height: 2400, soft: true, format: "png" } });
    pipeline.upload.mockResolvedValue({ status: "ok", map: MAP });
    mockApi(EV);
    const user = userEvent.setup();
    open();
    await user.upload(await screen.findByLabelText("Choose image"), png());
    expect(await screen.findByText("It may look blurry when zoomed in.")).toBeInTheDocument();
    expect(pipeline.upload).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Use anyway" }));
    expect(await screen.findByText("Map uploaded", { selector: "p" })).toBeInTheDocument();
    expect(pipeline.upload).toHaveBeenCalledWith(ID, expect.objectContaining({ theme: "light" }), expect.anything());
    expect(screen.getByRole("img", { name: "Your map" })).toHaveAttribute("src", MAP.small.url);
    const step2 = screen.getByText("Upload the map").closest("li")!;
    expect(within(step2).getByText("Done")).toBeInTheDocument();
  });

  it("keeps the current map when a replacement fails to upload", async () => {
    pipeline.inspect.mockResolvedValue({ ok: true, value: { bitmap: {}, width: 2400, height: 3200, soft: false, format: "png" } });
    pipeline.upload.mockResolvedValue({ status: "error", key: "peMapNetT", retryable: true });
    mockApi({ ...EV, map: MAP });
    const user = userEvent.setup();
    open();
    await user.upload(await screen.findByLabelText("Replace map"), png());
    await user.click(await screen.findByRole("button", { name: "Replace map" })); // confirm dialog
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The new map didn't upload.");
    expect(alert).toHaveTextContent("Your current map is unchanged.");
    expect(screen.getByRole("img", { name: "Your map" })).toHaveAttribute("src", MAP.small.url);
  });

  it("replaces the map after the confirmation", async () => {
    pipeline.inspect.mockResolvedValue({ ok: true, value: { bitmap: {}, width: 2400, height: 3200, soft: false, format: "png" } });
    pipeline.upload.mockResolvedValue({ status: "ok", map: NEW_MAP });
    mockApi({ ...EV, map: MAP });
    const user = userEvent.setup();
    open();
    await user.upload(await screen.findByLabelText("Replace map"), png());
    expect(pipeline.upload).not.toHaveBeenCalled(); // nothing is sent before the organizer confirms
    await user.click(await screen.findByRole("button", { name: "Replace map" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Your map" })).toHaveAttribute("src", NEW_MAP.small.url));
  });

  it("saves a Map Theme change with PATCH", async () => {
    const patch = vi.fn(() => json({ map: { ...MAP, theme: "dark" } }));
    mockApi({ ...EV, map: MAP }, { [`PATCH /panel/events/${ID}/map/theme`]: patch });
    const user = userEvent.setup();
    open();
    const dark = await screen.findByRole("radio", { name: /Dark map/ });
    expect(screen.getByRole("radio", { name: /Light map/ })).toBeChecked();
    await user.click(dark);
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const init = (patch.mock.calls[0] as any)[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ theme: "dark" });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(dark).toBeChecked();
  });
});
