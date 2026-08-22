import type { ComponentProps } from "react";
import { WorkspaceShell } from "../components/WorkspaceShell";

export type TaskShellContainerProps = ComponentProps<typeof WorkspaceShell>;

/** Stable application composition boundary for workspace/task navigation. */
export function TaskShellContainer(props: TaskShellContainerProps): React.JSX.Element {
  return <WorkspaceShell {...props} />;
}
