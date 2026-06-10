import type { GatsbyNode } from "gatsby";
import path from "path";

export const onCreateWebpackConfig: GatsbyNode["onCreateWebpackConfig"] = ({ actions, getConfig, stage }) => {
  const config = getConfig();
  /** Bare `echarts` resolves to ESM index.js (`import` field), which webpack often mis-analyzes
   * (`LineChart` re-exports). Point exact package imports at the shipped UMD build instead. */
  const echartsBundle = path.resolve(__dirname, "node_modules/echarts/dist/echarts.min.js");
  const alias = {
    ...(config.resolve && config.resolve.alias ? config.resolve.alias : {}),
    "@": path.resolve(__dirname, "src"),
    echarts$: echartsBundle,
  } as Record<string, string>;

  actions.setWebpackConfig({
    resolve: {
      alias,
      extensions: config.resolve ? config.resolve.extensions : [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  });
};
