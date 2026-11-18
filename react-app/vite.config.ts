import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The new app is published next to the current one, at
// https://tarun1203.github.io/Chittamenterprises/next/ — the built files go
// to ../next (committed, like the rest of the site) until it replaces the old app.
export default defineConfig({
  base: "/Chittamenterprises/next/",
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { outDir: "../next", emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
