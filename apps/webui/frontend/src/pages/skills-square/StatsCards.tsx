import { ArrowDown, ArrowUp } from "lucide-react";
import React from "react";

export interface StatsCardItem {
  title: string;
  value: string | number;
  /** Positive = up (green), negative = down (red), 0 = neutral */
  change: number;
  /** Optional secondary description below the change, e.g. "较上月" */
  changeLabel?: string;
  /** Optional icon component to display */
  icon?: React.ElementType;
  /** Optional accent color class for the icon background, e.g. "bg-blue-50 text-blue-600" */
  iconColor?: string;
}

interface StatsCardsProps {
  items: StatsCardItem[];
}

const CARD_STYLES = [
  {
    iconBg: "from-blue-50 to-indigo-50 text-blue-600 border-blue-100 dark:from-blue-950/40 dark:to-indigo-950/40 dark:text-blue-400 dark:border-blue-800/50",
    glow: "bg-blue-400/8 dark:bg-blue-500/12",
    accent: "via-blue-400/60",
  },
  {
    iconBg: "from-emerald-50 to-teal-50 text-emerald-600 border-emerald-100 dark:from-emerald-950/40 dark:to-teal-950/40 dark:text-emerald-400 dark:border-emerald-800/50",
    glow: "bg-emerald-400/8 dark:bg-emerald-500/12",
    accent: "via-emerald-400/60",
  },
  {
    iconBg: "from-violet-50 to-purple-50 text-violet-600 border-violet-100 dark:from-violet-950/40 dark:to-purple-950/40 dark:text-violet-400 dark:border-violet-800/50",
    glow: "bg-violet-400/8 dark:bg-violet-500/12",
    accent: "via-violet-400/60",
  },
  {
    iconBg: "from-amber-50 to-orange-50 text-amber-600 border-amber-100 dark:from-amber-950/40 dark:to-orange-950/40 dark:text-amber-400 dark:border-amber-800/50",
    glow: "bg-amber-400/8 dark:bg-amber-500/12",
    accent: "via-amber-400/60",
  },
];

const StatsCards: React.FC<StatsCardsProps> = ({ items }) => {
  if (!items.length) return null;

  return (
    <div className="flex gap-4 pr-4">
      {items.map((item, idx) => {
        const isUp = item.change > 0;
        const isDown = item.change < 0;
        const absChange = Math.abs(item.change);
        const style = CARD_STYLES[idx % CARD_STYLES.length];
        const iconColor = item.iconColor || style.iconBg;
        const IconComp = item.icon;

        return (
          <div
            key={idx}
            className="group relative flex-1 cursor-default overflow-hidden rounded-xl border border-gray-200/60 bg-white px-4 py-3.5 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-gray-300/80 hover:shadow-md dark:border-white/[0.06] dark:bg-slate-900 dark:hover:border-white/[0.1]"
          >
            {/* Subtle gradient glow blob */}
            <div className={`pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-40 blur-2xl transition-opacity duration-300 group-hover:opacity-70 ${style.glow}`} />

            {/* Top accent stripe */}
            <div className={`absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent ${style.accent} to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100`} />

            <div className="relative flex items-start justify-between">
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-secondary/70 dark:text-secondary">
                  {item.title}
                </div>
                <div className="mt-1.5 text-2xl font-bold tracking-tight text-primary dark:text-white">
                  {item.value}
                </div>
              </div>
              {IconComp && (
                <div
                  className={`ml-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border bg-gradient-to-br shadow-sm transition-transform duration-300 group-hover:scale-110 ${iconColor}`}
                >
                  <IconComp className="h-4.5 w-4.5" />
                </div>
              )}
            </div>
            {item.change !== 0 && (
              <div className="relative mt-2.5 flex items-center gap-1 text-[11px]">
                {isUp && (
                  <ArrowUp className="h-3 w-3 text-green-500" />
                )}
                {isDown && (
                  <ArrowDown className="h-3 w-3 text-red-500" />
                )}
                <span
                  className={
                    isUp
                      ? "font-medium text-green-600 dark:text-green-400"
                      : "font-medium text-red-600 dark:text-red-400"
                  }
                >
                  {absChange}%
                </span>
                {item.changeLabel && (
                  <span className="text-secondary/60">
                    {item.changeLabel}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default StatsCards;