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

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
