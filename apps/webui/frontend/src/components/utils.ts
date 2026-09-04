import { RcFile } from "antd/es/upload";
import { IStatus } from "./types/app";

/** Same-origin fetch so OIDC Session cookies are sent (and CORS credentials if cross-origin). */
export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  return fetch(input, { ...init, credentials: init.credentials ?? "include" });
}

export const getServerUrl = () => {
  // 1. 显式配置优先：GATSBY_API_URL 覆盖一切（HTTPS 页面自动升级 http→https，避免 mixed content）
  if (process.env.GATSBY_API_URL) {
    const url = process.env.GATSBY_API_URL;
    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http://")) {
      return url.replace("http://", "https://");
    }
    return url;
  }

  // 2. 浏览器同源 /api：Gatsby develop 把 /api 代理到后端，OIDC Session Cookie 才能带上。
  if (typeof window !== "undefined") {
    return "/api";
  }

  // 3. PROD：前端由后端同源托管，走相对路径
  return "/api";
};

export function setCookie(name: string, value: any, days: number) {
  let expires = "";
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = "; expires=" + date.toUTCString();
  }
  document.cookie = name + "=" + (value || "") + expires + "; path=/";
}

export function getCookie(name: string) {
  const nameEQ = name + "=";
  const ca = document.cookie.split(";");
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) == " ") c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length, c.length);
  }
  return null;
}
export function setLocalStorage(
  name: string,
  value: any,
  stringify: boolean = true
) {
  if (stringify) {
    localStorage.setItem(name, JSON.stringify(value));
  } else {
    localStorage.setItem(name, value);
  }
}

export function getLocalStorage(name: string, stringify: boolean = true): any {
  if (typeof window !== "undefined") {
    const value = localStorage.getItem(name);
    try {
      if (stringify) {
        return JSON.parse(value!);
      } else {
        return value;
      }
    } catch (e) {
      return null;
    }
  } else {
    return null;
  }
}

export function fetchJSON(
  url: string | URL,
  payload: any = {},
  onSuccess: (data: any) => void,
  onError: (error: IStatus) => void,
  onFinal: () => void = () => {}
) {
  return fetch(url, payload)
    .then(function (response) {
      if (response.status !== 200) {
        response.json().then(function (data) {
          console.error("Error data", data);
        });
        onError({
          status: false,
          message:
            "Connection error " + response.status + " " + response.statusText,
        });
        return;
      }
      return response.json().then(function (data) {
        onSuccess(data);
      });
    })
    .catch(function (err) {
      console.error("Fetch Error", err);
      onError({
        status: false,
        message: `There was an error connecting to server. (${err}) `,
      });
    })
    .finally(() => {
      onFinal();
    });
}

export function eraseCookie(name: string) {
  document.cookie = name + "=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;";
}

export function truncateText(text: string, length = 50) {
  if (text.length > length) {
    return text.substring(0, length) + " ...";
  }
  return text;
}
/**
 * Parse a potentially i18n JSON description string (e.g. '{"en":"...","zh":"..."}')
 * and return the text for the given language.
 * Falls back to the raw string if parsing fails or the format doesn't match.
 */
export function getLocalizedDescription(
  description: string | undefined | null,
  lang: "zh" | "en"
): string {
  if (!description) return "";
  try {
    const parsed = JSON.parse(description);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (parsed[lang]) return parsed[lang];
      // Fallback: try the other language
      if (lang === "zh" && parsed.en) return parsed.en;
      if (lang === "en" && parsed.zh) return parsed.zh;
    }
  } catch {
    // not JSON — return as-is
  }
  return description;
}

/**
 * For search: concatenate text from both languages so that
 * searching in either language matches the description.
 */
export function getDescriptionForSearch(
  description: string | undefined | null
): string {
  if (!description) return "";
  try {
    const parsed = JSON.parse(description);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.values(parsed)
        .filter((v): v is string => typeof v === "string")
        .join(" ");
    }
  } catch {
    // not JSON — return as-is
  }
  return description;
}

export const fetchVersion = () => {
  const versionUrl = getServerUrl() + "/version";
  
  return fetch(versionUrl)
    .then((response) => response.json())
    .then((data) => {
      return data;
    })
    .catch((error) => {
      console.error("Error:", error);
      return null;
    });
};
