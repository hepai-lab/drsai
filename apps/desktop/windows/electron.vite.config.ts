import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      rollupOptions: {
        external: ["better-sqlite3"],
      },
    },
  },
  preload: {
    build: {
      sourcemap: true,
      rollupOptions: {
        input: {
          index: resolve("src/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    root: resolve("../shared/renderer"),
    server: {
      host: "127.0.0.1",
      hmr: {
        host: "127.0.0.1",
      },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: resolve("../shared/renderer/index.html"),
      },
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

