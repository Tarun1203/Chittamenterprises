import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router";
import "./index.css";
import App from "./App";
import { registerServiceWorker } from "./lib/pwa";

registerServiceWorker();

// HashRouter: GitHub Pages serves plain files, so page addresses live after the #
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
