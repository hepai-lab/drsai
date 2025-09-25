import type { GatsbyNode } from "gatsby";
import path from "path";

export const onCreateWebpackConfig: GatsbyNode["onCreateWebpackConfig"] = ({ actions, getConfig, stage }) => {
  const config = getConfig();
  const alias = {
    ...(config.resolve && config.resolve.alias ? config.resolve.alias : {}),
    "@": path.resolve(__dirname, "src"),
  } as Record<string, string>;

  actions.setWebpackConfig({
    resolve: {
      alias,
      extensions: config.resolve ? config.resolve.extensions : [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  });
};
