// Slice 34: Rioplatense (vos) overrides for the base Spanish strings in messages.ts. Kept in its own file so
// organizerMessages.ts (ES_VOS) does not import messages.ts at runtime (messages.ts imports organizerMessages).
export const mainEsVos: Record<string, string> = {
  noMatchHint: "Probá con una ciudad, un país u otro nombre.",
  emptyText: "Cuando un evento publique su mapa, va a aparecer acá.",
  errorText: "Revisá tu conexión y probá de nuevo.",
  mapHint: "Mapa interactivo. Usá las flechas para mover y más o menos para el zoom. Los puntos son botones.",
  qrCaption: "Escaneá este código QR para abrir el mismo evento.",
  pageNotFoundText: "Revisá el enlace o volvé al inicio.",
  unavailableText: "El mapa no está disponible por un momento. Probá de nuevo en unos instantes.",
  viewHint3: "Explorá a tu manera: mapa, lista o programa.",
  viewHint2: "Explorá a tu manera: mapa o lista.",
  schOver: "Este evento terminó",
  errorTitle: "No pudimos cargar los eventos",
  mapImageFailed: "No pudimos cargar la imagen del mapa.",
  schError: "No pudimos mostrar el programa. El mapa y la lista siguen funcionando.",
};
