import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { bundle, errorBody, goTo, json, mockFetch } from "./fixtures";

function open(path = "/e/test-fest", lang: "en" | "es" | "da" = "en") {
  goTo(path);
  return render(
    <I18nProvider initial={lang}>
      <Routes />
    </I18nProvider>,
  );
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("map view", () => {
  it("tapping a point opens the sheet with name, category and description as plain text, and it can be closed", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole("button", { name: "Main Stage, Stage" }));

    const sheet = screen.getByRole("dialog", { name: "Main Stage" });
    expect(within(sheet).getByText("Stage")).toBeInTheDocument();
    // Event content is text, never HTML.
    expect(within(sheet).getByText("Headliners <b>from 20:00</b>.")).toBeInTheDocument();

    await user.click(within(sheet).getByRole("button", { name: "Close point details" }));
    expect(screen.queryByRole("dialog", { name: "Main Stage" })).not.toBeInTheDocument();
  });

  it("the list groups points by category in the fixed order and tapping one shows it on the map", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    open();
    await screen.findByRole("button", { name: "Main Stage, Stage" });

    await user.click(screen.getByRole("button", { name: "List" }));
    const headings = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings.findIndex((h) => h?.startsWith("Stage"))).toBeLessThan(headings.findIndex((h) => h?.startsWith("Food")));
    expect(headings.findIndex((h) => h?.startsWith("Food"))).toBeLessThan(headings.findIndex((h) => h?.startsWith("Toilets")));

    await user.click(screen.getByRole("button", { name: /Taco Truck/ }));

    // Back on the map with the point selected and its sheet open.
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("dialog", { name: "Taco Truck" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Taco Truck, Food" })).toHaveAttribute("aria-pressed", "true");
  });

  it("the Map/List switch stays usable while a sheet is open: List hides the sheet, Map brings it back", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    open();
    await user.click(await screen.findByRole("button", { name: "Main Stage, Stage" }));
    expect(screen.getByRole("dialog", { name: "Main Stage" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "List" }));
    expect(screen.queryByRole("dialog", { name: "Main Stage" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Map" }));
    expect(screen.getByRole("dialog", { name: "Main Stage" })).toBeInTheDocument();
  });

  it("the share dialog shows a link built from the origin and the slug, plus a QR code", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    open("/e/test-fest?utm=tracking#frag");
    await user.click(await screen.findByRole("button", { name: "Share" }));

    const dialog = screen.getByRole("dialog", { name: "Share this event" });
    expect(within(dialog).getByLabelText("Event link")).toHaveValue(`${window.location.origin}/e/test-fest`);
    expect(await within(dialog).findByRole("img", { name: "QR code with the event link" })).toBeInTheDocument();
  });
});

