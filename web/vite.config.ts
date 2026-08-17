import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const API = "http://127.0.0.1:4321";

export default defineConfig({
  plugins: [svelte()],
  server: {
    port: 5173,
    proxy: {
      // `/api/stream/:id` is SSE. The proxy must forward chunks as they arrive,
      // so ask the upstream for an identity encoding — a compressed response
      // would be buffered and the drawer would sit blank until the turn ended.
      "/api": {
        target: API,
        changeOrigin: true,
        headers: { "Accept-Encoding": "identity" },
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
