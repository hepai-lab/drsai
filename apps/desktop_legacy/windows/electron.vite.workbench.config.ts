/**
 * Build config for the workbench shell, beside `electron.vite.config.ts`.
 *
 * A second config rather than a flag in the first one: the two surfaces have
 * different entry points at all three layers, and expressing that as conditionals
 * would make each build depend on an environment variable being right. Two files
 * mean `npm run dev:workbench` and `npm run dev` cannot be confused for one another.
 *
 * Note the renderer has no Tailwind plugin. The workbench ships plain CSS, so the
 * whole surface builds with React and nothing else.
 */
import { resolve } from "path";
import { defineConfig } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    build: {
      sourcemap: true,
      rollupOptions: {
        input: { index: resolve("src/main/workbench.ts") },
      },
    },
  },
  preload: {
    build: {
      sourcemap: true,
      rollupOptions: {
        input: { workbench: resolve("src/preload/workbench.ts") },
      },
    },
  },
  renderer: {
    root: resolve("../shared/renderer"),
    server: {
      host: "127.0.0.1",
      hmr: { host: "127.0.0.1" },
    },
    build: {
      sourcemap: true,
      rollupOptions: {
        input: resolve("../shared/renderer/workbench.html"),
      },
    },
    resolve: {
      alias: {
        "@renderer": resolve("../shared/renderer/src"),
        "@shared": resolve("../shared/api"),
      },
    },
    plugins: [react()],
  },
});
