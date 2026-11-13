import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { sortEvents } from "../src/lib/events";
import { errorBody, goTo, json } from "./fixtures";

const ev = (slug: string, startDate: string, endDate: string, extra: any = {}) => ({
  slug,
  name: `Name ${slug}`,
  startDate,
  endDate,
  city: "Valencia",
  country: "ES",
  cover: null,
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

function openHome(handler: () => Response | Promise<Response>, lang: "en" | "es" | "da" = "en") {
  const fn = vi.fn(async () => handler());
  vi.stubGlobal("fetch", fn);
  goTo("/");
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
          cover: { url: "/covers/now.abcd1234.webp", width: 960, height: 640 },
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
    expect(img).toHaveAttribute("src", "/covers/now.abcd1234.webp");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("width", "960");

    // Screen readers get the name first and the Ended state last; the visual badge is aria-hidden.
    expect(within(links[1]).getAllByText("Ended").filter((el) => !el.closest("[aria-hidden]"))).toHaveLength(1);
    expect(links[1].querySelector(".ecard-body")!.lastElementChild).toHaveClass("sr-only");
    expect(within(links[1]).getByText("Galway, Ireland")).toBeInTheDocument();
  });

  it("shows a fallback tile instead of an image when the event has no cover", async () => {
    openHome(() => json([ev("nocover", "2026-12-01", "2026-12-02", { name: "No Cover Fest" })]));
    const link = await screen.findByRole("link", { name: /No Cover Fest/ });
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector(".cover-fallback")).not.toBeNull();
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

  it("shows the error state on 429, and Retry reloads only when clicked", async () => {
    let n = 0;
    const fetchFn = openHome(() =>
      ++n === 1
        ? json(errorBody("rate_limited"), 429, { "Retry-After": "60" })
        : json([ev("back-online", "2026-12-01", "2026-12-02", { name: "Back Online" })]),
    );
    const user = userEvent.setup();
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't load the events");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /Back Online/ })).toBeInTheDocument();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("shows the error state on a 500", async () => {
    openHome(() => json(errorBody("internal_error"), 500));
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
