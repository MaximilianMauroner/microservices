import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { SERVER_FUNCTION_BASE_PATH } from "@tools-platform/security";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  publicDir: new URL("../../services/tools/dashboard/public", import.meta.url).pathname,
  server: {
    allowedHosts: ["coding.tailbc92d.ts.net"]
  },
  plugins: [
    tailwindcss(),
    tanstackStart({ serverFns: { base: SERVER_FUNCTION_BASE_PATH } }),
    nitro({
      preset: "node-server",
      // Preserve route and dependency chunks so public requests do not load
      // every product's SSR code. Smoke-check rendered routes after upgrades:
      // an older Rolldown version emitted invalid cross-chunk namespace exports.
      inlineDynamicImports: false
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] })
  ],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
