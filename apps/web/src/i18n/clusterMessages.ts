// Slice 23: pin clusters on the visitor map (copy for design deliverable 23). Merged into the main catalogs in messages.ts.
export const clusterEs = {
  clusterLabel: "{n} puntos: {names}",
  clusterLabelMore: "{n} puntos: {names} y {more} más",
  clusterGroup: "Puntos cercanos",
  clusterClose: "Cerrar grupo",
  clusterZoomed: "Mapa acercado: {n} puntos a la vista",
  clusterListTitle: "{n} puntos acá",
  clusterListHint: "Elegí uno para verlo en el mapa.",
  clusterListClose: "Cerrar lista",
};
export const clusterEn: Record<keyof typeof clusterEs, string> = {
  clusterLabel: "{n} points: {names}",
  clusterLabelMore: "{n} points: {names} and {more} more",
  clusterGroup: "Nearby points",
  clusterClose: "Close group",
  clusterZoomed: "Zoomed in, {n} points visible",
  clusterListTitle: "{n} points here",
  clusterListHint: "Pick one to see it on the map.",
  clusterListClose: "Close list",
};
export const clusterDa: Record<keyof typeof clusterEs, string> = {
  clusterLabel: "{n} punkter: {names}",
  clusterLabelMore: "{n} punkter: {names} og {more} mere",
  clusterGroup: "Punkter tæt på hinanden",
  clusterClose: "Luk gruppen",
  clusterZoomed: "Zoomet ind, {n} punkter i billedet",
  clusterListTitle: "{n} punkter her",
  clusterListHint: "Vælg et for at se det på kortet.",
  clusterListClose: "Luk listen",
};
