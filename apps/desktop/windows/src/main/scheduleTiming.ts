import { createHash } from "crypto";
import type {
  DesktopScheduledTask,
  DesktopScheduledTaskTriggerAudit,
} from "../shared/desktopApi";

export const DEFAULT_MISSED_RUN_POLICY = "run_once_immediately" as const;
export const DEFAULT_DAYLIGHT_SAVING_POLICY = "follow_timezone_wall_clock" as const;

export function createScheduledTriggerAudit(
  task: DesktopScheduledTask,
  triggeredAt: string,
): DesktopScheduledTaskTriggerAudit {
  const scheduledFor = task.nextRunAt ?? triggeredAt;
  const missedByMs = Math.max(0, Date.parse(triggeredAt) - Date.parse(scheduledFor));
  const timezone = task.userDefinition?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return {
    triggerKey: createHash("sha256").update(`${task.id}\n${scheduledFor}`).digest("hex"),
    scheduledFor,
    triggeredAt,
    missed: missedByMs > 1000,
    missedByMs,
    missedRunPolicy: task.missedRunPolicy ?? DEFAULT_MISSED_RUN_POLICY,
    timezone,
    daylightSavingPolicy: DEFAULT_DAYLIGHT_SAVING_POLICY,
  };
}

export function getNextRunAfterTrigger(
  task: DesktopScheduledTask,
  triggeredAt: string,
): string | undefined {
  if (task.cadence === "manual") return undefined;
  const now = new Date(triggeredAt);
  if (Number.isNaN(now.getTime())) return undefined;
  const definition = task.userDefinition;
  if (definition?.localTime && (task.cadence === "daily" || task.cadence === "weekly")) {
    const [hour, minute] = definition.localTime.split(":").map(Number);
    const timezone = definition.timezone || "UTC";
    const weekday = task.cadence === "weekly" ? definition.weekday : undefined;
    return nextWallClockOccurrence(now, timezone, hour, minute, weekday).toISOString();
  }
  const next = new Date(task.nextRunAt ?? triggeredAt);
  const incrementMs = task.cadence === "hourly" ? 60 * 60 * 1000 : task.cadence === "daily" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  while (next.getTime() <= now.getTime()) next.setTime(next.getTime() + incrementMs);
  return next.toISOString();
}

export function nextWallClockOccurrence(
  after: Date,
  timezone: string,
  hour: number,
  minute: number,
  weekday?: number,
): Date {
  const local = getZonedParts(after, timezone);
  let daysAhead = weekday === undefined ? 0 : (weekday - local.weekday + 7) % 7;
  let candidate = zonedTimeToUtc(local.year, local.month, local.day + daysAhead, hour, minute, timezone);
  if (candidate.getTime() <= after.getTime()) {
    daysAhead += weekday === undefined ? 1 : 7;
    candidate = zonedTimeToUtc(local.year, local.month, local.day + daysAhead, hour, minute, timezone);
  }
  return candidate;
}

function getZonedParts(date: Date, timezone: string): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday: weekdays[values.weekday] ?? 0,
  };
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string,
): Date {
  const normalized = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  const targetParts = {
    year: normalized.getUTCFullYear(),
    month: normalized.getUTCMonth() + 1,
    day: normalized.getUTCDate(),
  };
  const targetWallClock = Date.UTC(targetParts.year, targetParts.month - 1, targetParts.day, hour, minute, 0, 0);
  let guess = targetWallClock;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const offset = getTimezoneOffsetMs(new Date(guess), timezone);
    guess = targetWallClock - offset;
  }
  return new Date(guess);
}

function getTimezoneOffsetMs(date: Date, timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  });
  const values = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - date.getTime();
}
