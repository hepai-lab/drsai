import type { GatsbyNode } from "gatsby";
import http from "http";
import https from "https";
import path from "path";

const DEV_BACKEND = process.env.GATSBY_API_URL
  ? process.env.GATSBY_API_URL.replace(/\/api$/, "")
  : `http://127.0.0.1:${process.env.GATSBY_DEV_API_PORT || "8086"}`;

function proxyToBackend(prefix: string, req: any, res: any) {
  const incoming = String(req.originalUrl || `${prefix}${req.url || ""}`);
  const target = new URL(incoming, DEV_BACKEND);
  const transport = target.protocol === "https:" ? https : http;
  const upstream = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: req.method,
      headers: req.headers,
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) {
      res.statusCode = 502;
      res.end("backend proxy failed");
    }
  });
  req.pipe(upstream);
}

export const onCreateDevServer: GatsbyNode["onCreateDevServer"] = ({ app }) => {
  // Gatsby develop is a separate origin from FastAPI. OIDC login/callback and
  // IHEP SSO must hit the backend so PKCE verifier + client_secret stay server-side.
  for (const prefix of ["/auth/login", "/auth/oidc", "/umt", "/api"]) {
    app.use(prefix, (req: any, res: any) => proxyToBackend(prefix, req, res));
  }
};


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
