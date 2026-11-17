import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { I18nProvider } from "../src/i18n/I18nProvider";
import { Routes } from "../src/App";
import { bundle, goTo, json, mockFetch } from "./fixtures";

// jsdom has no layout nor PointerEvent: give the map a phone-sized box and build the pointer events by hand.
let saved: [PropertyDescriptor | undefined, PropertyDescriptor | undefined];
beforeAll(() => {
  saved = [Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth"), Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight")];
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

function ptr(target: Element, type: string, id: number, x: number, y: number, primary: boolean) {
  const ev: any = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { pointerId: id, pointerType: "touch", isPrimary: primary, button: 0, clientX: x, clientY: y });
  act(() => {
    target.dispatchEvent(ev);
  });
}

const points = [{ id: "main-stage", name: "Main Stage", category: "stage", description: "", x: 0.5, y: 0.5 }];

async function setup() {
  mockFetch(() => json({ ...bundle, points }));
  goTo("/e/test-fest");
  render(
    <I18nProvider initial="en">
      <Routes />
    </I18nProvider>,
  );
  await screen.findByRole("button", { name: "Main Stage, Stage" });
  const box = document.querySelector(".map-viewer") as HTMLElement;
  const stage = box.firstElementChild as HTMLElement;
  return { box, stage };
}

const parse = (stage: HTMLElement) => {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(stage.style.transform)!;
  return { x: +m[1], y: +m[2], k: +m[3] };
};

describe("map gestures", () => {
  it("a pointerup that never reaches the viewer does not leave a ghost finger: the next one-finger drag still pans", async () => {
    const { box, stage } = await setup();
    ptr(box, "pointerdown", 1, 100, 300, true);
    ptr(box, "pointerdown", 2, 200, 300, false);
    ptr(box, "pointermove", 2, 260, 300, false); // pinch
    ptr(document.body, "pointerup", 2, 260, 300, false); // lifted over the top bar: never bubbles through the viewer
    ptr(document.body, "pointerup", 1, 100, 300, true);

    const before = parse(stage);
    ptr(box, "pointerdown", 3, 150, 300, true);
    ptr(box, "pointermove", 3, 190, 300, true);
    const after = parse(stage);
    expect(after.k).toBeCloseTo(before.k, 5);
    expect(after.x - before.x).toBeCloseTo(40, 3);
  });

  it("a stale finger is dropped when a new primary pointerdown arrives", async () => {
    const { box, stage } = await setup();
    ptr(box, "pointerdown", 1, 100, 300, true);
    ptr(box, "pointerdown", 2, 200, 300, false);
    ptr(box, "pointermove", 2, 260, 300, false); // zoomed in; both fingers are then lost without any up/cancel
    const before = parse(stage);
    ptr(box, "pointerdown", 9, 150, 300, true);
    ptr(box, "pointermove", 9, 210, 300, true);
    const after = parse(stage);
    expect(after.k).toBeCloseTo(before.k, 5);
    expect(after.x).toBeGreaterThan(before.x); // panned (the range is clamped), not pinched
  });

  it("a tap on a marker after a pinch still opens its sheet", async () => {
    const { box } = await setup();
    ptr(box, "pointerdown", 1, 100, 300, true);
    ptr(box, "pointerdown", 2, 200, 300, false);
    ptr(box, "pointermove", 2, 240, 300, false);
    ptr(document.body, "pointerup", 2, 240, 300, false);
    ptr(document.body, "pointerup", 1, 100, 300, true);

    const marker = screen.getByRole("button", { name: "Main Stage, Stage" });
    ptr(marker, "pointerdown", 4, 180, 350, true);
    ptr(marker, "pointerup", 4, 180, 350, true);
    act(() => marker.click());
    expect(await screen.findByRole("dialog", { name: "Main Stage" })).toBeInTheDocument();
  });
});
