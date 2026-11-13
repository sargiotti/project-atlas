import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Self-hosted fonts (bundled by Vite) so the CSP stays 'self'-only. Pixelify Sans is for the logo only.
import "@fontsource/atkinson-hyperlegible/latin-400.css";
import "@fontsource/atkinson-hyperlegible/latin-700.css";
import "@fontsource/atkinson-hyperlegible/latin-ext-400.css";
import "@fontsource/atkinson-hyperlegible/latin-ext-700.css";
import "@fontsource/pixelify-sans/latin-700.css";
import "./styles.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
