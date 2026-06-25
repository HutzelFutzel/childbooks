import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // jsPDF lazily imports these only for SVG / HTML rendering, which we don't
      // use (we embed pre-rasterized JPEGs). Alias them to an empty stub so
      // neither the dev optimizer nor the production build tries to resolve the
      // optional peer dependencies we intentionally don't install.
      canvg: path.resolve(__dirname, "./src/stubs/empty.js"),
      html2canvas: path.resolve(__dirname, "./src/stubs/empty.js"),
      dompurify: path.resolve(__dirname, "./src/stubs/empty.js"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    // Dev-only proxy so the web build can reach OpenAI without CORS / key issues.
    // The Tauri build talks to providers directly via the HTTP plugin instead.
    proxy: {
      "/proxy/openai": {
        target: "https://api.openai.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/openai/, ""),
      },
      "/proxy/google": {
        target: "https://generativelanguage.googleapis.com",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/proxy\/google/, ""),
      },
    },
  },
}));
