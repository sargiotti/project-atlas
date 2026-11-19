import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { bundle, goTo, json, mockFetch } from "./fixtures";

// Dublin is UTC+1 in July. Main Stage: Fri 19:00-20:30, 21:00-22:30, Sat 00:30-01:30 (Friday's grid), Sat 20:00-21:00.
function scheduleBundle(sessions?: unknown[]) {
  const s = (id: string, start: string, end: string, pointId = "main-stage") => ({ id, pointId, title: id.toUpperCase(), start, end });
  return {
    ...bundle,
    event: { ...bundle.event, timeZone: "Europe/Dublin", dayStart: "06:00" },
    sessions: sessions ?? [
      s("early", "2026-07-10T18:00:00Z", "2026-07-10T19:30:00Z"),
      s("headliner", "2026-07-10T20:00:00Z", "2026-07-10T21:30:00Z"),
      s("latenight", "2026-07-10T23:30:00Z", "2026-07-11T00:30:00Z"),
      s("saturday", "2026-07-11T19:00:00Z", "2026-07-11T20:00:00Z"),
      s("taco", "2026-07-11T19:30:00Z", "2026-07-11T20:30:00Z", "taco-truck"),
    ],
  };
}

async function openSchedule(at: string | null, lang: "en" | "es" | "da" = "en", data: unknown = scheduleBundle()) {
  const user = userEvent.setup();
  mockFetch(() => json(data));
  goTo(`/e/test-fest${at ? `?at=${at}` : ""}`);
  render(
    <I18nProvider initial={lang}>
      <Routes />
    </I18nProvider>,
  );
  const tab = await screen.findByRole("button", { name: lang === "es" ? "Programa" : lang === "da" ? "Program" : "Schedule" });
  await user.click(tab);
  return { user };
}

const block = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title},`) });

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("schedule grid", () => {
  it("opens on the day of ?at= with the running Session marked and a Now chip", async () => {
    await openSchedule("2026-07-10T22:00");
    expect(screen.getByRole("button", { name: "Fri 10" })).toHaveAttribute("aria-pressed", "true");
    expect(block("HEADLINER").getAttribute("aria-label")).toContain("Now");
    expect(block("EARLY").getAttribute("aria-label")).toContain("Ended");
    expect(screen.getByRole("heading", { name: "Main Stage" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Now/ })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument(); // no status line while something is on
  });

  it("files the after-midnight Session under Friday, and Saturday shows only its own places", async () => {
    const { user } = await openSchedule("2026-07-10T22:00");
    expect(block("LATENIGHT")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sat 11" }));
    expect(screen.queryByRole("button", { name: /^LATENIGHT,/ })).not.toBeInTheDocument();
    expect(block("SATURDAY")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Taco Truck" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Fri 10" }));
    expect(screen.queryByRole("heading", { name: "Taco Truck" })).not.toBeInTheDocument(); // no Sessions there on Friday
  });

  it("brings the visitor back to now with the Now chip after changing day", async () => {
    const { user } = await openSchedule("2026-07-10T22:00");
    await user.click(screen.getByRole("button", { name: "Sat 11" }));
    expect(screen.getByRole("button", { name: "Sat 11" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: /^Now/ }));
    expect(screen.getByRole("button", { name: "Fri 10" })).toHaveAttribute("aria-pressed", "true");
    expect(block("HEADLINER")).toBeInTheDocument();
  });

  // Status line before, after and between Sessions. `now` = whether the Now chip is offered; `day` = the pressed day tab.
  it.each([
    { name: "before the first Session", at: "2026-07-01T12:00", texts: ["Starts in 9 days", "Fri 10 Jul · 19:00"], day: "Fri 10", now: false, plain: true },
    { name: "after the last Session (blocks are not striped)", at: "2026-07-20T12:00", status: "This event has ended", now: false, plain: true },
    { name: "a quiet moment before another day's Session (weekday shown)", at: "2026-07-11T03:00", status: "Nothing on now · Next: Saturday 20:00", day: "Sat 11", now: true },
    { name: "a quiet moment before a same-day Session (no weekday)", at: "2026-07-11T10:00", status: /^Nothing on now · Next: 20:00$/, now: true },
  ] as any[])("status line $name", async ({ at, texts, status, day, now, plain }) => {
    await openSchedule(at);
    for (const t of texts ?? []) expect(screen.getByText(t)).toBeInTheDocument();
    if (status) expect(screen.getByRole("status")).toHaveTextContent(status);
    if (day) expect(screen.getByRole("button", { name: day })).toHaveAttribute("aria-pressed", "true");
    expect(!!screen.queryByRole("button", { name: /^Now/ })).toBe(now);
    if (plain) expect(block("EARLY").getAttribute("aria-label")).not.toContain("Ended");
  });

  it("opens the Point sheet on the tapped Session, then See on map centres that point on the map", async () => {
    const { user } = await openSchedule("2026-07-10T22:00");
    await user.click(block("EARLY")); // a finished Session: the sheet must open "Earlier" for it

    const sheet = screen.getByRole("dialog", { name: "Main Stage" });
    expect(sheet.querySelector(".sel")).not.toBeNull();
    expect(within(sheet).getByText("EARLY")).toBeInTheDocument();
    // The view switch is hidden by CSS on phones while a sheet is open here; the grid keeps the outlined block.
    expect(block("EARLY")).toHaveAttribute("aria-current", "true");

    await user.click(within(sheet).getByRole("button", { name: "See on map" }));
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("button", { name: "Main Stage, Stage" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("button", { name: "See on map" })).not.toBeInTheDocument();
  });

  it("hides the Schedule tab when the event has no Sessions", async () => {

    mockFetch(() => json(scheduleBundle([])));
    goTo("/e/test-fest");
    render(
      <I18nProvider initial="en">
        <Routes />
      </I18nProvider>,
    );
    await screen.findByRole("button", { name: "List" });
    expect(screen.queryByRole("button", { name: "Schedule" })).not.toBeInTheDocument();
  });

  it("ignores a bad ?at= and a tampered zoom value", async () => {
    localStorage.setItem("atlas.schedule.zoom", "<b>9</b>");
    await openSchedule("2026-13-45T99:99");
    // Real clock: the fixture event is long over, so the grid shows the ended line and Normal zoom.
    expect(screen.getByRole("status")).toHaveTextContent("This event has ended");
    expect(screen.getByRole("group", { name: "Schedule zoom" }).querySelectorAll(".lv i.on")).toHaveLength(2);
  });
});
