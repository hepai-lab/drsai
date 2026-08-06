// Compatibility re-export. The active Windows Main process and every platform
// must use the shared implementation so identity/config write rules cannot
// diverge between duplicate copies.
export * from "../../../shared/main/myDrSaiConfig";
