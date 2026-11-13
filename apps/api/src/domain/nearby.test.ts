import { describe, expect, it } from "vitest";
import {
  NEARBY_RADIUS_KM,
  applyNearOverride,
  haversineKm,
  isNearby,
  parseVisitorLocation,
  type EventPlace,
} from "./nearby";

const madrid = { lat: 40.4168, lng: -3.7038 };
const barcelona = { lat: 41.3874, lng: 2.1686 };

describe("haversineKm", () => {
  it("Madrid to Barcelona is about 505 km", () => {
    const d = haversineKm(madrid.lat, madrid.lng, barcelona.lat, barcelona.lng);
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(510);
  });
});

describe("isNearby", () => {
  const event = (over: Partial<EventPlace> = {}): EventPlace => ({ country: "ES", lat: 39.47, lng: -0.38, ...over });

  it("uses the radius when both have coordinates, inclusive at the boundary", () => {
    const degreesAtBoundary = NEARBY_RADIUS_KM / haversineKm(0, 0, 1, 0);
    const place = { country: "ES", lat: 0, lng: 0 };
    expect(isNearby({ lat: degreesAtBoundary - 0.001, lng: 0, country: "FR" }, place)).toBe(true);
    expect(isNearby({ lat: degreesAtBoundary + 0.001, lng: 0, country: "ES" }, place)).toBe(false);
  });

  it("Madrid is not nearby Barcelona when both have coordinates, even in the same country", () => {
    expect(isNearby({ ...madrid, country: "ES" }, { country: "ES", ...barcelona })).toBe(false);
  });

  it("falls back to same country when the event has no coordinates", () => {
    expect(isNearby({ ...madrid, country: "ES" }, event({ lat: null, lng: null }))).toBe(true);
    expect(isNearby({ ...madrid, country: "FR" }, event({ lat: null, lng: null }))).toBe(false);
  });

  it("falls back to same country when the visitor has no coordinates", () => {
    expect(isNearby({ country: "ES" }, event())).toBe(true);
    expect(isNearby({ country: "PT" }, event())).toBe(false);
  });

  it("is false for every event when the visitor location is unknown", () => {
    expect(isNearby({}, event())).toBe(false);
    expect(isNearby({}, event({ lat: null, lng: null }))).toBe(false);
  });
});

describe("parseVisitorLocation", () => {
  it("reads country and numeric-string coordinates from cf", () => {
    expect(parseVisitorLocation({ country: "ES", latitude: "40.4168", longitude: "-3.7038" })).toEqual({
      country: "ES",
      lat: 40.4168,
      lng: -3.7038,
    });
  });

  it.each([
    ["cf absent", undefined],
    ["cf null", null],
    ["cf not an object", "ES"],
    ["unknown country XX", { country: "XX" }],
    ["Tor country T1", { country: "T1" }],
    ["lowercase country", { country: "es" }],
    ["non-numeric latitude", { country: "XX", latitude: "abc", longitude: "10" }],
    ["out-of-range latitude", { country: "XX", latitude: "91", longitude: "10" }],
    ["out-of-range longitude", { country: "XX", latitude: "10", longitude: "-181" }],
    ["empty strings", { country: "XX", latitude: "", longitude: "" }],
    ["Infinity", { country: "XX", latitude: Infinity, longitude: 0 }],
  ])("treats %s as unknown", (_name, cf) => {
    expect(parseVisitorLocation(cf)).toEqual({});
  });

  it("keeps the valid parts when only one is bad", () => {
    expect(parseVisitorLocation({ country: "ES", latitude: "abc", longitude: "10" })).toEqual({ country: "ES" });
  });

  it("never throws on hostile getters", () => {
    const cf = {
      get country(): string {
        throw new Error("boom");
      },
    };
    expect(parseVisitorLocation(cf)).toEqual({});
  });
});

describe("applyNearOverride", () => {
  const real = { country: "FR", lat: 48.85, lng: 2.35 };

  it("a valid code replaces the country and drops the coordinates, in any case", () => {
    expect(applyNearOverride(real, "ES")).toEqual({ country: "ES" });
    expect(applyNearOverride(real, "es")).toEqual({ country: "ES" });
  });

  it("none means unknown location", () => {
    expect(applyNearOverride(real, "none")).toEqual({});
    expect(applyNearOverride(real, "NONE")).toEqual({});
  });

  it.each(["", "E", "ESP", "E1", "es ", "<script>", "none;"])("ignores invalid value %j", (v) => {
    expect(applyNearOverride(real, v)).toBe(real);
  });

  it("absent param leaves the real location", () => {
    expect(applyNearOverride(real, null)).toBe(real);
  });
});
