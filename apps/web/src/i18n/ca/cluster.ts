// Catalan (ca): pin cluster strings. Keys mirror clusterEs; a missing key fails typecheck.
import type { clusterEs } from "../clusterMessages";

export const clusterCa: Record<keyof typeof clusterEs, string> = {
  clusterLabel: "{n} punts: {names}",
  clusterLabelMore: "{n} punts: {names} i {more} més",
  clusterGroup: "Punts propers",
  clusterClose: "Tanca el grup",
  clusterZoomed: "Mapa ampliat: {n} punts a la vista",
  clusterListTitle: "{n} punts aquí",
  clusterListHint: "Tria'n un per veure'l al mapa.",
  clusterListClose: "Tanca la llista",
};
