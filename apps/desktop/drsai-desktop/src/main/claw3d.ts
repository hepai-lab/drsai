// Stub: claw3d module removed from DrSai Desktop
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Claw3dSetupProgress = any;
export async function getClaw3dStatus() { return { installed: false, running: false }; }
export async function setupClaw3d(_onProgress?: (p: Claw3dSetupProgress) => void) { return false; }
export async function startDevServer() { return false; }
export async function stopDevServer() { return false; }
export async function startAdapter() { return false; }
export async function stopAdapter() { return false; }
export async function startAll() { return false; }
export async function stopAll() { return false; }
export async function getClaw3dLogs() { return ""; }
export function setClaw3dPort(_port: number) {}
export function getClaw3dPort() { return 0; }
export function setClaw3dWsUrl(_url: string) {}
export function getClaw3dWsUrl() { return ""; }
