import { RcFile } from "antd/es/upload";
import { IStatus } from "./types/app";

export const getServerUrl = () => {
  // 1. 显式配置优先：GATSBY_API_URL 覆盖一切（HTTPS 页面自动升级 http→https，避免 mixed content）
  if (process.env.GATSBY_API_URL) {
    const url = process.env.GATSBY_API_URL;
    if (typeof window !== "undefined" && window.location.protocol === "https:" && url.startsWith("http://")) {
      return url.replace("http://", "https://");
    }
    return url;
  }

  // 2. DEV 模式（前端 4290 与后端 4291 分离）：用浏览器当前 hostname 推导后端地址。
  //    读 window.location.hostname（地址栏里那个 IP），与容器内网卡 IP 无关——
  //    无论 drsai 跑在容器还是宿主机，都能指向「你用来访问它的那个 IP」的后端端口。
  if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    const port = process.env.GATSBY_DEV_API_PORT || "4291";
    return `${window.location.protocol}//${window.location.hostname}:${port}/api`;
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

