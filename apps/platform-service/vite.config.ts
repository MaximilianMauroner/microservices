import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { SERVER_FUNCTION_BASE_PATH } from "@tools-platform/security";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: new URL("../../packages/tools-web/public", import.meta.url).pathname,
  plugins: [
    tailwindcss(),
    tanstackStart({ serverFns: { base: SERVER_FUNCTION_BASE_PATH } }),
    nitro({
      preset: "bun",
      // Rolldown can emit an invalid cross-chunk namespace export for the SSR
      // renderer. Keeping the server bundle together prevents broken builds
      // from passing the lightweight /health check.
      inlineDynamicImports: true
    }),
    react()
  ],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
