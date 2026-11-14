import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { bundle, goTo, json, mockFetch } from "./fixtures";

const deviceZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;

function sessionsBundle(timeZone = "Europe/Dublin") {
  const s = (id: string, start: string, end: string, extra = {}) => ({ id, pointId: "main-stage", title: id.toUpperCase(), start, end, ...extra });
  return {
    ...bundle,
    event: { ...bundle.event, timeZone, dayStart: "06:00" },
    points: [...bundle.points, { id: "church", name: "Old Church", category: "landmark", description: "", x: 0.4, y: 0.4 }],
    // Dublin is UTC+1 in July. Fri 19:00-20:30, 21:00-22:30, Sat 00:30-01:30 (belongs to Friday), Sat 20:00-21:00.
    sessions: [
      s("early", "2026-07-10T18:00:00Z", "2026-07-10T19:30:00Z"),
      s("headliner", "2026-07-10T20:00:00Z", "2026-07-10T21:30:00Z", { description: "Big; loud, fun" }),
      s("latenight", "2026-07-10T23:30:00Z", "2026-07-11T00:30:00Z"),
      s("saturday", "2026-07-11T19:00:00Z", "2026-07-11T20:00:00Z"),
      { id: "mass", pointId: "church", title: "Sunday mass", start: "2026-07-12T09:00:00Z", end: "2026-07-12T10:00:00Z" },
    ],
  };
}

function open(path: string, data: unknown, lang: "en" | "es" | "da" = "en") {
  const fetchMock = mockFetch(() => json(data));
  goTo(path);
  render(
    <I18nProvider initial={lang}>
      <Routes />
    </I18nProvider>,
  );
  return fetchMock;
}

const AT = "/e/test-fest?at=2026-07-10T21:30"; // 21:30 Dublin: the headliner is running

async function openStage(path = AT, lang: "en" | "es" | "da" = "en", data: unknown = sessionsBundle()) {
  const user = userEvent.setup();
  const fetchMock = open(path, data, lang);
  await user.click(await screen.findByRole("button", { name: lang === "es" ? "Main Stage, Escenario" : "Main Stage, Stage" }));
  return { user, fetchMock, sheet: screen.getByRole("dialog", { name: "Main Stage" }) };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("point sheet with sessions", () => {
  it("shows Now with progress, Next below and earlier sessions collapsed, per ?at=", async () => {
    const { user, sheet } = await openStage();

    const hero = sheet.querySelector(".hero") as HTMLElement;
    expect(within(hero).getByText("Now")).toBeInTheDocument();
    expect(within(hero).getByText("HEADLINER")).toBeInTheDocument();
    expect(within(hero).getByText("1 h left")).toBeInTheDocument();
    expect(hero.querySelector(".prog i")).toHaveStyle({ width: "33%" });

    expect(within(sheet).getByText("LATENIGHT")).toBeInTheDocument();
    expect(within(sheet).queryByText("EARLY")).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: /Earlier \(1\)/ }));
    expect(within(sheet).getByText("EARLY")).toBeInTheDocument();
    expect(within(sheet).getByText("Ended")).toBeInTheDocument();
  });

  it("lists only this place's sessions and only the days that have some", async () => {
    const user = userEvent.setup();
    open(AT, sessionsBundle());
    await user.click(await screen.findByRole("button", { name: "Old Church, Landmark" }));
    const sheet = screen.getByRole("dialog", { name: "Old Church" });
    expect(within(sheet).getByText("Sunday mass")).toBeInTheDocument();
    expect(within(sheet).queryByText("HEADLINER")).not.toBeInTheDocument();
    expect(within(within(sheet).getByRole("group", { name: "Day" })).getAllByRole("button")).toHaveLength(1);
  });

  it("files an after-midnight session under the previous day with its weekday", async () => {
    const { sheet } = await openStage();
    // Two day chips (Fri, Sat), not three; Friday is open and the 00:30 set shows its weekday.
    expect(within(within(sheet).getByRole("group", { name: "Day" })).getAllByRole("button")).toHaveLength(2);
    expect(within(sheet).getByText("00:30 Sat")).toBeInTheDocument();
  });

  it("switches day with the chips", async () => {
    const { user, sheet } = await openStage();
    await user.click(within(within(sheet).getByRole("group", { name: "Day" })).getAllByRole("button")[1]!);
    expect(within(sheet).getByText("SATURDAY")).toBeInTheDocument();
    expect(within(sheet).queryByText("HEADLINER")).not.toBeInTheDocument();
  });

  it("names the event's city and zone only when the device zone differs", async () => {
    const other = deviceZone === "Europe/Madrid" ? "Europe/Dublin" : "Europe/Madrid";
    const first = await openStage(AT, "en", sessionsBundle(other));
    expect(within(first.sheet).getByText(`Times in ${other.split("/")[1]} local time (${other})`)).toBeInTheDocument();
  });

  it("shows no caption when the device is in the event's zone", async () => {
    const { sheet } = await openStage(AT, "en", sessionsBundle(deviceZone));
    expect(within(sheet).queryByText(/local time/)).not.toBeInTheDocument();
  });

  it("ignores an invalid ?at=, reflects nothing and adds nothing to requests", async () => {
    const { fetchMock } = await openStage("/e/test-fest?at=%3Cimg%20src=x%3E");
    expect(document.body.innerHTML).not.toContain("img src");
    for (const call of fetchMock.mock.calls) expect(String((call as any[])[0])).not.toContain("at=");
  });

  it("a valid ?at= is not sent with the bundle request either", async () => {
    const { fetchMock } = await openStage();
    for (const call of fetchMock.mock.calls) expect(String((call as any[])[0])).not.toContain("at=");
  });

  it("a point without sessions keeps the plain description sheet", async () => {
    const user = userEvent.setup();
    open(AT, sessionsBundle());
    await user.click(await screen.findByRole("button", { name: "Taco Truck, Food" }));
    const sheet = screen.getByRole("dialog", { name: "Taco Truck" });
    expect(within(sheet).getByText("Tacos and more.")).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: /calendar/i })).not.toBeInTheDocument();
  });

  it("translates the sheet strings", async () => {
    const { sheet } = await openStage(AT, "es");
    expect(within(sheet).getByText("Ahora")).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Añadir al calendario" })).toBeInTheDocument();
  });
});

