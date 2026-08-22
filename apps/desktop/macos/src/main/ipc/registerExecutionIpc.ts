import type { IpcMain } from "electron";
import { abortAgentRun, recoverAgentRun, startAgentRun } from "../../../../shared/main/agentRuns";
import { getA5ServiceGuidanceScenario } from "../../../../shared/main/a5ServiceGuidanceScenario";
import { applyAnomalyDecision } from "../../../../shared/main/anomalyDecision";
import { cancelChatTurn, recoverChatRun, respondChatInput, startChat } from "../../../../shared/main/chat";
import { analyzeMaterialConsistency, analyzeMaterialRoles, queryMaterials } from "../../../../shared/main/workspaceContext";
import type { MacosServiceContainer } from "../serviceContainer";

export function registerMacosExecutionIpc(ipcMain: Pick<IpcMain, "handle">, services: Pick<MacosServiceContainer, "workspace">): void {
  ipcMain.handle("desktop:material-role-analysis", (_event, request) => analyzeMaterialRoles(request));
  ipcMain.handle("desktop:material-consistency-analysis", (_event, request) => analyzeMaterialConsistency(request));
  ipcMain.handle("desktop:material-query", (_event, request) => queryMaterials(request));
  ipcMain.handle("desktop:apply-anomaly-decision", async (_event, request) => { await services.workspace.assertPath(request?.workspacePath); return applyAnomalyDecision(request); });
  ipcMain.handle("desktop:start-agent-run", (event, request) => { if (getA5ServiceGuidanceScenario()) throw new Error("A5 service guidance blocks Agent runs until the service is available."); return startAgentRun(event.sender, request); });
  ipcMain.handle("desktop:abort-agent-run", (_event, requestId) => abortAgentRun(requestId));
  ipcMain.handle("desktop:recover-agent-run", (event, threadId) => recoverAgentRun(threadId, event.sender));
  ipcMain.handle("desktop:start-chat", (event, request) => { if (getA5ServiceGuidanceScenario()) throw new Error("A5 service guidance blocks chat until the service is available."); return startChat(event.sender, request); });
  ipcMain.handle("desktop:cancel-chat-turn", (_event, request) => cancelChatTurn(request));
  ipcMain.handle("desktop:recover-chat-run", (event, request) => recoverChatRun(request, event.sender));
  ipcMain.handle("desktop:respond-chat-input", (_event, requestId, response) => respondChatInput(requestId, response));
}
