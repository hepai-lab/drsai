export function isDesktopDevelopment(): boolean {
  return process.env.OPENDRSAI_DESKTOP_DEV === "1";
}
