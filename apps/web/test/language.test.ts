import { describe, expect, it } from "vitest";
import { pickLang } from "../src/i18n/detect";

describe("pickLang (browser language -> UI language)", () => {
  it("uses Spanish, English or Danish when the browser asks for them, including regional variants", () => {
    expect(pickLang(["da-DK"])).toBe("da");
    expect(pickLang(["en-GB", "es"])).toBe("en");
    expect(pickLang(["es-AR"])).toBe("es");
  });

  it("skips unsupported languages in favour of the next supported one", () => {
    expect(pickLang(["fr-FR", "da"])).toBe("da");
  });

  it("falls back to Spanish for any other language, garbage or nothing", () => {
    expect(pickLang(["fr-FR", "de"])).toBe("es");
    expect(pickLang(["<script>", "../../x", ""])).toBe("es");
    expect(pickLang([])).toBe("es");
    expect(pickLang(undefined)).toBe("es");
  });
});
