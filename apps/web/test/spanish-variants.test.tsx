import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MESSAGES } from "../src/i18n/messages";
import { ES_VOS } from "../src/i18n/organizerMessages";
import { PRIVACY_NOTICE } from "../src/i18n/privacyNotice";
import { KIT_TEXT, kitTextKey } from "../src/lib/shareKit/copy";
import { FLYER_TEMPLATES } from "../src/pages/panel/events/flyers";
import { makeQr } from "../src/lib/shareKit/qr";

// Base Spanish is "tú" (Spain and the default). Rioplatense words and voseo live only in ES_VOS (slice 34).
const VOS_WORDS = /(?<![\p{L}])(acá|celular|podés|tenés|querés|sos|vos|probá|revisá|elegí|usá|subí|tocá|escaneá|hacé|ubicá|agregá|soltá|arrastrá|ingresá|mirá|volvé)(?![\p{L}])/iu;

describe("Spanish variants: the base es catalog is tú and Spain Spanish", () => {
  it("no base es string uses voseo or Rioplatense words", () => {
    const bad = Object.entries(MESSAGES.es).filter(([, v]) => VOS_WORDS.test(v)).map(([k, v]) => `${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it("the privacy notice in es has no voseo", () => {
    const notice = PRIVACY_NOTICE.es;
    const text = notice.sections.flatMap((s) => [s.heading, ...s.lines]).join("\n");
    expect(text).not.toMatch(VOS_WORDS);
  });

  it("the share kit base es text has no voseo", () => {
    for (const v of Object.values(KIT_TEXT.es)) expect(v).not.toMatch(VOS_WORDS);
  });

  it("every vos override targets a real key and differs from the base", () => {
    for (const [k, v] of Object.entries(ES_VOS)) {
      expect(k in MESSAGES.es, k).toBe(true);
      expect(v, k).not.toBe((MESSAGES.es as any)[k]);
    }
  });
});

describe("Share kit text variant", () => {
  it("picks es-vos for an AR or UY event and es for an ES event; other languages are untouched", () => {
    expect(kitTextKey("es", "AR")).toBe("es-vos");
    expect(kitTextKey("es", "UY")).toBe("es-vos");
    expect(kitTextKey("es", "ES")).toBe("es");
    expect(kitTextKey("es", null)).toBe("es");
    expect(kitTextKey("en", "AR")).toBe("en");
    expect(KIT_TEXT["es-vos"].badgeCta).toBe("Escaneá para ver el mapa");
    expect(KIT_TEXT["es-vos"].flyerSub).toBe(KIT_TEXT.es.flyerSub);
  });

  it("the flyer uses one variant only: vos for AR, tú for ES", () => {
    const base = { name: "Fiestas", startDate: "2026-12-04", endDate: "2026-12-07", city: "Rosario", qr: makeQr("https://leyenda.ink/e/x"), url: "https://leyenda.ink/e/x", lang: "es" as const };
    const ar = renderToStaticMarkup(FLYER_TEMPLATES["2A"]({ ...base, textKey: kitTextKey("es", "AR") }));
    const es = renderToStaticMarkup(FLYER_TEMPLATES["2A"]({ ...base, textKey: kitTextKey("es", "ES") }));
    expect(ar).toContain("Escaneá para ver");
    expect(ar).not.toContain("Escanea para ver");
    expect(es).toContain("Escanea para ver");
    expect(es).not.toContain("Escaneá");
  });
});
