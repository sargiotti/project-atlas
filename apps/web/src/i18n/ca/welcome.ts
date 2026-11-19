// Catalan (ca): organizer welcome strings (slice 35). Keys mirror welEs; a missing key fails typecheck.
import type { welEs } from "../welcomeMessages";

export const welCa: Record<keyof typeof welEs, string> = {
  peWelcome: "Hola, {name}",
  peWelcomeNoName: "Hola",
  peWelcomeSub: "Et donem la benvinguda a leyenda.ink",
  peStepSub1: "Nom, dates i lloc",
  peStepSub2: "Una imatge o un plànol del teu esdeveniment",
  peStepSub3: "Enllaç i QR per al teu públic",
  peStateNow: "Ara",
  peStateNext: "Després",
  peStateLast: "Al final",
  peExampleTag: "Exemple",
  peExampleTitle: "Així es veu un esdeveniment acabat",
  peExampleText: "El teu públic obre l'enllaç des del mòbil i veu el mapa amb escenaris, menjar i serveis, a més del programa del dia. Sense descarregar res.",
  peExampleF1: "Les dades donen el títol, les dates i el lloc.",
  peExampleF2: "El mapa és la imatge de fons; els punts es marquen a sobre.",
  peExampleF3: "En publicar, comparteixes un enllaç i un QR.",
  peExampleLink: "Veure un esdeveniment d'exemple",
  peHowLink: "Com funciona leyenda.ink",
  peExampleAlt: "Mapa d'exemple d'un esdeveniment acabat: una festa de barri il·lustrada, amb parades, un escenari i una església",
  peMockTitle: "Festa del Barri",
  peMockMeta: "Dis 14 des · Plaça Major",
  peMockMap: "Mapa",
  peMockList: "Llista",
  peMockProgram: "Programa",
};
