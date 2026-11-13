import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { matchesQuery, normalize, queryWords } from "../src/lib/search";
import { goTo, json } from "./fixtures";

const ev = (slug: string, name: string, city: string, country: string, startDate: string, endDate: string, nearby = false) => ({
  slug, name, city, country, startDate, endDate, cover: null, nearby,
});
const EVENTS = [
  ev("havnelobet", "Havneløbet 2026", "København", "DK", "2026-11-13", "2026-11-13"),
  ev("fiestas", "Fiestas del Barrio de la Alameda 2026", "Valencia", "ES", "2026-12-04", "2026-12-07"),
  ev("nightfall", "Nightfall Meadows Festival 2026", "Galway", "IE", "2026-07-09", "2026-07-12"),
];
const ORDER = ["Havneløbet 2026", "Fiestas del Barrio de la Alameda 2026", "Nightfall Meadows Festival 2026"];

describe("normalize / matchesQuery", () => {
  const dk = { name: "Havneløbet 2026", city: "København", country: "DK" };
  const es = { name: "Fiesta", city: "Valencia", country: "ES" };
  const m = (e: any, q: string) => matchesQuery(e, queryWords(q));

  it("folds case, accents and special letters", () => {
    expect(normalize("København Ærø Straße Łódź Đà Ñandú ÅLESUND")).toBe("kobenhavn aero strasse lodz da nandu alesund");
  });
  it("matches substrings, and all words (AND) against name, city or country", () => {
    expect(m(dk, "havne")).toBe(true);
    expect(m(dk, "KOBENHAVN")).toBe(true);
    expect(m(dk, "københavn denmark")).toBe(true);
    expect(m(dk, "kobenhavn spain")).toBe(false);
  });
  it("matches the country in en, es and da regardless of UI language", () => {
    for (const q of ["spain", "espana", "españa", "spanien", "es"]) expect(m(es, q)).toBe(true);
    for (const q of ["denmark", "dinamarca", "danmark"]) expect(m(dk, q)).toBe(true);
  });
  it("an empty query matches everything; regex-like input is plain text", () => {
    expect(m(dk, "   ")).toBe(true);
    expect(() => m(dk, "(a+)+$")).not.toThrow();
    expect(m(dk, "(")).toBe(false);
    expect(m(dk, "(a+)+$")).toBe(false);
  });
});

function openHome(lang: "en" | "es" | "da" = "en", path = "/") {
  const fn = vi.fn(async () => json(EVENTS));
  vi.stubGlobal("fetch", fn);
  goTo(path);
  render(
    <I18nProvider initial={lang}>
      <Routes />
    </I18nProvider>,
  );
  return fn;
}
const names = () => screen.queryAllByRole("heading", { level: 3 }).map((h) => h.textContent);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 13, 12, 0, 0) });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  goTo("/");
});

describe("home search", () => {
  it("filters as the user types, with no extra request and nothing in URL or storage", async () => {
    const fetchFn = openHome();
    const box = await screen.findByRole("searchbox", { name: "Search events" });
    const user = userEvent.setup();
    expect(names()).toEqual(ORDER);

    await user.type(box, "havne");
    expect(names()).toEqual(["Havneløbet 2026"]);
    await user.clear(box);
    await user.type(box, "kobenhavn");
    expect(names()).toEqual(["Havneløbet 2026"]);
    await user.clear(box);
    await user.type(box, "København");
    expect(names()).toEqual(["Havneløbet 2026"]);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("");
    expect(localStorage.length).toBe(0);
  });

  it("finds the fiesta by city and by country in any language", async () => {
    openHome("da");
    const box = await screen.findByRole("searchbox");
    const user = userEvent.setup();
    for (const q of ["valencia", "espana", "spain", "spanien", "españa"]) {
      await user.clear(box);
      await user.type(box, q);
      expect(names()).toEqual(["Fiestas del Barrio de la Alameda 2026"]);
    }
  });

  it("combines words with AND", async () => {
    openHome();
    const box = await screen.findByRole("searchbox");
    const user = userEvent.setup();
    await user.type(box, "galway ireland");
    expect(names()).toEqual(["Nightfall Meadows Festival 2026"]);
    await user.clear(box);
    await user.type(box, "galway spain");
    expect(names()).toEqual([]);
    expect(screen.getByText(/No events match/)).toBeInTheDocument();
  });

  it("shows the empty state, and its clear action restores the full list in order and refocuses the field", async () => {
    openHome();
    const box = await screen.findByRole("searchbox");
    const user = userEvent.setup();
    await user.type(box, "<b>xqzv</b>");
    expect(screen.getByRole("heading", { level: 2, name: /No events match “<b>xqzv<\/b>”/ })).toBeInTheDocument();
    expect(document.querySelector(".state b")).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "Clear search" }).at(-1)!);
    expect(names()).toEqual(ORDER);
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
  });

  it("Esc and the x button clear the query and keep focus in the field", async () => {
    openHome();
    const box = await screen.findByRole("searchbox");
    const user = userEvent.setup();
    expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();

    await user.type(box, "spain");
    expect(names()).toHaveLength(1);
    await user.keyboard("{Escape}");
    expect(box).toHaveValue("");
    expect(names()).toEqual(ORDER);

    await user.type(box, "spain");
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(box).toHaveValue("");
    expect(box).toHaveFocus();
    expect(names()).toEqual(ORDER);
  });

  it("does not throw on regex-like input", async () => {
    openHome();
    const box = await screen.findByRole("searchbox");
    const user = userEvent.setup();
    await user.type(box, "(a+)+$");
    expect(names()).toEqual([]);
    await user.clear(box);
    await user.type(box, "(");
    expect(names()).toEqual([]);
    expect(screen.getByText(/No events match/)).toBeInTheDocument();
  });

  it("caps the field at 100 characters", async () => {
    openHome();
    expect(await screen.findByRole("searchbox")).toHaveAttribute("maxlength", "100");
  });

  it("localizes the field and the empty state", async () => {
    openHome("es");
    const box = await screen.findByRole("searchbox", { name: "Buscar eventos" });
    await userEvent.setup().type(box, "zzz");
    expect(screen.getByText(/Ningún evento coincide con/)).toBeInTheDocument();
  });

  it("keeps ?near= separate: the query is never added to the URL or the request", async () => {
    const fetchFn = openHome("en", "/?near=es");
    const box = await screen.findByRole("searchbox");
    await userEvent.setup().type(box, "spain");
    expect(fetchFn.mock.calls.map((c: any) => String(c[0]))).toEqual(["/api/v1/events?near=ES"]);
    expect(window.location.search).toBe("?near=es");
  });
});
