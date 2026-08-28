import { request as httpRequest } from "http";
import type {
  GfsObjectInfo,
  GfsListRequest,
  GfsListResult,
  GfsUploadRequest,
  GfsDownloadRequest,
} from "../shared/desktopApi";
import { getAuthSession } from "./auth";
import { getGatewayRequestHeaders } from "./gateway";
import { resolveGatewayPort } from "../../../shared/main/gatewayEnvironment";

const GATEWAY_BASE_URL = `http://127.0.0.1:${resolveGatewayPort()}`;

async function gatewayFetch<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const session = await getAuthSession().catch(() => null);
  const userId =
    session?.user?.email?.trim() ||
    session?.user?.id?.trim() ||
    "";

  return new Promise((resolve, reject) => {
    const json = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      ...getGatewayRequestHeaders(),
      Accept: "application/json",
      ...(userId ? { "X-OpenDrSai-User": userId } : {}),
    };
    if (json) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(json).toString();
    }
    const url = new URL(path, GATEWAY_BASE_URL);
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`GFS gateway ${method} ${path} returned ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            resolve(JSON.parse(data) as T);
          } catch {
            reject(new Error(`GFS gateway response not JSON: ${data.slice(0, 200)}`));
          }
        });
      },
    );
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("GFS gateway request timed out"));
    });
    req.on("error", reject);
    if (json) req.write(json);
    req.end();
  });
}

export async function gfsList(req: GfsListRequest): Promise<GfsListResult> {
  return gatewayFetch("POST", "/v1/gfs/list", req);
}

export async function gfsStat(path: string): Promise<GfsObjectInfo> {
  return gatewayFetch("POST", "/v1/gfs/stat", { path });
}

export async function gfsRead(path: string): Promise<{ path: string; content: string }> {
  return gatewayFetch("POST", "/v1/gfs/read", { path });
}

export async function gfsWrite(
  path: string,
  content: string,
  contentType?: string,
): Promise<{ path: string; etag: string }> {
  return gatewayFetch("POST", "/v1/gfs/write", {
    path,
    content,
    ...(contentType ? { content_type: contentType, contentType } : {}),
  });
}

export async function gfsUploadFile(req: GfsUploadRequest): Promise<{ path: string; size: number }> {
  return gatewayFetch("POST", "/v1/gfs/upload", req);
}

export async function gfsDownloadFile(
  req: GfsDownloadRequest,
): Promise<{ localPath: string; size: number }> {
  return gatewayFetch("POST", "/v1/gfs/download", req);
}

export async function gfsDelete(path: string): Promise<{ path: string }> {
  return gatewayFetch("POST", "/v1/gfs/delete", { path });
}

export async function gfsShareUrl(
  path: string,
  ttlMinutes?: number,
  responseContentType?: string,
): Promise<{ url: string; expiresAt: string }> {
  return gatewayFetch("POST", "/v1/gfs/share-url", {
    path,
    ttl_minutes: ttlMinutes ?? 60,
    ...(responseContentType
      ? { response_content_type: responseContentType, responseContentType }
      : {}),
  });
}

export async function gfsHealthcheck(): Promise<{
  ok: boolean;
  bucket?: string;
  mode?: string;
  reason?: string;
}> {
  return gatewayFetch("GET", "/v1/gfs/health");
}
