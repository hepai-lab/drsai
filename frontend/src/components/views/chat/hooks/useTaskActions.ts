import * as React from "react";
import { message as antdMessage } from "antd";
import { RcFile } from "antd/es/upload";
import {
  Run,
  TeamConfig,
  RunStatus as BaseRunStatus,
  Session,
} from "../../../types/datamodel";
import { IPlan, IPlanStep, convertPlanStepsToJsonString } from "../../../types/plan";
import { GeneralConfig, useSettingsStore } from "../../../store";
import { settingsAPI } from "../../api";
import { AgentModeConfig, DEFAULT_AGENT_MODE_CONFIG } from "@/utils/agent";
import { messageUtils } from "../rendermessage";
import { useAgentInfo } from "@/components/features/Agents/useAgentInfo";

type SelectedLlm = { label: string; value: string };

const buildLlmPayload = (
  llm?: SelectedLlm,
  agentInfo?: Record<string, any>
): {
  defult_config_name?: string;
} => {
  const resolvedDefaultConfigName = llm?.label || agentInfo?.defult_config_name;

  return {
    ...(resolvedDefaultConfigName && { defult_config_name: resolvedDefaultConfigName }),
  };
};

interface UseTaskActionsProps {
  currentRun: Run | null;
  session: Session | null;
  teamConfig: TeamConfig | null;
  settingsConfig: GeneralConfig;
  updatedPlan: IPlanStep[];
  userEmail?: string;
  activeSocketRef: React.MutableRefObject<WebSocket | null>;
  inputTimeoutRef: React.MutableRefObject<NodeJS.Timeout | null>;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  setNoMessagesYet: (value: boolean) => void;
  setError: (error: any) => void;
  setupWebSocket: (
    runId: string,
    fresh_socket: boolean,
    only_retrieve_existing_socket: boolean
  ) => WebSocket | null;
  ensureWebSocketConnection: (runId: string) => Promise<WebSocket>;
  onSessionNameChange: (sessionData: Partial<Session>) => void;
}

