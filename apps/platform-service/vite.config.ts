import react from "@vitejs/plugin-react";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { SERVER_FUNCTION_BASE_PATH } from "@tools-platform/security";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    tanstackStart({ serverFns: { base: SERVER_FUNCTION_BASE_PATH } }),
    nitro({
      preset: "bun",
      publicAssets: [
        {
          baseURL: "/assets",
          dir: "../tools-web/public/assets",
          maxAge: 3600
        }
      ]
    }),
    react()
  ],
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname
    }
  }
});
