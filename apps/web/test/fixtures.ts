import { vi } from "vitest";

export const bundle = {
  event: { slug: "test-fest", name: "Test Fest", startDate: "2026-07-10", endDate: "2026-07-12", language: "en" },
  map: {
    id: "map_test-fest_1",
    theme: "dark",
    width: 1000,
    height: 800,
    image: { format: "svg", variants: [{ url: "/maps/test-fest.abcd1234.svg", width: 1000 }] },
  },
  points: [
    { id: "main-stage", name: "Main Stage", category: "stage", description: "Headliners <b>from 20:00</b>.", x: 0.5, y: 0.3 },
    { id: "taco-truck", name: "Taco Truck", category: "food", description: "Tacos and more.", x: 0.2, y: 0.6 },
    { id: "wc-north", name: "WC North", category: "toilets", description: "", x: 0.8, y: 0.2 },
  ],
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export function errorBody(code: string) {
  return { error: { code, message: "x", requestId: "r" } };
}

export function mockFetch(handler: () => Response | Promise<Response>) {
  const fn = vi.fn(async () => handler());
  vi.stubGlobal("fetch", fn);
  return fn;
}

export function goTo(path: string) {
  window.history.pushState({}, "", path);
}
