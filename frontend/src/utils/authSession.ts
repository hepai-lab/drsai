/**
 * 本地账号密码登录时写入 token 为 `local_<timestamp>`；
 * 高能所 SSO 回调写入的是服务端下发的 token（通常不以 `local_` 开头）。
 */
export function isLocalPasswordLogin(): boolean {
  if (typeof window === "undefined") return false;
  const t = window.localStorage.getItem("token");
  return typeof t === "string" && t.startsWith("local_");
}
