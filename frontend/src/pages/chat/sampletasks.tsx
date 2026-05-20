import { useAgentInfo } from "@/components/features/Agents/useAgentInfo";
import { appContext } from "@/hooks/provider";
import { ArrowUpRight } from "lucide-react";
import React, { useContext, useMemo } from "react";

interface SampleTasksProps {
  onSelect: (task: string) => void;
  /** When true, hide examples (input filled, example picked, or submit in flight). */
  hidden: boolean;
}

const MARQUEE_THRESHOLD = 4;
const ROW_COUNT = 2;
const MARQUEE_ROW_DURATIONS = ["38s", "44s"] as const;

const MARQUEE_MASK: React.CSSProperties = {
  maskImage:
    "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
  WebkitMaskImage:
    "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
};

const isSlashCommand = (text: string) => /^\s*\//.test(text);

function splitIntoRows<T>(items: T[], rowCount: number): T[][] {
  const rows = Array.from({ length: rowCount }, () => [] as T[]);
  items.forEach((item, i) => {
    rows[i % rowCount].push(item);
  });
  return rows;
}

/** Pad sparse rows so the loop track is wide enough for a smooth marquee. */
function buildMarqueeLoop(items: string[]): string[] {
  let segment = items;
  while (segment.length < 4) {
    segment = [...segment, ...items];
  }
  return [...segment, ...segment];
}

interface TaskChipProps {
  task: string;
  onSelect: (task: string) => void;
  duplicate?: boolean;
  /** Marquee track uses pills; few items use full-width rows */
  layout?: "pill" | "row";
}

const TaskChip: React.FC<TaskChipProps> = ({
  task,
  onSelect,
  duplicate = false,
  layout = "pill",
}) => {
  const command = isSlashCommand(task);
  const label = command ? task.trim().split(/\s+/)[0] : task;
  const title = task.length > 48 ? task : command ? `使用 ${label}` : task;
  const isRow = layout === "row";

  return (
    <button
      type="button"
      title={title}
      tabIndex={duplicate ? -1 : undefined}
      aria-hidden={duplicate || undefined}
      onClick={() => onSelect(task)}
      className={`group flex items-center gap-2 text-left text-sm transition-all duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${
        isRow
          ? "w-full justify-between rounded-xl border px-4 py-3"
          : "inline-flex shrink-0 max-w-full gap-1.5 rounded-full border px-3.5 py-2"
      } ${
        command
          ? "border-accent/40 bg-accent/[0.08] font-agent-mono text-accent shadow-[0_0_0_1px_rgba(124,58,237,0.06)] hover:border-accent/60 hover:bg-accent/[0.14] dark:bg-accent/[0.12] dark:hover:bg-accent/[0.18]"
          : "border-border-primary/55 bg-tertiary/25 text-primary hover:border-accent/45 hover:bg-accent/[0.06] dark:bg-tertiary/35"
      }`}
    >
      <span
        className={
          command
            ? "min-w-0 truncate"
            : isRow
              ? "min-w-0 flex-1 truncate"
              : "line-clamp-2 max-w-[16rem]"
        }
      >
        {label}
      </span>
      <ArrowUpRight
        className={`h-3.5 w-3.5 shrink-0 transition-opacity duration-200 ${
          isRow
            ? "text-secondary/50 group-hover:text-accent group-hover:opacity-100 group-focus-visible:text-accent"
            : "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70"
        }`}
        aria-hidden
      />
    </button>
  );
};

interface MarqueeRowProps {
  items: string[];
  duration: string;
  onSelect: (task: string) => void;
}

const MarqueeRow: React.FC<MarqueeRowProps> = ({
  items,
  duration,
  onSelect,
}) => {
  const loop = useMemo(() => buildMarqueeLoop(items), [items]);
  const segmentLen = loop.length / 2;

  return (
    <div className="group/row relative overflow-hidden" style={MARQUEE_MASK}>
      <div
        className="flex w-max gap-4 motion-reduce:animate-none animate-marquee-x group-hover/row:[animation-play-state:paused]"
        style={{ ["--marquee-duration" as string]: duration }}
      >
        {loop.map((task, idx) => (
          <TaskChip
            key={`${idx}-${task.slice(0, 24)}`}
            task={task}
            onSelect={onSelect}
            duplicate={idx >= segmentLen}
          />
        ))}
      </div>
    </div>
  );
};

const SampleTasks: React.FC<SampleTasksProps> = ({ onSelect, hidden }) => {
  const { user } = useContext(appContext);
  const { agentInfo } = useAgentInfo(user?.email);
  const examples = agentInfo?.examples ?? [];

  const useMarquee = examples.length > MARQUEE_THRESHOLD;
  const marqueeRows = useMemo(
    () => (useMarquee ? splitIntoRows(examples, ROW_COUNT) : []),
    [examples, useMarquee]
  );

  if (!examples.length || hidden) {
    return null;
  }

  return (
    <section className="mt-7 animate-fade-in" aria-label="示例任务">
      <div className="mb-3 flex items-center justify-center gap-3">
        <span className="h-px w-10 bg-border-primary/60" aria-hidden />
        <span className="font-agent-mono text-[10px] font-medium uppercase tracking-[0.18em] text-secondary">
          试试这些
        </span>
        <span className="h-px w-10 bg-border-primary/60" aria-hidden />
      </div>

      {useMarquee ? (
        <div className="flex flex-col gap-4">
          {marqueeRows.map((rowItems, rowIdx) =>
            rowItems.length > 0 ? (
              <MarqueeRow
                key={rowIdx}
                items={rowItems}
                duration={MARQUEE_ROW_DURATIONS[rowIdx] ?? "40s"}
                onSelect={onSelect}
              />
            ) : null
          )}
        </div>
      ) : (
        <ul className="mx-auto flex w-full max-w-xl flex-col gap-2">
          {examples.map((task, idx) => (
            <li key={`${idx}-${task.slice(0, 24)}`}>
              <TaskChip
                task={task}
                onSelect={onSelect}
                layout="row"
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default SampleTasks;
