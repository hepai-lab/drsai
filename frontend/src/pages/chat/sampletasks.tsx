import { useAgentInfo } from "@/components/features/Agents/useAgentInfo";
import { appContext } from "@/hooks/provider";
import { useLang } from "@/i18n/useLang";
import { parseAgentExamples } from "@/utils/agentLocalizedText";
import { Select } from "antd";
import { ArrowUpRight } from "lucide-react";
import React, { useContext, useMemo } from "react";

interface SampleTasksProps {
  onSelect: (task: string) => void;
  /** When true, hide examples (input filled, example picked, or submit in flight). */
  hidden: boolean;
}

/** Number of examples shown inline before the "more" dropdown. */
const VISIBLE_COUNT = 4;

const isSlashCommand = (text: string) => /^\s*\//.test(text);

function exampleKey(task: string, idx: number): string {
  return `${idx}-${task.slice(0, 24)}`;
}

interface TaskChipProps {
  task: string;
  onSelect: (task: string) => void;
  layout?: "pill" | "row";
}

const TaskChip: React.FC<TaskChipProps> = ({
  task,
  onSelect,
  layout = "row",
}) => {
  const command = isSlashCommand(task);
  const label = command ? task.trim().split(/\s+/)[0] : task;
  const title = task.length > 48 ? task : command ? `使用 ${label}` : task;
  const isRow = layout === "row";

  return (
    <button
      type="button"
      title={title}
      onClick={() => onSelect(task)}
      className={`group flex items-center gap-2 text-left text-sm transition-all duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 ${isRow
        ? "w-full justify-between rounded-xl border px-4 py-3"
        : "inline-flex shrink-0 max-w-full gap-1.5 rounded-full border px-3.5 py-2"
        } ${command
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
        className={`h-3.5 w-3.5 shrink-0 transition-opacity duration-200 ${isRow
          ? "text-secondary/50 group-hover:text-accent group-hover:opacity-100 group-focus-visible:text-accent"
          : "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70"
          }`}
        aria-hidden
      />
    </button>
  );
};

/** Options for the antd `<Select>` built from the remaining examples. */
const restOptions = (items: string[]) =>
  items.map((task) => ({
    label: isSlashCommand(task) ? task.trim().split(/\s+/)[0] : task,
    value: task,
  }));

const SampleTasks: React.FC<SampleTasksProps> = ({ onSelect, hidden }) => {
  const { user } = useContext(appContext);
  const { lang, t } = useLang();
  const { agentInfo } = useAgentInfo(user?.email);
  const examples = useMemo(
    () => parseAgentExamples(agentInfo?.examples, lang),
    [agentInfo?.examples, lang]
  );

  const [visible, rest] = useMemo(
    () => [examples.slice(0, VISIBLE_COUNT), examples.slice(VISIBLE_COUNT)],
    [examples]
  );

  if (!examples.length || hidden) {
    return null;
  }

  return (
    <section className="mt-7 animate-fade-in" aria-label="示例任务">
      {/* <div className="mb-3 flex items-center justify-center gap-3">
        <span className="h-px w-10 bg-border-primary/60" aria-hidden />
        <span className="font-agent-mono text-[10px] font-medium uppercase tracking-[0.18em] text-secondary">
          试试这些
        </span>
        <span className="h-px w-10 bg-border-primary/60" aria-hidden />
      </div> */}

      <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
        {visible.map((task, idx) => (
          <TaskChip
            key={exampleKey(task, idx)}
            task={task}
            onSelect={onSelect}
            layout="row"
          />
        ))}
        {rest.length > 0 && (
          <Select
            placeholder={t("sampleTasks.more", rest.length)}
            options={restOptions(rest)}
            onChange={onSelect}
            className="w-full [&_.ant-select-selector]:!rounded-xl [&_.ant-select-selector]:!border-border-primary/55 [&_.ant-select-selector]:!bg-tertiary/25 [&_.ant-select-selector]:!shadow-none hover:[&_.ant-select-selector]:!border-accent/45 hover:[&_.ant-select-selector]:!bg-accent/[0.06] [&_.ant-select-selection-placeholder]:!text-secondary [&_.ant-select-arrow]:!text-secondary/50"
            popupClassName="!rounded-xl !border-border-primary/60 !bg-primary !shadow-xl [&_.ant-select-item]:!rounded-lg [&_.ant-select-item]:!text-primary [&_.ant-select-item-option-active]:!bg-accent/[0.08] [&_.ant-select-item-option-selected]:!bg-accent/[0.12] [&_.ant-select-item-option-selected]:!text-accent"
            size="middle"
            notFoundContent={null}
          />
        )}
      </div>
    </section>
  );
};

export default SampleTasks;
