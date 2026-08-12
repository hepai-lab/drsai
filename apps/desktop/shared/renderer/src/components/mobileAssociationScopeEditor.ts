import type { DesktopMobileAssociation, WorkspaceProject } from "@shared/desktopApi";

export interface MobileAssociationScopeEditorState {
  workspaces: WorkspaceProject[];
  selectedIds: Set<string>;
  canSave: boolean;
}

export function mobileAssociationScopeEditorState(
  association: Pick<DesktopMobileAssociation, "workspace_scope" | "workspace_ids">,
  workspaces: WorkspaceProject[],
  selectedIds?: ReadonlySet<string>,
): MobileAssociationScopeEditorState {
  const current = new Set(association.workspace_ids ?? []);
  const options = workspaces
    .filter((workspace) => association.workspace_scope === "all" || current.has(workspace.id))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const allowed = new Set(options.map((workspace) => workspace.id));
  const selection = selectedIds === undefined
    ? new Set(allowed)
    : new Set([...selectedIds].filter((id) => allowed.has(id)));
  const strictReduction = association.workspace_scope === "all"
    ? selection.size > 0
    : selection.size > 0 && (
      selection.size < current.size || [...current].some((id) => !selection.has(id))
    );
  return { workspaces: options, selectedIds: selection, canSave: strictReduction };
}
