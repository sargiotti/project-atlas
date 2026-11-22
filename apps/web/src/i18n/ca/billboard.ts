// Catalan (ca): Home billboard strings. Keys mirror bbEs; a missing key fails typecheck.
import type { bbEs } from "../billboardMessages";

export const bbCa: Record<keyof typeof bbEs, string> = {
  bbTitle: "Què hi ha",
  bbNear: "A prop de",
  bbPlaceAuto: "La teva zona",
  bbPlaceLabel: "Tria el lloc per ordenar els esdeveniments",
  bbPlaceHint: "Sense GPS. Només per ordenar.",
  bbNow: "Ara",
  bbWeekend: "Aquest cap de setmana",
  bbLater: "Properament",
  bbNav: "Ves a",
  bbPrev: "Esdeveniments anteriors",
  bbNext: "Més esdeveniments",
  bbNearYou: "A prop teu",
  bbExample: "Esdeveniment d'exemple",
  exShort: "Exemple",
  bbNone: "Encara no hi ha res a prop. Això és el que hi ha pel món.",
  bbNonePlace: "Encara no hi ha res a prop de {place}. Això és el que hi ha pel món.",
  bbCtaTitle: "Organitzes alguna cosa?",
  bbCtaButton: "Afegeix el teu esdeveniment",
  bbCtaFirst: "Encara no hi ha res. Sigues el primer!",
  bbError: "No hem pogut carregar la cartellera.",
  bbLoading: "Carregant la cartellera…",
  bbCardLabel: "{name}, {dates}, {city}",
};
