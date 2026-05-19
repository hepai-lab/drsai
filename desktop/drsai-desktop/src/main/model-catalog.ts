import * as http from "http";

const DRSAI_API_PORT = parseInt(process.env.DRSAI_API_PORT || "8642", 10);
const DRSAI_API_URL = `http://127.0.0.1:${DRSAI_API_PORT}`;

export interface ModelCatalogEntry {
  alias: string;
  display_name: string;
  client_type: string;
  model: string;
  token_limit: number;
  max_tokens: number;
}

export interface ModelCatalogResponse {
  default_alias: string;
  models: ModelCatalogEntry[];
}

export async function getModelCatalog(): Promise<ModelCatalogResponse> {
  return new Promise((resolve, reject) => {
    http
      .request(`${DRSAI_API_URL}/v1/config/model-catalog`, { method: "GET", timeout: 10000 }, (res) => {
        let body = "";
        res.on("data", (d: Buffer) => (body += d.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(body) as ModelCatalogResponse);
          } catch {
            reject(new Error("Invalid JSON"));
          }
        });
      })
      .on("error", reject)
      .on("timeout", function (this: http.ClientRequest) {
        this.destroy();
        reject(new Error("Request timed out"));
      })
      .end();
  });
}
