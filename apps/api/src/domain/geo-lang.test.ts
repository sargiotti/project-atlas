import { describe, expect, it } from "vitest";
import { applyGeoOverride, geoLang } from "./geo-lang";

describe("geoLang", () => {
  it("is ca only for exactly ES + CT", () => {
    expect(geoLang({ country: "ES", regionCode: "CT" })).toBe("ca");
    expect(geoLang({ country: "US", regionCode: "CT" })).toBeNull(); // Connecticut
    expect(geoLang({ country: "ES", regionCode: "MD" })).toBeNull();
    expect(geoLang({ country: "ES", regionCode: "ct" })).toBeNull();
    expect(geoLang({ country: "ES" })).toBeNull();
    expect(geoLang({ country: "ES", regionCode: 7 })).toBeNull();
  });

  it("is null when cf is missing or malformed, and never throws", () => {
    for (const cf of [undefined, null, "ES", 5, [], {}]) expect(geoLang(cf)).toBeNull();
    const hostile = new Proxy({}, {
      get: () => {
        throw new Error("boom");
      },
    });
    expect(geoLang(hostile)).toBeNull();
  });
});

describe("applyGeoOverride", () => {
  it("forces ca / null for ct / none (any case) and ignores everything else", () => {
    expect(applyGeoOverride(null, "ct")).toBe("ca");
    expect(applyGeoOverride("ca", "NONE")).toBeNull();
    expect(applyGeoOverride("ca", "garbage")).toBe("ca");
    expect(applyGeoOverride(null, "")).toBeNull();
    expect(applyGeoOverride("ca", null)).toBe("ca");
  });
});
