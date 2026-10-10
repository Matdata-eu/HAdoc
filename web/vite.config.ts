import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const api = process.env.HADOC_API ?? "http://localhost:8080";

export default defineConfig({
  plugins: [svelte()],
  server: {
    proxy: {
      "/api": api,
      "/plans": api,
      "/photos": api,
    },
  },
});
