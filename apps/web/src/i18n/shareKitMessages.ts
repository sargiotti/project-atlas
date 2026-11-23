// Slice 28: "Compartir tu mapa" card and the A4 flyer dialog. Merged into the main catalogs in messages.ts.
// The text drawn on the badge and the flyer lives in lib/shareKit/copy.ts (it has its own language selector).
export const skEs = {
  skTitle: "Compartir tu mapa",
  skLead: "Tu mapa está publicado. Llévalo a la calle: enlace, QR y cartel.",
  skLinkLabel: "Enlace de tu mapa",
  skCopy: "Copiar enlace",
  skCopied: "Enlace copiado",
  skCopiedSr: "Enlace copiado al portapapeles.",
  skCopyFail: "No se pudo copiar solo. El enlace está seleccionado: cópialo con Ctrl+C.",
  skPreviewAlt: "Vista previa de la imagen QR",
  skLang: "Idioma del QR y del cartel",
  skPng: "Descargar QR",
  skFlyer: "Imprimir cartel A4",
  skSvg: "QR en SVG para imprenta",
  skPngFail: "No se pudo crear la imagen. Inténtalo de nuevo.",
  skFlyerTitle: "Cartel A4",
  skPrint: "Imprimir",
  skPrintHint: "En el cuadro de impresión, elige «Guardar como PDF» si quieres un archivo.",
};

/** Rioplatense (vos) overrides for the base Spanish above (slice 34). Spread into ES_VOS in organizerMessages.ts. */
export const skEsVos: Partial<Record<keyof typeof skEs, string>> = {
  skLead: "Tu mapa está publicado. Llevalo a la calle: enlace, QR y cartel.",
  skCopyFail: "No se pudo copiar solo. El enlace está seleccionado: copialo con Ctrl+C.",
  skPngFail: "No se pudo crear la imagen. Probá de nuevo.",
  skPrintHint: "En el cuadro de impresión, elegí «Guardar como PDF» si querés un archivo.",
};

export const skEn: Record<keyof typeof skEs, string> = {
  skTitle: "Share your map",
  skLead: "Your map is published. Take it to the street: link, QR and flyer.",
  skLinkLabel: "Your map link",
  skCopy: "Copy link",
  skCopied: "Link copied",
  skCopiedSr: "Link copied to the clipboard.",
  skCopyFail: "Could not copy automatically. The link is selected: copy it with Ctrl+C.",
  skPreviewAlt: "Preview of the QR image",
  skLang: "QR and flyer language",
  skPng: "Download QR",
  skFlyer: "Print A4 flyer",
  skSvg: "QR as SVG for print shops",
  skPngFail: "Could not create the image. Try again.",
  skFlyerTitle: "A4 flyer",
  skPrint: "Print",
  skPrintHint: "In the print dialog, choose “Save as PDF” if you want a file.",
};

export const skDa: Record<keyof typeof skEs, string> = {
  skTitle: "Del dit kort",
  skLead: "Dit kort er udgivet. Tag det med ud: link, QR og plakat.",
  skLinkLabel: "Link til dit kort",
  skCopy: "Kopiér link",
  skCopied: "Link kopieret",
  skCopiedSr: "Linket er kopieret til udklipsholderen.",
  skCopyFail: "Kunne ikke kopiere automatisk. Linket er markeret: kopiér det med Ctrl+C.",
  skPreviewAlt: "Forhåndsvisning af QR-billedet",
  skLang: "Sprog for QR og plakat",
  skPng: "Download QR",
  skFlyer: "Udskriv A4-plakat",
  skSvg: "QR som SVG til trykkeri",
  skPngFail: "Kunne ikke oprette billedet. Prøv igen.",
  skFlyerTitle: "A4-plakat",
  skPrint: "Udskriv",
  skPrintHint: "Vælg ”Gem som PDF” i udskriftsdialogen, hvis du vil have en fil.",
};

export const skCa: Record<keyof typeof skEs, string> = {
  skTitle: "Comparteix el teu mapa",
  skLead: "El teu mapa està publicat. Porta'l al carrer: enllaç, QR i cartell.",
  skLinkLabel: "Enllaç del teu mapa",
  skCopy: "Copia l'enllaç",
  skCopied: "Enllaç copiat",
  skCopiedSr: "Enllaç copiat al porta-retalls.",
  skCopyFail: "No s'ha pogut copiar automàticament. L'enllaç està seleccionat: copia'l amb Ctrl+C.",
  skPreviewAlt: "Previsualització de la imatge QR",
  skLang: "Idioma del QR i del cartell",
  skPng: "Baixa el QR",
  skFlyer: "Imprimeix cartell A4",
  skSvg: "QR en SVG per a impremta",
  skPngFail: "No s'ha pogut crear la imatge. Torna-ho a provar.",
  skFlyerTitle: "Cartell A4",
  skPrint: "Imprimeix",
  skPrintHint: "Al quadre d'impressió, tria «Desa com a PDF» si vols un fitxer.",
};
