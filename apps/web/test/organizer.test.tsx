import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ORGANIZER_TURNSTILE_ACTION } from "@atlas/contract";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { pickVos } from "../src/i18n/detect";
import { errorBody, json } from "./fixtures";

// Cloudflare's widget is replaced: render() "solves" immediately with a fake token and reset() is observable.
const ts = vi.hoisted(() => ({ render: vi.fn(), reset: vi.fn(), remove: vi.fn() }));
vi.mock("../src/lib/turnstile", () => ({
  siteKey: "test-key",
  loadTurnstile: () => Promise.resolve(ts),
}));

import Organizers from "../src/pages/Organizers";
import AdminRequests from "../src/pages/panel/admin/AdminRequests";

const page = (vos = false, lang: "es" | "en" = "es") =>
  render(
    <I18nProvider initial={lang} vos={vos}>
      <Organizers />
    </I18nProvider>,
  );

const form = () => document.querySelector("form") as HTMLFormElement;
const field = (label: RegExp) => within(form()).getByLabelText(label);

async function fillValid(user: ReturnType<typeof userEvent.setup>) {
  await user.type(field(/^Tu nombre/), "Marta Ferrer");
  await user.type(field(/^Email/), "marta@ejemplo.com");
  await user.type(field(/^Nombre del evento/), "Fiestas de La Alameda");
}

beforeEach(() => {
  ts.render.mockReset().mockImplementation((_el: HTMLElement, opts: any) => {
    opts.callback("fake-token");
    return "widget-1";
  });
  ts.reset.mockReset();
  ts.remove.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("organizer form", () => {
  it("renders the widget with the organizer action and shows inline errors without sending anything", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(ts.render).toHaveBeenCalled());
    expect(ts.render.mock.calls[0][1]).toMatchObject({ sitekey: "test-key", action: ORGANIZER_TURNSTILE_ACTION });

    await user.click(within(form()).getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByText("Escribe tu nombre.")).toBeInTheDocument();
    expect(screen.getByText("Escribe tu email.")).toBeInTheDocument();
    expect(screen.getByText("Escribe el nombre del evento.")).toBeInTheDocument();
    expect(field(/^Tu nombre/)).toHaveAttribute("aria-invalid", "true");
    expect(fetchSpy).not.toHaveBeenCalled();

    await user.type(field(/^Tu nombre/), "Marta");
    await user.type(field(/^Email/), "sin-arroba");
    await user.type(field(/^Nombre del evento/), "Fiestas");
    await user.click(within(form()).getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByText(/Ese email no parece válido/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sends the contract body (honeypot empty, token, elapsed time) and then shows the success state", async () => {
    const fetchSpy = vi.fn(async () => json({ ok: true }, 201));
    vi.stubGlobal("fetch", fetchSpy);
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(ts.render).toHaveBeenCalled());
    await fillValid(user);
    await user.click(within(form()).getByRole("button", { name: "Enviar pedido" }));

    expect(await screen.findByRole("heading", { name: "¡Gracias! Te vamos a escribir." })).toBeInTheDocument();
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/organizer-requests");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ name: "Marta Ferrer", email: "marta@ejemplo.com", eventName: "Fiestas de La Alameda", website: "", turnstileToken: "fake-token", locale: "es" });
    expect(typeof body.elapsedMs).toBe("number");
    expect(form()).toBeNull(); // the form is replaced
  });

  it("explains a 429, keeps what was typed and asks Turnstile for a fresh token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(errorBody("rate_limited"), 429, { "Retry-After": "60" })));
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(ts.render).toHaveBeenCalled());
    await fillValid(user);
    await user.click(within(form()).getByRole("button", { name: "Enviar pedido" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/Recibimos muchos pedidos desde tu conexión/);
    expect(field(/^Tu nombre/)).toHaveValue("Marta Ferrer");
    expect(ts.reset).toHaveBeenCalledWith("widget-1");
  });

  it("points to contact@leyenda.ink when the daily cap is reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(errorBody("daily_cap_reached"), 429)));
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(ts.render).toHaveBeenCalled());
    await fillValid(user);
    await user.click(within(form()).getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("contact@leyenda.ink");
  });

  it("maps server-side field errors to inline messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "validation_error", message: "x", requestId: "r", fields: [{ path: "email", code: "invalid" }] } }, 400)),
    );
    const user = userEvent.setup();
    page();
    await waitFor(() => expect(ts.render).toHaveBeenCalled());
    await fillValid(user);
    await user.click(within(form()).getByRole("button", { name: "Enviar pedido" }));
    expect(await screen.findByText(/Ese email no parece válido/)).toBeInTheDocument();
    expect(ts.reset).toHaveBeenCalled();
  });
});

