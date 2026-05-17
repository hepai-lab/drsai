// Stub: memory module removed from DrSai Desktop
export async function readMemory(_profile?: string): Promise<string> { return ""; }
export async function addMemoryEntry(_content: string, _profile?: string): Promise<number> { return 0; }
export async function updateMemoryEntry(_index: number, _content: string, _profile?: string): Promise<boolean> { return true; }
export async function removeMemoryEntry(_index: number, _profile?: string): Promise<boolean> { return true; }
export async function writeUserProfile(_content: string, _profile?: string): Promise<boolean> { return true; }
