import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (bundled by Vite, font-display: swap) so the CSP stays 'self'-only. Bricolage Grotesque is for the logo,
// headings and event/stage names; Figtree is for all UI text. latin-ext has a unicode-range, so it only downloads when needed.
import "@fontsource/figtree/latin-400.css";
import "@fontsource/figtree/latin-600.css";
import "@fontsource/figtree/latin-700.css";
import "@fontsource/figtree/latin-ext-400.css";
import "@fontsource/figtree/latin-ext-600.css";
import "@fontsource/figtree/latin-ext-700.css";
import "@fontsource/bricolage-grotesque/latin-500.css";
import "@fontsource/bricolage-grotesque/latin-800.css";
import "@fontsource/bricolage-grotesque/latin-ext-500.css";
import "@fontsource/bricolage-grotesque/latin-ext-800.css";
import "./styles.css";
import App from "./App";
import { fetchGeoLang, shouldAskGeo } from "./i18n/geoLang";
import { loadStoredLang } from "./i18n/detect";

// Slice 21b: with no stored language and a Madrid-timezone device, give the geo-lang answer up to 300 ms
// before the first render so a Catalan visitor usually never sees the Spanish flash. After that the page renders
// and switches to Catalan when the answer lands (the request itself is aborted at 1.5 s).
async function start() {
  if (loadStoredLang() === null && shouldAskGeo()) {
    await Promise.race([fetchGeoLang(), new Promise((r) => setTimeout(r, 300))]);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
start();
