import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// The panel chunk (lazy) is transformed on first use, which can be slow on a busy machine.
configure({ asyncUtilTimeout: 5000 });

afterEach(() => cleanup());

// jsdom lacks these browser APIs used by the map viewer.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as any).ResizeObserver ??= RO;
(globalThis as any).matchMedia ??= (q: string) => ({
  matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
});
