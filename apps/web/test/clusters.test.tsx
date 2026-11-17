import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { bundle, goTo, json, mockFetch } from "./fixtures";

// jsdom has no layout: give the map a phone-sized box so the viewer fits the map and clusters are computed on real pixels.
const sizeDesc = (name: "clientWidth" | "clientHeight") => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
let saved: [PropertyDescriptor | undefined, PropertyDescriptor | undefined];
beforeAll(() => {
  saved = [sizeDesc("clientWidth"), sizeDesc("clientHeight")];
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 375 });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 700 });
});
afterAll(() => {
  if (saved[0]) Object.defineProperty(HTMLElement.prototype, "clientWidth", saved[0]);
  else delete (HTMLElement.prototype as any).clientWidth;
  if (saved[1]) Object.defineProperty(HTMLElement.prototype, "clientHeight", saved[1]);
  else delete (HTMLElement.prototype as any).clientHeight;
});
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

function open(points: any[]) {
  mockFetch(() => json({ ...bundle, points }));
  goTo("/e/test-fest");
  return render(
    <I18nProvider initial="en">
      <Routes />
    </I18nProvider>,
  );
}

const overlapping = [
  { id: "main-stage", name: "Main Stage", category: "stage", description: "", x: 0.5, y: 0.5 },
  { id: "bar-norte", name: "Bar Norte", category: "drinks", description: "", x: 0.51, y: 0.5 },
  { id: "merch-tent", name: "Merch Tent", category: "merch", description: "", x: 0.5, y: 0.51 },
  { id: "wc-north", name: "WC North", category: "toilets", description: "", x: 0.1, y: 0.1 },
];

describe("pin clusters", () => {
  it("overlapping pins become one labelled cluster; it splits into a ring, Escape closes it and gives focus back, and a fanned pin opens its sheet", async () => {
    const user = userEvent.setup();
    open(overlapping);

    const cluster = await screen.findByRole("button", { name: "3 points: Main Stage, Bar Norte, Merch Tent" });
    expect(cluster).toHaveAttribute("aria-expanded", "false");
    // Members are not separate pins on the map any more; the far pin stays a pin.
    expect(screen.queryByRole("button", { name: "Bar Norte, Drinks" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "WC North, Toilets" })).toBeInTheDocument();

    // Open from the keyboard: focus moves to the first fanned pin.
    cluster.focus();
    await user.keyboard("{Enter}");
    const ring = screen.getByRole("group", { name: /3 points/ });
    const first = within(ring).getByRole("button", { name: "Main Stage, Stage" });
    expect(within(ring).getByRole("button", { name: "Bar Norte, Drinks" })).toBeInTheDocument();
    await waitFor(() => expect(first).toHaveFocus());
    expect(cluster).toHaveAttribute("aria-expanded", "true");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("group", { name: /3 points/ })).not.toBeInTheDocument());
    await waitFor(() => expect(cluster).toHaveFocus());
    expect(cluster).toHaveAttribute("aria-expanded", "false");

    // Pointer: open again, pick a fanned pin.
    await user.click(cluster);
    await user.click(within(screen.getByRole("group", { name: /3 points/ })).getByRole("button", { name: "Bar Norte, Drinks" }));
    expect(screen.getByRole("dialog", { name: "Bar Norte" })).toBeInTheDocument();
    // The selected pin is never part of a cluster: the other two stay merged and the count excludes it.
    expect(screen.getByRole("button", { name: "Bar Norte, Drinks" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2 points: Main Stage, Merch Tent" })).toBeInTheDocument();
  });

  it("more than 8 pins close together: a tap zooms in and announces it instead of fanning out", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `p${i}`, name: `Stall ${i + 1}`, category: "food", description: "", x: 0.5 + (i % 3) * 0.01, y: 0.5 + Math.floor(i / 3) * 0.01 }));
    open(many);
    await user.click(await screen.findByRole("button", { name: /^9 points: Stall 1, Stall 2, Stall 3 and 6 more$/ }));
    expect(screen.queryByRole("group", { name: /9 points/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Zoomed in, 9 points visible")).toBeInTheDocument());
  });

  it("more than 8 pins on the exact same spot open a list, and picking a row selects that pin", async () => {
    const user = userEvent.setup();
    const same = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, name: `Desk ${i + 1}`, category: "info", description: "", x: 0.3, y: 0.3 }));
    open(same);
    await user.click(await screen.findByRole("button", { name: /^9 points: Desk 1/ }));
    const list = screen.getByRole("dialog", { name: "9 points here" });
    await user.click(within(list).getByRole("button", { name: /Desk 4/ }));
    expect(screen.getByRole("dialog", { name: "Desk 4" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "9 points here" })).not.toBeInTheDocument();
  });
});
