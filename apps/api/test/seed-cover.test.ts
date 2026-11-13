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

  it("builds a content-hashed key that satisfies the contract URL regex", async () => {
    const { COVER_URL_REGEX } = await import("@atlas/contract");
    const dir = mkdtempSync(join(tmpdir(), "covers-"));
    writeFileSync(join(dir, "some-event.webp"), vp8l(960, 640));
    const cover = loadCover("some-event", { width: 960, height: 640 }, dir)!;
    expect([cover.width, cover.height]).toEqual([960, 640]);
    expect(`/covers/${cover.key}`).toMatch(COVER_URL_REGEX);
  });

  it("fails the seed when the file does not match the declared dimensions", () => {
    const dir = mkdtempSync(join(tmpdir(), "covers-"));
    writeFileSync(join(dir, "some-event.webp"), vp8l(800, 600));
    expect(() => loadCover("some-event", { width: 960, height: 640 }, dir)).toThrow(/expected 960x640/);
  });
});
