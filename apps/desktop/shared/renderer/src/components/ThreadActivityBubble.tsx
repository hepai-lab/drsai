import type { AppLanguage } from "../navigation";
import type { ThreadActivityState } from "../threadActivity";

export interface ThreadActivityBubbleProps {
  state: Exclude<ThreadActivityState, { kind: "idle" }>;
  language: AppLanguage;
}

export function ThreadActivityBubble({
  state,
  language,
}: ThreadActivityBubbleProps): React.JSX.Element {
  const label = state.kind === "running"
    ? language === "zh" ? "正在运行" : "Running"
    : state.reason === "approval"
      ? language === "zh" ? "等待批准" : "Approval required"
      : language === "zh" ? "等待回复" : "Response required";
  const className = state.kind === "running"
    ? "thread-activity-bubble running"
    : `thread-activity-bubble attention ${state.reason}`;

  return (
    <span className={className} role="status" aria-label={label} title={label}>
      <i />
      <i />
      <i />
    </span>
  );
}