describe("error states", () => {
  it("shows a friendly page for an event that does not exist", async () => {
    mockFetch(() => json(errorBody("event_not_found"), 404));
    open("/e/nope-nope");
    expect(await screen.findByRole("heading", { name: "This event is no longer available" })).toBeInTheDocument();
  });

  it("does not even call the API for a malformed slug", async () => {
    const f = mockFetch(() => json(bundle));
    open("/e/Not_A_Slug!");
    expect(await screen.findByRole("heading", { name: "This event is no longer available" })).toBeInTheDocument();
    expect(f).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])("shows 'temporarily unavailable' (not a broken map) on %i, and retry recovers", async (status) => {
    let fail = true;
    const f = mockFetch(() => (fail ? json(errorBody("rate_limited"), status, { "Retry-After": "30" }) : json(bundle)));
    const user = userEvent.setup();
    open();

    expect(await screen.findByRole("heading", { name: "We are very busy right now" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /map/i })).not.toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("button", { name: "Main Stage, Stage" })).toBeInTheDocument();
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("treats a response that breaks the contract as unavailable, and a cross-origin image URL as unsafe", async () => {
    mockFetch(() => json({ ...bundle, points: [{ id: "x" }] }));
    const { unmount } = open();
    expect(await screen.findByRole("heading", { name: "We are very busy right now" })).toBeInTheDocument();
    unmount();

    const evil = { ...bundle, map: { ...bundle.map, image: { format: "svg", variants: [{ url: "https://evil.example/m.svg", width: 1 }] } } };
    mockFetch(() => json(evil));
    open();
    expect(await screen.findByRole("heading", { name: "We are very busy right now" })).toBeInTheDocument();
  });
});

describe("language", () => {
  it("the UI follows the chosen language and the selector changes it; event content stays as-is", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    open("/e/test-fest", "es");
    expect(await screen.findByRole("button", { name: "Lista" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Idioma/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "Dansk" }));
    expect(screen.getByRole("button", { name: "Liste" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("da");
    expect(localStorage.getItem("atlas.lang")).toBe("da");
    expect(screen.getByRole("heading", { level: 1, name: "Test Fest" })).toBeInTheDocument();
  });
});

describe("language menu", () => {
  it("opens in A-Z order with the current one checked, moves with the keyboard and a pick changes and stores the language", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    open("/e/test-fest", "es");
    await screen.findByRole("button", { name: "Lista" });
    const trigger = screen.getByRole("button", { name: "Idioma: Español" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const rows = screen.getAllByRole("menuitemradio");
    expect(rows.map((r) => r.textContent)).toEqual(["Català", "Dansk", "English", "Español"]);
    expect(screen.getByRole("menuitemradio", { name: "Español" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "Español" })).toHaveFocus();

    await user.keyboard("{ArrowDown}"); // wraps to the first row
    expect(screen.getByRole("menuitemradio", { name: "Català" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitemradio", { name: "English" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "List" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en");
    expect(localStorage.getItem("atlas.lang")).toBe("en");
    expect(screen.getByRole("button", { name: "Language: English" })).toHaveFocus();
  });

  it("Escape closes it without changing the language", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    open("/e/test-fest", "es");
    await screen.findByRole("button", { name: "Lista" });
    await user.click(screen.getByRole("button", { name: /Idioma/ }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(localStorage.getItem("atlas.lang")).toBeNull();
  });
});

describe("map intro hint", () => {
  const loadMap = (container: HTMLElement) => fireEvent.load(container.querySelector("img.map-image")!);

  it("shows once the map has loaded, follows the language, and a tap dismisses it for good (also after a reload)", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    const first = open("/e/test-fest", "es");
    const img = await waitFor(() => {
      const el = first.container.querySelector("img.map-image");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    fireEvent.load(img);
    expect(await screen.findByText(/^Explora a tu manera: mapa/)).toBeInTheDocument();
    expect(localStorage.getItem("atlas.mapIntro.v1")).toBeNull(); // written on dismissal, not on show

    // Keyboard only: any pointerdown would (by design) dismiss the hint.
    screen.getByRole("button", { name: /Idioma/ }).focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}"); // opens on Español; Down wraps to Català, then Dansk
    expect(screen.getByText(/^Udforsk på din måde: kort/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Liste" })); // the tap still works and dismisses
    expect(screen.queryByText(/^Udforsk/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Liste" })).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("atlas.mapIntro.v1")).toBe("1");

    first.unmount();
    const again = open("/e/test-fest", "en");
    await screen.findByRole("button", { name: "Main Stage, Stage" });
    loadMap(again.container);
    expect(screen.queryByText(/^Udforsk/)).not.toBeInTheDocument();
  });

  it("does not show when the marker is already set, and the close button dismisses it", async () => {
    mockFetch(() => json(bundle));
    const user = userEvent.setup();
    localStorage.setItem("atlas.mapIntro.v1", "1");
    const seen = open("/e/test-fest", "en");
    await screen.findByRole("button", { name: "Main Stage, Stage" });
    loadMap(seen.container);
    expect(screen.queryByText(/^Udforsk/)).not.toBeInTheDocument();
    seen.unmount();

    localStorage.clear();
    const fresh = open("/e/test-fest", "en");
    await screen.findByRole("button", { name: "Main Stage, Stage" });
    loadMap(fresh.container);
    await user.click(await screen.findByRole("button", { name: "Close hint" }));
    expect(screen.queryByText(/^Udforsk/)).not.toBeInTheDocument();
    expect(localStorage.getItem("atlas.mapIntro.v1")).toBe("1");
  });
});

describe("example event pill", () => {
  it("shows the example pill in the header for a demo event and not for a regular one", async () => {
    mockFetch(() => json({ ...bundle, event: { ...bundle.event, isDemo: true } }));
    const first = open();
    expect(await screen.findByText("Example")).toBeInTheDocument();
    first.unmount();

    mockFetch(() => json({ ...bundle, event: { ...bundle.event, isDemo: false } }));
    open();
    await screen.findByRole("button", { name: "Main Stage, Stage" });
    expect(screen.queryByText("Example")).not.toBeInTheDocument();
  });
});
