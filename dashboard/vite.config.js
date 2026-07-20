import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/mw/",
  plugins: [react(), tailwindcss()],
  // Isolate from monorepo root postcss.config.mjs (Next/Tailwind v4 app).
  css: {
    postcss: {
      plugins: [],
    },
  },
  server: {
    port: 5174,
    proxy: {
      "/mw/api": {
        target: "http://localhost:20128",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
});