export const useTaskActions = ({
  currentRun,
  session,
  teamConfig,
  settingsConfig,
  updatedPlan,
  userEmail,
  activeSocketRef,
  inputTimeoutRef,
  setCurrentRun,
  setNoMessagesYet,
  setError,
  setupWebSocket,
  ensureWebSocketConnection,
  onSessionNameChange,
}: UseTaskActionsProps) => {

   const { agentInfo } = useAgentInfo(userEmail);
  const handleError = React.useCallback(
    (error: any) => {
      console.error("Error:", error);
      antdMessage.error("Error during request processing");

      setError({
        status: false,
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    },
    [setError]
  );

  const handleInputResponse = React.useCallback(
    async (
      response: string,
      accepted = false,
      plan?: IPlan,
      files: RcFile[] | Array<{
        name: string;
        type: string;
        path: string;
        suffix: string;
        size: number;
        uuid: string;
        url?: string;
      }> = [],
      llm?: SelectedLlm
    ) => {
      if (!currentRun) {
        handleError(new Error("No active run"));
        return;
      }

      try {
        const needsReconnect =
          !activeSocketRef.current ||
          activeSocketRef.current.readyState !== WebSocket.OPEN;

        const socket = await ensureWebSocketConnection(currentRun.id);

        const lastMessage = currentRun.messages.slice(-1)[0];
        let planString = "";
        if (plan) {
          planString = convertPlanStepsToJsonString(plan.steps);
        } else if (
          lastMessage &&
          // lastMessage.config.metadata?.type === "plan"
          messageUtils.isPlanMessage(lastMessage.config.metadata)

        ) {
          planString = convertPlanStepsToJsonString(updatedPlan);
        }

        // Use files directly (already in the correct format from upload)
        const processedFiles = files && files.length > 0 ? files : [];

        // responseJson only contains accepted, content, and plan (no files)
        const responseJson = {
          accepted: accepted,
          content: response,
          ...(planString !== "" && { plan: planString }),
          ...buildLlmPayload(llm, agentInfo as Record<string, any>),
        };
        const responseString = JSON.stringify(responseJson);

        if (needsReconnect) {
          let currentSettings = settingsConfig;
          if (userEmail) {
            try {
              currentSettings = (await settingsAPI.getSettings(
                userEmail
              )) as GeneralConfig;
              useSettingsStore.getState().updateConfig(currentSettings);
            } catch (error) {
              console.error("Failed to load settings:", error);
            }
          }

          if (currentRun) {
            const continueMessage = {
              type: "continue",
              task: responseString,
              team_config: teamConfig,
              settings_config: {
                ...currentSettings,
                agent_mode_config: agentInfo,
                ...buildLlmPayload(llm, agentInfo as Record<string, any>),
              },
              ...(processedFiles.length > 0 && { files: processedFiles }),
            };

            socket.send(JSON.stringify(continueMessage));
          }
        } else {
          const inputResponseMessage = {
            type: "input_response",
            response: responseString,
            settings_config: {
              ...(agentInfo?.id && { agent_id: agentInfo.id }),
              ...buildLlmPayload(llm, agentInfo as Record<string, any>),
            },
            ...(processedFiles.length > 0 && { files: processedFiles }),
          };
          socket.send(JSON.stringify(inputResponseMessage));

          setCurrentRun((current: Run | null) => {
            if (!current) return null;
            return {
              ...current,
              status: "active" as BaseRunStatus,
              input_request: undefined,
            };
          });
        }
      } catch (error) {
        handleError(error);
      }
    },
    [
      currentRun,
      activeSocketRef,
      ensureWebSocketConnection,
      updatedPlan,
      settingsConfig,
      userEmail,
      teamConfig,
      setCurrentRun,
      handleError,
      agentInfo,
    ]
  );

  const handleRegeneratePlan = React.useCallback(async () => {
    if (!currentRun) {
      handleError(new Error("No active run"));
      return;
    }

    try {
      const needsReconnect =
        !activeSocketRef.current ||
        activeSocketRef.current.readyState !== WebSocket.OPEN;

      const socket = await ensureWebSocketConnection(currentRun.id);

      const lastMessage = currentRun.messages.slice(-1)[0];
      let planString = "";
      if (
        lastMessage &&
        lastMessage.config.metadata?.type === "plan"
      ) {
        planString = convertPlanStepsToJsonString(updatedPlan);
      }

      const responseJson = {
        content: "Regenerate a plan that improves on the current plan",
        ...(planString !== "" && { plan: planString }),
      };
      const responseString = JSON.stringify(responseJson);

      socket.send(
        JSON.stringify({
          type: "input_response",
          response: responseString,
        })
      );
    } catch (error) {
      handleError(error);
    }
  }, [currentRun, activeSocketRef, ensureWebSocketConnection, updatedPlan, handleError]);

  const handleCancel = React.useCallback(async () => {
    if (!currentRun) return;

    if (inputTimeoutRef.current) {
      clearTimeout(inputTimeoutRef.current);
      inputTimeoutRef.current = null;
    }

    try {

      const socket = await ensureWebSocketConnection(currentRun.id);

      socket.send(
        JSON.stringify({
          type: "stop",
          reason: "Cancelled by user",
        })
      );

      setCurrentRun((current: Run | null) => {
        if (!current) return null;
        return {
          ...current,
          status: "stopped" as BaseRunStatus,
          input_request: undefined,
        };
      });
    } catch (error) {
      handleError(error);
    }
  }, [
    currentRun,
    inputTimeoutRef,
    activeSocketRef,
    ensureWebSocketConnection,
    setCurrentRun,
    handleError,
  ]);

  const handlePause = React.useCallback(async () => {
    if (!currentRun) return;

    try {
      if (
        currentRun.status === "awaiting_input" ||
        currentRun.status === "connected"
      ) {
        return;
      }

      const needsReconnect =
        !activeSocketRef.current ||
        activeSocketRef.current.readyState !== WebSocket.OPEN;

      const socket = await ensureWebSocketConnection(currentRun.id);

      socket.send(
        JSON.stringify({
          type: "pause",
        })
      );

      setCurrentRun((current: Run | null) => {
        if (!current) return null;
        return {
          ...current,
          status: "pausing",
        };
      });
    } catch (error) {
      handleError(error);
    }
  }, [
    currentRun,
    activeSocketRef,
    ensureWebSocketConnection,
    setCurrentRun,
    handleError,
  ]);

  const runTask = React.useCallback(
    async (
      query: string,
      files: RcFile[] | Array<{
        name: string;
        type: string;
        path: string;
        suffix: string;
        size: number;
        uuid: string;
        url?: string;
      }> = [],
      plan?: IPlan,
      fresh_socket: boolean = false,
      llm?: SelectedLlm
    ) => {
      setError(null);
      setNoMessagesYet(false);

      try {
        if (!currentRun) {
          throw new Error("Could not setup run");
        }

        // 点击发送时：再请求全局setting配置 (API) - 确保获取最新配置
        let currentSettings = settingsConfig;
        if (userEmail) {
          try {
            // 请求最新的全局settings配置
            currentSettings = (await settingsAPI.getSettings(
              userEmail
            )) as GeneralConfig;
            // 更新store中的配置
            useSettingsStore.getState().updateConfig(currentSettings);
          } catch (error) {
            console.error("Failed to load settings:", error);
            // 如果请求失败，使用当前的settingsConfig作为后备
          }
        }

        // Setup websocket connection
        const socket = setupWebSocket(currentRun.id, fresh_socket, false);
        if (!socket) {
          throw new Error("WebSocket connection not available");
        }

        // Wait for socket to be ready
        await new Promise<void>((resolve, reject) => {
          const checkState = () => {
            if (socket.readyState === WebSocket.OPEN) {
              resolve();
            } else if (
              socket.readyState === WebSocket.CLOSED ||
              socket.readyState === WebSocket.CLOSING
            ) {
              reject(new Error("Socket failed to connect"));
            } else {
              setTimeout(checkState, 100);
            }
          };
          checkState();
        });

        // Use files directly (already in the correct format from upload)
        const processedFiles = files && files.length > 0 ? files : [];

        const planString = plan
          ? convertPlanStepsToJsonString(plan.steps)
          : "";

        const taskJson = {
          content: query,
          ...(planString !== "" && { plan: planString }),
        };

        // 发送给后端：使用最新的settings配置
        const messageToSend = {
          type: "start",
          task: JSON.stringify(taskJson),
          files: processedFiles,
          team_config: teamConfig,
          settings_config: {
            ...currentSettings,
            // agent_mode_config: agentInfo,
            agent_id: agentInfo?.id || "",
            ...buildLlmPayload(llm, agentInfo as Record<string, any>),
          },
        };

        socket.send(JSON.stringify(messageToSend));

        const sessionData = {
          id: session?.id,
          name: query.slice(0, 50),
        };
        onSessionNameChange(sessionData);
      } catch (error) {
        setError({
          status: false,
          message:
            error instanceof Error ? error.message : "Failed to start task",
        });
      }
    },
    [
      currentRun,
      settingsConfig,
      userEmail,
      setupWebSocket,
      teamConfig,
      session?.id,
      setError,
      setNoMessagesYet,
      onSessionNameChange,
      agentInfo?.id,
    ]
  );

  const handleApprove = React.useCallback(() => {
    if (currentRun?.status === "awaiting_input") {
      handleInputResponse("approve", true);
    }
  }, [currentRun?.status, handleInputResponse]);

  const handleDeny = React.useCallback(() => {
    if (currentRun?.status === "awaiting_input") {
      handleInputResponse("deny", false);
    }
  }, [currentRun?.status, handleInputResponse]);

  const handleAcceptPlan = React.useCallback(
    (text: string) => {
      if (currentRun?.status === "awaiting_input") {
        const query = text || "Plan Accepted";
        handleInputResponse(query, true).catch((error) => {
          console.error("handleAcceptPlan error:", error);
          handleError(error);
        });
      }
    },
    [currentRun?.status, handleInputResponse, handleError]
  );

  return {
    handleInputResponse,
    handleRegeneratePlan,
    handleCancel,
    handlePause,
    runTask,
    handleApprove,
    handleDeny,
    handleAcceptPlan,
  };
};

