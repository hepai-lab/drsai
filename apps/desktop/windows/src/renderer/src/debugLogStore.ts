export type DebugLogLevel = "log" | "info" | "warn" | "error";
export interface DebugLogEntry { id:number; level:DebugLogLevel; message:string; timestamp:number; source:"console"|"window"|"promise"; }
const listeners = new Set<() => void>();
let entries: DebugLogEntry[] = [];
let nextId = 1;
let installed = false;
export const getDebugLogs = (): DebugLogEntry[] => entries;
export function subscribeDebugLogs(listener:()=>void):()=>void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function clearDebugLogs():void { entries=[]; listeners.forEach((listener)=>listener()); }
export function installDebugLogCapture():void {
  if(installed) return; installed=true;
  (["log","info","warn","error"] as const).forEach((level)=>{ const original=console[level].bind(console); console[level]=(...args:unknown[])=>{ original(...args); append(level,args.map(format).join(" "),"console"); }; });
  window.addEventListener("error",(event)=>append("error",event.error?.stack||event.message,"window"));
  window.addEventListener("unhandledrejection",(event)=>append("error",format(event.reason),"promise"));
  append("info","Debug output capture started","console");
}
function append(level:DebugLogLevel,message:string,source:DebugLogEntry["source"]):void { entries=[...entries,{id:nextId++,level,message,timestamp:Date.now(),source}].slice(-1000); listeners.forEach((listener)=>listener()); }
function format(value:unknown):string { if(value instanceof Error)return value.stack||value.message; if(typeof value==="string")return value; try{return JSON.stringify(value,null,2);}catch{return String(value);} }
