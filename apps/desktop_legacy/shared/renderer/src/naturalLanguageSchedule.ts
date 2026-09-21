import type {
  DesktopScheduledTaskCadence,
  DesktopScheduledTaskUserDefinition,
} from "@shared/desktopApi";

export interface NaturalLanguageScheduleDraft {
  title: string;
  cadence: DesktopScheduledTaskCadence;
  target: string;
  nextRunAt: string;
  definition: Omit<DesktopScheduledTaskUserDefinition, "confirmedAt">;
}

const CHINESE_WEEKDAYS: Record<string, number> = {
  日: 0,
  天: 0,
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
};

export function parseNaturalLanguageSchedule(
  sourceText: string,
  workspacePath: string,
  now = new Date(),
): NaturalLanguageScheduleDraft {
  const text = sourceText.trim();
  if (!text) throw new Error("请先用一句话说明什么时候、对什么材料做什么。 ");
  if (!workspacePath.trim()) throw new Error("请先打开要检查的文件夹。 ");

  const weekdayText = text.match(/每周([一二三四五六日天])/u)?.[1];
  const weekday = weekdayText ? CHINESE_WEEKDAYS[weekdayText] : undefined;
  const time = parseChineseTime(text);
  if (weekday === undefined || !time) {
    throw new Error("暂时没有读懂时间。请按“每周一上午九点……”这样的方式再说一次。 ");
  }
  if (!/(这个文件夹|当前文件夹|文件夹)/u.test(text)) {
    throw new Error("请说明要检查“这个文件夹”或“当前文件夹”。 ");
  }

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";
  const localTime = `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`;
  const actionDescription = /(新数据|新增数据|新文件)/u.test(text)
    ? "检查文件夹中的新数据"
    : "检查文件夹中的变化";

  return {
    title: "每周检查文件夹新数据",
    cadence: "weekly",
    target: workspacePath.trim(),
    nextRunAt: getNextWeeklyRunAt(now, weekday, time.hour, time.minute),
    definition: {
      sourceText: text,
      timeDescription: `每周${weekdayText} ${localTime}`,
      materialDescription: `当前文件夹：${workspacePath.trim()}`,
      actionDescription,
      notificationDescription: "完成后通过 Windows 通知",
      timezone,
      weekday,
      localTime,
    },
  };
}

export function getNextWeeklyRunAt(
  now: Date,
  weekday: number,
  hour: number,
  minute: number,
): string {
  const next = new Date(now.getTime());
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  const daysAhead = (weekday - now.getDay() + 7) % 7;
  next.setDate(now.getDate() + daysAhead);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 7);
  return next.toISOString();
}

function parseChineseTime(text: string): { hour: number; minute: number } | null {
  const match = text.match(/(上午|下午|晚上|中午)?\s*([零〇一二两三四五六七八九十\d]{1,3})[点时](?:([零〇一二三四五六七八九十\d]{1,3})分?)?/u);
  if (!match) return null;
  let hour = parseChineseNumber(match[2]);
  const minute = match[3] ? parseChineseNumber(match[3]) : 0;
  if (hour === null || minute === null || minute > 59) return null;
  if ((match[1] === "下午" || match[1] === "晚上") && hour < 12) hour += 12;
  if (match[1] === "上午" && hour === 12) hour = 0;
  if (match[1] === "中午" && hour < 11) hour += 12;
  if (hour > 23) return null;
  return { hour, minute };
}

function parseChineseNumber(value: string): number | null {
  if (/^\d+$/u.test(value)) return Number(value);
  const digits: Record<string, number> = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (value === "十") return 10;
  if (value.includes("十")) {
    const [tens, units] = value.split("十");
    return (tens ? digits[tens] : 1) * 10 + (units ? digits[units] : 0);
  }
  return value.length === 1 ? (digits[value] ?? null) : null;
}
