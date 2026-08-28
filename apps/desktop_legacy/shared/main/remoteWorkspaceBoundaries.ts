/** Enforced ownership map for the Remote Workspace implementation. */
export const REMOTE_WORKSPACE_BOUNDARIES = {
  ssh: ["sshExecutable.ts", "remoteWorkspace.ts"],
  connection: ["runtimeReliability.ts", "remoteWorkspace.ts"],
  protocol: ["runtimeClient.ts", "remoteGatewayClient.generated.ts", "remoteSshProtocol.ts"],
  workspace: ["workspaces.ts", "workspaceMigrations.ts", "runtime_registry.py"],
  files: ["remoteGatewayClient.generated.ts", "gateway.py"],
  git: ["remoteGatewayClient.generated.ts", "gateway.py"],
  pty: ["terminal.ts", "remote_pty.py"],
  runtimeEngine: ["runtime_engine.py", "agent_runtime.py"],
} as const;

export type RemoteWorkspaceBoundary = keyof typeof REMOTE_WORKSPACE_BOUNDARIES;
