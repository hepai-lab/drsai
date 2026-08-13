import type { DesktopMobileAssociation, WorkspaceProject } from "@shared/desktopApi";

export interface MobileAssociationScopeEditorState {
  workspaces: WorkspaceProject[];
  selectedIds: Set<string>;
  selectedPermissions: Set<DesktopMobileAssociation["permissions"][number]>;
  canSave: boolean;
}

export function mobileAssociationScopeEditorState(
  association: Pick<DesktopMobileAssociation, "workspace_scope" | "workspace_ids" | "permissions">,
  workspaces: WorkspaceProject[],
  selectedIds?: ReadonlySet<string>,
  selectedPermissions?: ReadonlySet<DesktopMobileAssociation["permissions"][number]>,
): MobileAssociationScopeEditorState {
  const current = new Set(association.workspace_ids ?? []);
  const options = workspaces
    .filter((workspace) => association.workspace_scope === "all" || current.has(workspace.id))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const allowed = new Set(options.map((workspace) => workspace.id));
  const selection = selectedIds === undefined
    ? new Set(allowed)
    : new Set([...selectedIds].filter((id) => allowed.has(id)));
  const workspaceReduction = association.workspace_scope === "all"
    ? selection.size > 0
    : selection.size > 0 && (
      selection.size < current.size || [...current].some((id) => !selection.has(id))
    );
  const currentPermissions = new Set(association.permissions);
  const permissionSelection = selectedPermissions === undefined
    ? new Set(currentPermissions)
    : new Set([...selectedPermissions].filter((permission) => currentPermissions.has(permission)));
  const permissionReduction = permissionSelection.size > 0
    && permissionSelection.size < currentPermissions.size;
  return {
    workspaces: options,
    selectedIds: selection,
    selectedPermissions: permissionSelection,
    canSave: permissionSelection.size > 0 && (workspaceReduction || permissionReduction),
  };
}
