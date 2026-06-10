/**
 * Backend returns naive ISO datetimes (no Z / offset). Treat them as UTC instants,
 * then format or bucket using Asia/Shanghai for consistent 北京时间 display.
 */

const DISPLAY_TIME_ZONE = "Asia/Shanghai";

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function hasExplicitTimezone(isoLike: string): boolean {
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(isoLike.trim());
}

/** Parse backend naive datetime string as a UTC instant (append Z when offset missing). */
export function parseApiDateAsUtc(isoLike: string | undefined | null): Date | null {
  if (isoLike == null) return null;
  const s = String(isoLike).trim();
  if (!s) return null;
  const d = hasExplicitTimezone(s) ? new Date(s) : new Date(`${s}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function apiDatetimeToUtcMs(isoLike: string | undefined | null): number {
  const d = parseApiDateAsUtc(isoLike ?? "");
  return d ? d.getTime() : 0;
}

/** Midnight at the start of this calendar day in Shanghai, as UTC ms. */
export function shanghaiMidnightUtcMs(yyyyMmDd: string): number {
  const parts = yyyyMmDd.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return NaN;
  return Date.parse(`${y}-${pad2(m)}-${pad2(d)}T00:00:00+08:00`);
}

/** YYYY-MM-DD in Asia/Shanghai for an instant. */
export function getCalendarDayAsiaShanghai(instant: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

export function todayCalendarAsiaShanghai(now: Date = new Date()): string {
  return getCalendarDayAsiaShanghai(now);
}

/** Shift a Shanghai calendar day by deltaDays (China has no DST; noon UTC+8 anchor). */
export function addCalendarDaysAsiaShanghai(yyyyMmDd: string, deltaDays: number): string {
  const parts = yyyyMmDd.split("-").map(Number);
  const [y, m, d] = parts;
  if (!y || !m || !d) return "";
  const anchorMs = Date.parse(`${y}-${pad2(m)}-${pad2(d)}T12:00:00+08:00`);
  if (Number.isNaN(anchorMs)) return "";
  return getCalendarDayAsiaShanghai(new Date(anchorMs + deltaDays * 86400000));
}

/** API ISO string → 北京时间 locale display */
export function formatApiDateTimeZhCN(isoLike: string | undefined | null): string {
  const d = parseApiDateAsUtc(isoLike ?? "");
  if (!d) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

/** Unix timestamp (seconds or ms) → 北京时间 display */
export function formatUnixForDisplayZhCN(unix: number | string | undefined | null): string {
  if (unix === undefined || unix === null) return "—";
  const n = typeof unix === "number" ? unix : Number(unix);
  if (!Number.isFinite(n)) return "—";
  const ms = n > 1e12 ? n : n * 1000;
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

/** For chat payloads: epoch seconds for FilesEvent / logs; ISO strings parsed as UTC API time. */
export function parseFlexibleTimestampToUnixSeconds(raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 1e12 ? raw / 1000 : raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const num = Number(trimmed);
    if (Number.isFinite(num) && trimmed === String(num)) {
      return num > 1e12 ? num / 1000 : num;
    }
    const d = parseApiDateAsUtc(trimmed);
    return d ? d.getTime() / 1000 : undefined;
  }
  return undefined;
}