describe("add to calendar", () => {
  it("offers a plain Google link and makes no request of its own", async () => {
    const { user, fetchMock, sheet } = await openStage();
    const before = fetchMock.mock.calls.length;
    await user.click(within(sheet).getByRole("button", { name: "Add to calendar" }));

    const link = within(screen.getByRole("menu")).getByRole("menuitem", { name: /Google Calendar/ });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const url = new URL(link.getAttribute("href")!);
    expect(url.origin + url.pathname).toBe("https://calendar.google.com/calendar/render");
    expect(url.searchParams.get("text")).toBe("HEADLINER — Main Stage");
    expect(url.searchParams.get("dates")).toBe("20260710T200000Z/20260710T213000Z");
    expect(url.searchParams.get("location")).toBe("Main Stage, Test Fest");
    expect(url.searchParams.get("details")).toContain("Big; loud, fun");
    expect(url.href).not.toContain("at=2026");
    expect(fetchMock.mock.calls.length).toBe(before);
  });

  it("downloads an escaped .ics through a Blob and revokes the object URL", async () => {
    let blob: Blob | undefined;
    (URL as any).createObjectURL = vi.fn((b: Blob) => ((blob = b), "blob:atlas-test"));
    const revoke = vi.fn();
    (URL as any).revokeObjectURL = revoke;
    let download = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      download = this.download;
    });
    const { user, sheet } = await openStage();
    await user.click(within(sheet).getByRole("button", { name: "Add to calendar" }));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: /Apple \/ Outlook/ }));

    expect(download).toBe("atlas-test-fest-headliner.ics");
    expect(blob?.type).toBe("text/calendar;charset=utf-8");
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(blob!);
    });
    expect(text).toContain("DESCRIPTION:Big\\; loud\\, fun");
    expect(text).toContain("UID:headliner@");
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:atlas-test"), { timeout: 2000 });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("Escape closes only the menu, not the sheet", async () => {
    const { user, sheet } = await openStage();
    await user.click(within(sheet).getByRole("button", { name: "Add to calendar" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Main Stage" })).toBeInTheDocument();
  });
});

describe("categories", () => {
  it("shows the landmark category", async () => {
    const user = userEvent.setup();
    open("/e/test-fest", sessionsBundle());
    await user.click(await screen.findByRole("button", { name: "Old Church, Landmark" }));
    expect(within(screen.getByRole("dialog", { name: "Old Church" })).getByText("Landmark")).toBeInTheDocument();
  });

  it("falls back to a generic marker for a category this build does not know instead of failing the bundle", async () => {
    const data = { ...bundle, points: [...bundle.points, { id: "zork", name: "Zork", category: "hologram", description: "", x: 0.1, y: 0.1 }] };
    open("/e/test-fest", data);
    expect(await screen.findByRole("button", { name: "Zork, Info" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Main Stage, Stage" })).toBeInTheDocument();
  });
});
