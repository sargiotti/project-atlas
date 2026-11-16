import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCover } from "../scripts/seed-lib";

const vp8l = (w: number, h: number) => {
  const payload = Buffer.alloc(8);
  payload[0] = 0x2f;
  payload.writeUInt32LE(((w - 1) & 0x3fff) | (((h - 1) & 0x3fff) << 14), 1);
  const head = Buffer.alloc(8);
  head.write("VP8L", 0, "latin1");
  head.writeUInt32LE(payload.length, 4);
  const body = Buffer.concat([Buffer.from("WEBP", "latin1"), head, payload]);
  const riff = Buffer.alloc(8);
  riff.write("RIFF", 0, "latin1");
  riff.writeUInt32LE(body.length, 4);
  return Buffer.concat([riff, body]);
};

describe("loadCover", () => {
  it("returns null (event seeded without cover) when the file is not there yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "covers-"));
    expect(loadCover("some-event", { width: 960, height: 640 }, dir)).toBeNull();
  });

  it("returns null when the seed declares no cover", () => {
    expect(loadCover("some-event", undefined, tmpdir())).toBeNull();
  });

  it("plans R2 keys that satisfy the contract URL regexes, deterministic per content", async () => {
    const { COVER_URL_REGEX, COVER_URL800_REGEX } = await import("@atlas/contract");
    const { planSeedCover } = await import("../scripts/seed-lib");
    const dir = mkdtempSync(join(tmpdir(), "covers-"));
    writeFileSync(join(dir, "some-event.webp"), vp8l(960, 640));
    const cover = loadCover("some-event", { width: 960, height: 640 }, dir)!;
    expect([cover.width, cover.height]).toEqual([960, 640]);
    const og = new Uint8Array([1, 2, 3]);
    const plan = planSeedCover("some-event", cover, og);
    expect(`/media/${plan.fullKey}`).toMatch(COVER_URL_REGEX);
    expect(`/media/${plan.smallKey}`).toMatch(COVER_URL800_REGEX);
    expect(plan.ogKey).toMatch(/^covers\/evt_some-event\/[0-9a-f]{32}-og\.jpg$/);
    expect(planSeedCover("some-event", cover, og)).toEqual(plan); // re-seeding the same art writes the same keys
    expect(planSeedCover("some-event", cover, new Uint8Array([9])).ogKey).not.toBe(plan.ogKey);
  });

  it("fails the seed when the file does not match the declared dimensions", () => {
    const dir = mkdtempSync(join(tmpdir(), "covers-"));
    writeFileSync(join(dir, "some-event.webp"), vp8l(800, 600));
    expect(() => loadCover("some-event", { width: 960, height: 640 }, dir)).toThrow(/expected 960x640/);
  });
});
