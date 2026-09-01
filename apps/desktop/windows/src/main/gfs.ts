import { request as httpRequest } from "http";
import { basename, join } from "path";
import { BrowserWindow, app, dialog, shell } from "electron";
import type {
  GfsObjectInfo,
  GfsListRequest,
  GfsListResult,
  GfsUploadRequest,
  GfsDownloadRequest,
} from "../shared/desktopApi";
import { getAuthSession } from "./auth";
import { getAuthenticatedGatewayRequestHeaders } from "./gateway";
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
  const authHeaders = await getAuthenticatedGatewayRequestHeaders();

  return new Promise((resolve, reject) => {
    const json = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      ...authHeaders,
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

export async function gfsUploadContent(request: {
  remotePath: string;
  contentBase64: string;
  contentType?: string;
}): Promise<{ path: string; size: number; etag?: string }> {
  return gatewayFetch("POST", "/v1/gfs/upload-content", {
    remotePath: request.remotePath,
    contentBase64: request.contentBase64,
    ...(request.contentType ? { contentType: request.contentType } : {}),
  });
}

export async function gfsDownloadFile(
  req: GfsDownloadRequest,
): Promise<{ localPath: string; size: number }> {
  return gatewayFetch("POST", "/v1/gfs/download", req);
}

/**
 * Prompt for a local save path, then download the remote GFS object via gateway.
 * Avoids opening a signed URL in the system browser (images would preview inline).
 */
export async function gfsDownloadToDisk(
  remotePath: string,
): Promise<{ canceled: boolean; localPath?: string; size?: number }> {
  const suggestedName = basename(remotePath.replace(/\/+$/, "")) || "gfs-download";
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  const selected = win
    ? await dialog.showSaveDialog(win, {
        title: "保存到本地",
        defaultPath: join(app.getPath("downloads"), suggestedName),
        buttonLabel: "保存",
      })
    : await dialog.showSaveDialog({
        title: "保存到本地",
        defaultPath: join(app.getPath("downloads"), suggestedName),
        buttonLabel: "保存",
      });
  if (selected.canceled || !selected.filePath) {
    return { canceled: true };
  }
  const result = await gfsDownloadFile({
    remotePath,
    localPath: selected.filePath,
  });
  try {
    shell.showItemInFolder(result.localPath);
  } catch {
    // reveal is best-effort
  }
  return { canceled: false, localPath: result.localPath, size: result.size };
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
  needsSetup?: boolean;
  portalUrl?: string;
}> {
  return gatewayFetch("GET", "/v1/gfs/health");
}

export async function gfsGetConfig(): Promise<{
  configured: boolean;
  enabled: boolean;
  needsSetup: boolean;
  mode: string;
  bucket?: string;
  email?: string;
  endpoint?: string;
  portalUrl: string;
  homeEnvPath?: string;
  cliConfigPath?: string;
  accessKeyMasked?: string;
  secretKeyMasked?: string;
  accessKey?: string;
  secretKey?: string;
}> {
  return gatewayFetch("GET", "/v1/gfs/config");
}

export async function gfsSaveConfig(request: {
  accessKey: string;
  secretKey: string;
  bucket: string;
  email?: string;
  endpoint?: string;
}): Promise<{
  ok: boolean;
  configured: boolean;
  enabled?: boolean;
  needsSetup: boolean;
  mode: string;
  bucket?: string;
  portalUrl: string;
  message?: string;
  homeEnvPath?: string;
  cliConfigPath?: string;
  accessKeyMasked?: string;
  secretKeyMasked?: string;
}> {
  return gatewayFetch("POST", "/v1/gfs/config", request);
}

export async function gfsClearConfig(): Promise<{
  ok: boolean;
  configured: boolean;
  enabled: boolean;
  needsSetup: boolean;
  mode: string;
  portalUrl: string;
  message?: string;
  homeEnvPath?: string;
  cliConfigPath?: string;
}> {
  return gatewayFetch("DELETE", "/v1/gfs/config");
}
