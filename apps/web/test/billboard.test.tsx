import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { goTo, json } from "./fixtures";

const ev = (slug: string, extra: any = {}) => ({
  slug,
  name: `Name ${slug}`,
  startDate: "2026-11-14",
  endDate: "2026-11-15",
  city: "Valencia",
  country: "ES",
  cover: null,
  tone: 0,
  nearby: false,
  isDemo: false,
  ...extra,
});

const BOARD = {
  windows: [
    { id: "now", events: [ev("run-now", { nearby: true })] },
    { id: "weekend", events: [ev("wk-a", { isDemo: true }), ev("wk-b")] },
    { id: "later", events: [ev("far-away", { country: "DK", city: "København" })] },
  ],
};

type Handler = (url: string, init?: any) => Response | Promise<Response>;

function openHome(board: Handler, lang: "en" | "es" = "en") {
  const calls: { url: string; signal?: AbortSignal }[] = [];
  const fn = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    if (u.startsWith("/api/v1/billboard")) {
      calls.push({ url: u, signal: init?.signal });
      return board(u, init);
    }
    return json([]); // the plain event list below the billboard
  });
  vi.stubGlobal("fetch", fn);
  goTo("/");
  render(
    <I18nProvider initial={lang}>
      <Routes />
    </I18nProvider>,
  );
  return calls;
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rail = () => document.querySelector<HTMLElement>(".rail")!;

describe("home billboard", () => {
  it("renders the windows in order with their events, and the CTA card always last", async () => {
    openHome(() => json(BOARD));
    await screen.findByRole("link", { name: /Name run-now/ });
    const hrefs = within(rail()).getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/e/run-now", "/e/wk-a", "/e/wk-b", "/e/far-away", "/organizadores"]);

    const nav = screen.getByRole("navigation", { name: "Jump to" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Now 1", "This weekend 2", "Coming up 1"]);

    const cta = within(rail()).getAllByRole("link").at(-1)!;
    expect(cta).toHaveTextContent("Organizing something?");
    expect(cta).toHaveTextContent("Add your event");
    // Nearby event: the accessible name carries "Near you"; and since one is near, there is no "nothing near" line.
    expect(screen.getByRole("link", { name: /Name run-now.*Near you/ })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing near you yet/)).not.toBeInTheDocument();
  });

  it("shows the Example pill only on demo events", async () => {
    openHome(() => json(BOARD));
    const demo = await screen.findByRole("link", { name: /Name wk-a/ });
    expect(demo).toHaveAccessibleName(/Example event/);
    expect(within(demo).getByText("Example event")).toBeInTheDocument();
    const real = screen.getByRole("link", { name: /Name wk-b/ });
    expect(real).not.toHaveAccessibleName(/Example/);
    expect(within(real).queryByText("Example event")).not.toBeInTheDocument();
  });

  it("with zero events shows the CTA card alone (no trail), and says when nothing is near", async () => {
    openHome(() => json({ windows: [] }));
    const cta = await screen.findByRole("link", { name: /Add your event/ });
    expect(cta).toHaveTextContent("Nothing on yet. Be the first!");
    expect(cta).toHaveAttribute("href", "/organizadores");
    expect(within(rail()).getAllByRole("link")).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Jump to" })).not.toBeInTheDocument();
  });

  it("says nothing is near when no event is nearby, but still shows every event", async () => {
    openHome(() => json({ windows: [{ id: "later", events: [ev("alpha"), ev("bravo")] }] }));
    expect(await screen.findByText(/Nothing near you yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Name alpha/ })).toBeInTheDocument();
  });

  it("changing the place refetches with ?place= and aborts the previous request; the id is remembered", async () => {
    const user = userEvent.setup();
    let release: (r: Response) => void = () => {};
    const calls = openHome((u) => (u.includes("place=") ? new Promise<Response>((res) => (release = res)) : json(BOARD)));
    await screen.findByRole("link", { name: /Name run-now/ });
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/billboard"]);

    const select = screen.getByRole("combobox", { name: /Choose the place/ });
    // Names come from the static list in the UI language, and there is no free text.
    expect(within(select).getAllByRole("option").map((o) => o.textContent)).toContain("Copenhagen");
    await user.selectOptions(select, "copenhagen");
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].url).toBe("/api/v1/billboard?place=copenhagen");
    expect(calls[1].signal!.aborted).toBe(false);
    expect(localStorage.getItem("atlas.place")).toBe("copenhagen");

    // A second pick while the first is in flight aborts it.
    await user.selectOptions(select, "galway");
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls[1].signal!.aborted).toBe(true);
    expect(calls[2].url).toBe("/api/v1/billboard?place=galway");
    release(json(BOARD));
  });

  it("ignores a stored place that is not in the contract list", async () => {
    localStorage.setItem("atlas.place", "<script>");
    const calls = openHome(() => json(BOARD));
    await screen.findByRole("link", { name: /Name run-now/ });
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/billboard"]);
  });

  it("shows a retry when the billboard fails, without breaking the page", async () => {
    const user = userEvent.setup();
    let n = 0;
    const calls = openHome(() => (++n === 1 ? json({ error: { code: "internal_error", message: "x", requestId: "r" } }, 500) : json(BOARD)));
    expect(await screen.findByText("We couldn't load the billboard.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Name run-now/ })).toBeInTheDocument();
    expect(calls).toHaveLength(2);
  });

  it("renders the Spanish copy", async () => {
    openHome(() => json({ windows: [{ id: "weekend", events: [ev("alpha")] }] }), "es");
    expect(await screen.findByRole("heading", { name: "Qué hay" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Este finde/ })).toBeInTheDocument();
  });
});
