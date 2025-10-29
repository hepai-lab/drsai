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
import { convertFilesToBase64 } from "../../../utils";
import { GeneralConfig, useSettingsStore } from "../../../store";
import { settingsAPI } from "../../api";

interface UseTaskActionsProps {
  currentRun: Run | null;
  session: Session | null;
  teamConfig: TeamConfig | null;
  settingsConfig: GeneralConfig;
  currentSessionConfig: { mode: string; config: {} };
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
  currentSessionConfig,
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
      files: RcFile[] = []
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
          lastMessage.config.metadata?.type === "plan"
        ) {
          planString = convertPlanStepsToJsonString(updatedPlan);
        }

        const processedFiles = await convertFilesToBase64(files);

        const responseJson = {
          accepted: accepted,
          content: response,
          ...(planString !== "" && { plan: planString }),
          ...(processedFiles.length > 0 && { files: processedFiles }),
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
                agent_mode_config: {
                  config: currentSessionConfig,
                  mode: currentSessionConfig.mode,
                },
              },
            };

            socket.send(JSON.stringify(continueMessage));
          }
        } else {
          socket.send(
            JSON.stringify({
              type: "input_response",
              response: responseString,
            })
          );

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
      currentSessionConfig,
      setCurrentRun,
      handleError,
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
      const needsReconnect =
        !activeSocketRef.current ||
        activeSocketRef.current.readyState !== WebSocket.OPEN;

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
      files: RcFile[] = [],
      plan?: IPlan,
      fresh_socket: boolean = false
    ) => {
      setError(null);
      setNoMessagesYet(false);

      try {
        if (!currentRun) {
          throw new Error("Could not setup run");
        }

        // Load latest settings from database
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

        const processedFiles = await convertFilesToBase64(files);

        const planString = plan
          ? convertPlanStepsToJsonString(plan.steps)
          : "";

        const taskJson = {
          content: query,
          ...(planString !== "" && { plan: planString }),
        };

        const messageToSend = {
          type: "start",
          task: JSON.stringify(taskJson),
          files: processedFiles,
          team_config: teamConfig,
          settings_config: {
            ...currentSettings,
            agent_mode_config: {
              config: currentSessionConfig,
              mode: currentSessionConfig.mode,
            },
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
      currentSessionConfig,
      session?.id,
      setError,
      setNoMessagesYet,
      onSessionNameChange,
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