describe("Spanish variant", () => {
  it("uses vos for es-AR / es-UY and tú for every other Spanish", () => {
    expect(pickVos(["es-AR"])).toBe(true);
    expect(pickVos(["en-GB", "es-UY", "es-ES"])).toBe(true); // the first Spanish entry decides
    expect(pickVos(["es-ES", "es-AR"])).toBe(false);
    expect(pickVos(["es"])).toBe(false);
    expect(pickVos(["en-US", "da"])).toBe(false);
  });

  it("detects the variant from navigator.languages", () => {
    vi.spyOn(window.navigator, "languages", "get").mockReturnValue(["es-AR", "en"]);
    render(
      <I18nProvider initial="es">
        <Organizers />
      </I18nProvider>,
    );
    expect(screen.getAllByText("Pedí tu mapa").length).toBeGreaterThan(0);
    vi.restoreAllMocks();
  });
});

describe("admin requests list", () => {
  const row = (id: string, over: any = {}) => ({
    id, name: `Name ${id}`, email: `p${id}@example.com`, eventName: `Event ${id}`, eventDate: null, city: null, role: null, message: null,
    emailStatus: "sent", createdAt: 1763500000000, status: "pending", locale: "es", invitedAt: null, inviteExpiresAt: null, inviteState: null, ...over,
  });

  it("renders every field as text, builds mailto only from a valid email and loads more with the cursor", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("cursor=")) return json({ requests: [row("2")], nextCursor: null });
        return json({
          requests: [row("1", { name: "<b>Bold</b>", message: "see https://evil.example and www.evil.example", email: "not an email" }), row("3")],
          nextCursor: "1763500000000:3",
        });
      }),
    );
    const user = userEvent.setup();
    render(
      <I18nProvider initial="en">
        <AdminRequests />
      </I18nProvider>,
    );
    expect(await screen.findByText(/<b>Bold<\/b>/)).toBeInTheDocument(); // shown literally, not as HTML
    expect(screen.getByText("see https://evil.example and www.evil.example")).toBeInTheDocument();
    expect(document.querySelector(".req-msg a")).toBeNull(); // the message is never linkified
    expect(screen.queryByRole("link", { name: "not an email" })).toBeNull();
    expect(screen.getByRole("link", { name: "p3@example.com" })).toHaveAttribute("href", "mailto:p3@example.com");

    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Event 2")).toBeInTheDocument();
    expect(calls.at(-1)).toContain("cursor=1763500000000%3A3");
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});

describe("use-case example links", () => {
  it("links four cards to their example event and leaves the others without a link", () => {
    page(false, "en");
    const href = (name: string) => document.querySelector(`[data-usecase="${name}"] a`)?.getAttribute("href") ?? null;
    expect(href("fiestas")).toBe("/e/fiestas-la-alameda");
    expect(href("musica")).toBe("/e/nightfall-meadows");
    expect(href("carrera")).toBe("/e/havnelobet");
    expect(href("mercado")).toBe("/e/mercado-medieval-toledo");
    expect(href("congreso")).toBeNull();
    expect(href("escuela")).toBeNull();
    expect(screen.getAllByRole("link", { name: /See example/ })).toHaveLength(4);
  });
});
