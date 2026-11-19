import { describe, expect, it } from "vitest";
import { pickLang, pickPanelLang } from "../src/i18n/detect";

describe("pickLang (browser language -> UI language)", () => {
  it.each([
    [["da-DK"], "da"],
    [["en-GB", "es"], "en"],
    [["es-AR"], "es"],
    [["ca"], "ca"],
    [["ca-ES", "es"], "ca"],
    [["ca-valencia"], "ca"],
    [["fr-FR", "da"], "da"], // skips an unsupported language for the next supported one
    [["fr-FR", "de"], "es"], // anything else falls back to Spanish
    [["<script>", "../../x", ""], "es"],
    [[], "es"],
    [undefined, "es"],
  ] as [string[] | undefined, string][])("%j -> %s", (langs, expected) => {
    expect(pickLang(langs)).toBe(expected);
  });
});

describe("pickPanelLang", () => {
  it("uses the browser's en, es, da or ca, otherwise English (not Spanish)", () => {
    expect(pickPanelLang(["ca-ES"])).toBe("ca");
    expect(pickPanelLang(["da-DK", "en"])).toBe("da");
    expect(pickPanelLang(["es-AR"])).toBe("es");
    expect(pickPanelLang(["fr-FR", "de"])).toBe("en");
    expect(pickPanelLang([])).toBe("en");
  });
});
