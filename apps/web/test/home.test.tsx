import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { sortEvents } from "../src/lib/events";
import { errorBody, goTo, json } from "./fixtures";

const COVER = {
  url: "/media/covers/evt_now/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-full.webp",
  url800: "/media/covers/evt_now/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-800.webp",
  width: 1600,
  height: 1000,
  focal: { x: 0.3, y: 0.6 },
};

const ev = (slug: string, startDate: string, endDate: string, extra: any = {}) => ({
  slug,
  name: `Name ${slug}`,
  startDate,
  endDate,
  city: "Valencia",
  country: "ES",
  cover: null,
  tone: 0,
  nearby: false,
  ...extra,
});

const TODAY = "2026-11-13";

describe("sortEvents", () => {
  it("puts in-progress first, then upcoming by start, then ended most recently ended first", () => {
    const list = [
      ev("old", "2026-01-01", "2026-01-03"),
      ev("later", "2026-12-20", "2026-12-22"),
      ev("recent-ended", "2026-11-01", "2026-11-12"),
      ev("soon", "2026-11-14", "2026-11-15"),
      ev("today-single", "2026-11-13", "2026-11-13"),
      ev("running", "2026-11-10", "2026-11-20"),
    ];
    expect(sortEvents(list, TODAY).map((e) => e.slug)).toEqual([
      "running", // started earlier
      "today-single",
      "soon",
      "later",
      "recent-ended",
      "old",
    ]);
  });

  it("treats an event ending today as in progress and one that ended yesterday as ended; ties break by slug", () => {
    const list = [
      ev("b", "2026-11-14", "2026-11-14"),
      ev("a", "2026-11-14", "2026-11-14"),
      ev("ends-today", "2026-11-12", "2026-11-13"),
      ev("ended-yesterday", "2026-11-12", "2026-11-12"),
    ];
    expect(sortEvents(list, TODAY).map((e) => e.slug)).toEqual(["ends-today", "a", "b", "ended-yesterday"]);
  });
});

describe("sortEvents with nearby", () => {
  it("puts nearby first, keeping the date-state order inside each group", () => {
    const list = [
      ev("far-running", "2026-11-10", "2026-11-20"),
      ev("near-ended", "2026-01-01", "2026-01-03", { nearby: true }),
      ev("far-soon", "2026-11-14", "2026-11-15"),
      ev("near-later", "2026-12-20", "2026-12-22", { nearby: true }),
      ev("near-running", "2026-11-12", "2026-11-14", { nearby: true }),
      ev("near-soon", "2026-11-15", "2026-11-16", { nearby: true }),
    ];
    expect(sortEvents(list, TODAY).map((e) => e.slug)).toEqual([
      "near-running",
      "near-soon",
      "near-later",
      "near-ended",
      "far-running",
      "far-soon",
    ]);
  });
});

function openHome(handler: () => Response | Promise<Response>, lang: "en" | "es" | "da" = "en", path = "/") {
  const fn = vi.fn(async () => handler());
  // The billboard (slice 37) has its own tests; here it just answers "no events" and is not counted in `fn`.
  vi.stubGlobal("fetch", (url: any, init: any) => (String(url).startsWith("/api/v1/billboard") ? Promise.resolve(json({ windows: [] })) : (fn as any)(url, init)));
  goTo(path);
  render(
    <I18nProvider initial={lang}>
      <Routes />
    </I18nProvider>,
  );
  return fn;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 13, 12, 0, 0) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("home", () => {
  it("renders cards in order, each one a single link to /e/{slug}, with localized dates and country", async () => {
    openHome(() =>
      json([
        ev("past", "2026-07-09", "2026-07-12", { name: "Past Fest", city: "Galway", country: "IE" }),
        ev("now", "2026-11-13", "2026-11-13", {
          name: "Run Today",
          city: "København",
          country: "DK",
          cover: COVER,
        }),
      ]),
    );
    const links = await screen.findAllByRole("link", { name: /Run Today|Past Fest/ });
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/e/now", "/e/past"]);

    const today = links[0];
    expect(within(today).getByText("København, Denmark")).toBeInTheDocument();
    expect(within(today).getByText("Nov 13, 2026")).toBeInTheDocument();
    expect(within(today).queryByText("Ended")).not.toBeInTheDocument();
    const img = today.querySelector("img")!;
    // Home cards use only the 800 px file, lazily, with the focal point as object-position.
    expect(img).toHaveAttribute("src", COVER.url800);
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
    expect(img).toHaveStyle({ objectPosition: "30% 60%" });

    // Screen readers get the name first and the Ended state last; the visual badge is aria-hidden.
    expect(within(links[1]).getAllByText("Ended").filter((el) => !el.closest("[aria-hidden]"))).toHaveLength(1);
    expect(links[1].querySelector(".ecard-body")!.lastElementChild).toHaveClass("sr-only");
    expect(within(links[1]).getByText("Galway, Ireland")).toBeInTheDocument();
  });

  it("falls back to the colour cover when the cover image fails to load (e.g. replaced meanwhile)", async () => {
    openHome(() => json([ev("broken", "2026-12-01", "2026-12-02", { name: "Broken Cover Fest", tone: 5, cover: COVER })]));
    const link = await screen.findByRole("link", { name: /Broken Cover Fest/ });
    fireEvent.error(link.querySelector("img")!);
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector("svg.cv-fb rect")).toHaveAttribute("fill", "#C6EEF2"); // tone 5
  });

  it("event names are plain text, never HTML", async () => {
    openHome(() => json([ev("xss-fest", "2026-12-01", "2026-12-02", { name: "<b>Bold</b> Fest" })]));
    expect(await screen.findByText("<b>Bold</b> Fest")).toBeInTheDocument();
  });

  it("shows the empty state for 200 []", async () => {
    openHome(() => json([]), "es");
    expect(await screen.findByText("Todavía no hay eventos")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Name/ })).not.toBeInTheDocument();
  });

  it.each([
    ["429", () => json(errorBody("rate_limited"), 429, { "Retry-After": "60" })],
    ["500", () => json(errorBody("internal_error"), 500)],
  ])("shows the error state on a %s, and Retry reloads only when clicked", async (_status, failure) => {
    let n = 0;
    const fetchFn = openHome(() =>
      ++n === 1 ? failure() : json([ev("back-online", "2026-12-01", "2026-12-02", { name: "Back Online" })]),
    );
    const user = userEvent.setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load the events");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Back Online/ })).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("forwards a valid ?near= uppercased, and never forwards invalid values", async () => {
    const urls = async (path: string) => {
      const fn = openHome(() => json([]), "en", path);
      await screen.findByText("No events yet");
      return fn.mock.calls.map((c: any) => String(c[0]));
    };
    expect(await urls("/?near=es")).toEqual(["/api/v1/events?near=ES"]);
    cleanup();
    expect(await urls("/?near=none")).toEqual(["/api/v1/events?near=NONE"]);
    cleanup();
    expect(await urls("/?near=%3Cscript%3E")).toEqual(["/api/v1/events"]);
    cleanup();
    expect(await urls("/?near=ESP")).toEqual(["/api/v1/events"]);
    cleanup();
    expect(await urls("/")).toEqual(["/api/v1/events"]);
  });
});
