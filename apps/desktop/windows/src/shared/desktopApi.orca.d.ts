import "./desktopApi";

declare module "./desktopApi" {
  interface DesktopThreadExecutionBinding {
    sourceWorkspaceId: string;
    workspaceId: string;
    worktreeId: string;
    canonicalPath: string;
  }

  interface DesktopThread {
    execution?: DesktopThreadExecutionBinding;
  }

  interface CreateThreadRequest {
    execution?: DesktopThreadExecutionBinding;
  }

  interface UpdateThreadRequest {
    execution?: DesktopThreadExecutionBinding;
  }

  interface DesktopWorktreeMigrationDiagnostic {
    threadId: string;
    status: "migrated" | "pending";
    code?: string;
    message: string;
    retryable: boolean;
    worktreeId?: string;
    workspaceId?: string;
  }

  interface DesktopApi {
    getWorktreeMigrationDiagnostics(request: DesktopWorktreeListRequest): Promise<DesktopWorktreeMigrationDiagnostic[]>;
  }
}

export {};
