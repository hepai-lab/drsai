import * as React from "react";
import { IPlan, IPlanStep, convertPlanStepsToJsonString } from "../../../types/plan";
import { Run, TeamConfig } from "../../../types/datamodel";
import { GeneralConfig } from "../../../store";

const defaultTeamConfig: TeamConfig = {
  name: "Default Team",
  participants: [],
  team_type: "RoundRobinGroupChat",
  component_type: "team",
};

interface UsePlanManagementProps {
  session: { id?: number } | null;
  currentRun: Run | null;
  settingsConfig: GeneralConfig;
  teamConfig: TeamConfig | null;
  setupWebSocket: (
    runId: string,
    fresh_socket: boolean,
    only_retrieve_existing_socket: boolean
  ) => WebSocket | null;
  activeSocketRef: React.MutableRefObject<WebSocket | null>;
  setNoMessagesYet: (value: boolean) => void;
}

export const usePlanManagement = ({
  session,
  currentRun,
  settingsConfig,
  teamConfig,
  setupWebSocket,
  activeSocketRef,
  setNoMessagesYet,
}: UsePlanManagementProps) => {
  const [localPlan, setLocalPlan] = React.useState<IPlan | null>(null);
  const [planProcessed, setPlanProcessed] = React.useState(false);
  const [updatedPlan, setUpdatedPlan] = React.useState<IPlanStep[]>([]);
  const processedPlanIds = React.useRef(new Set<string>()).current;

  // Listen for plan events
  React.useEffect(() => {
    if (session?.id) {
      const handlePlanReady = (event: CustomEvent) => {
        if (event.detail.sessionId !== session.id) {
          return;
        }

        const planId = event.detail.messageId || `plan_${Date.now()}`;

        if (!processedPlanIds.has(planId)) {
          const planData = {
            ...event.detail.planData,
            sessionId: session.id,
            messageId: planId,
          };

          setLocalPlan(planData);
          setPlanProcessed(false);
        }
      };

      window.addEventListener("planReady", handlePlanReady as EventListener);

      return () => {
        window.removeEventListener("planReady", handlePlanReady as EventListener);
      };
    }
  }, [session?.id, processedPlanIds]);

  const processPlan = React.useCallback(
    async (newPlan: IPlan) => {
      if (!currentRun || !session?.id) return;

      if (newPlan.sessionId !== session.id) {
        return;
      }

      try {
        const socket =
          activeSocketRef.current?.readyState === WebSocket.OPEN
            ? activeSocketRef.current
            : setupWebSocket(currentRun.id, true, false);

        if (!socket || socket.readyState !== WebSocket.OPEN) {
          console.error("WebSocket not available or not open");
          return;
        }

        const sessionSettingsConfig = {
          ...settingsConfig,
          plan: {
            task: newPlan.task,
            steps: newPlan.steps,
            plan_summary: "Saved plan for task: " + newPlan.task,
          },
        };

        const currentTeamConfig = teamConfig || defaultTeamConfig;

        const message = {
          type: "start",
          id: `plan_${Date.now()}`,
          task: newPlan.task,
          team_config: currentTeamConfig,
          settings_config: sessionSettingsConfig,
          sessionId: session.id,
        };

        socket.send(JSON.stringify(message));

        setNoMessagesYet(false);
        setPlanProcessed(true);
        if (newPlan.messageId) {
          processedPlanIds.add(newPlan.messageId);
        }
      } catch (err) {
        console.error("Error processing plan for session:", session.id, err);
      }
    },
    [
      currentRun,
      session?.id,
      settingsConfig,
      teamConfig,
      setupWebSocket,
      activeSocketRef,
      setNoMessagesYet,
      processedPlanIds,
    ]
  );

  const handleExecutePlan = React.useCallback(
    (plan: IPlan) => {
      plan.sessionId = session?.id || undefined;
      processPlan(plan);
    },
    [processPlan, session?.id]
  );

  const handlePlanUpdate = React.useCallback((plan: IPlanStep[]) => {
    setUpdatedPlan(plan);
  }, []);

  // Reset plan state when session changes
  React.useEffect(() => {
    setLocalPlan(null);
    setPlanProcessed(false);
    processedPlanIds.clear();
    setUpdatedPlan([]);
  }, [session?.id, processedPlanIds]);

  return {
    localPlan,
    planProcessed,
    updatedPlan,
    setLocalPlan,
    setPlanProcessed,
    processPlan,
    handleExecutePlan,
    handlePlanUpdate,
  };
};

