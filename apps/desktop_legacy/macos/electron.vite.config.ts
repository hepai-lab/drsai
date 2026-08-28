import { resolve } from "node:path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    define: {
      __OPENDRSAI_BUILD_CHANNEL__: JSON.stringify(process.env.OPENDRSAI_BUILD_CHANNEL === "development" ? "development" : "release"),
    },
    build: { sourcemap: true, rollupOptions: { input: { index: resolve("src/main/bootstrapEntry.ts") } } },
  },
  preload: {
    build: {
      sourcemap: true,
      rollupOptions: { input: { index: resolve("src/preload/index.ts") } },
    },
  },
  renderer: {
    root: resolve("../shared/renderer"),
    build: {
      sourcemap: true,
      rollupOptions: { input: resolve("../shared/renderer/index.html") },
    },
    resolve: {
      alias: {
        "@renderer": resolve("../shared/renderer/src"),
        "@shared": resolve("../shared/api"),
      },
    },
    plugins: [tailwindcss(), react()],
  },
});
