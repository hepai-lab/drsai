import { ArrowDown, ArrowUp } from "lucide-react";
import React from "react";

export interface StatsCardItem {
  title: string;
  value: string | number;
  /** Positive = up (green), negative = down (red), 0 = neutral */
  change: number;
  /** Optional secondary description below the change, e.g. "较上月" */
  changeLabel?: string;
}

interface StatsCardsProps {
  items: StatsCardItem[];
}

const StatsCards: React.FC<StatsCardsProps> = ({ items }) => {
  if (!items.length) return null;

  return (
    <div className="flex gap-4 pr-4">
      {items.map((item, idx) => {
        const isUp = item.change > 0;
        const isDown = item.change < 0;
        const absChange = Math.abs(item.change);

        return (
          <div
            key={idx}
            className="flex-1 rounded-xl border border-gray-200/60 bg-white px-4 py-3 shadow-sm dark:border-white/[0.06] dark:bg-slate-900"
          >
            <div className="text-[11px] font-medium text-secondary dark:text-secondary">
              {item.title}
            </div>
            <div className="mt-1 text-2xl font-bold tracking-tight text-primary dark:text-white">
              {item.value}
            </div>
            <div className="mt-1 flex items-center gap-1 text-[11px]">
              {isUp && (
                <ArrowUp className="h-3 w-3 text-green-500" />
              )}
              {isDown && (
                <ArrowDown className="h-3 w-3 text-red-500" />
              )}
              <span
                className={
                  isUp
                    ? "text-green-600 dark:text-green-400"
                    : isDown
                      ? "text-red-600 dark:text-red-400"
                      : "text-secondary"
                }
              >
                {absChange}%
              </span>
              {(item.changeLabel || isUp || isDown) && (
                <span className="text-secondary">
                  {item.changeLabel || "较上月"}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default StatsCards;