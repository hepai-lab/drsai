import * as React from "react";
import { Run, Message } from "../../../types/datamodel";
import { messageUtils } from "../rendermessage";

interface StepProgress {
  currentStep: number;
  totalSteps: number;
  plan?: {
    task: string;
    steps: Array<{
      title: string;
      details: string;
      agent_name?: string;
    }>;
    response?: string;
    plan_summary?: string;
  };
}

export const useProgressTracking = (currentRun: Run | null) => {
  const [progress, setProgress] = React.useState<StepProgress>({
    currentStep: -1,
    totalSteps: -1,
  });
  const [isPlanning, setIsPlanning] = React.useState(false);
  const [hasFinalAnswer, setHasFinalAnswer] = React.useState(false);
  const [currentPlan, setCurrentPlan] = React.useState<StepProgress["plan"]>();

  // Extract current plan from messages
  React.useEffect(() => {
    if (!currentRun?.messages) return;

    const lastPlanMessage = [...currentRun.messages]
      .reverse()
      .find((msg) => {
        if (typeof msg.config.content !== "string") return false;
        return messageUtils.isPlanMessage(msg.config.metadata);
      });

    if (lastPlanMessage && typeof lastPlanMessage.config.content === "string") {
      try {
        const content = JSON.parse(lastPlanMessage.config.content);
        console.log("content 2026-01-26", content);
        if (messageUtils.isPlanMessage(lastPlanMessage.config.metadata)) {
          setCurrentPlan({
            task: content.task,
            steps: content.steps,
            response: content.response,
            plan_summary: content.plan_summary,
          });
        }
      } catch {
        setCurrentPlan(undefined);
      }
    }
  }, [currentRun?.messages]);

  // Track progress and detect plan/final answer messages
  React.useEffect(() => {
    if (!currentRun?.messages.length) return;

    let currentStepIndex = -1;
    let planLength = 0;

    // Find the last final answer index
    const lastFinalAnswerIndex = currentRun.messages.findLastIndex(
      (msg: Message) =>
        typeof msg.config.content === "string" &&
        messageUtils.isFinalAnswer(msg.config.metadata)
    );

    // Calculate step progress only for messages after the last final answer
    const relevantMessages =
      lastFinalAnswerIndex === -1
        ? currentRun.messages
        : currentRun.messages.slice(lastFinalAnswerIndex + 1);

    relevantMessages.forEach((msg: Message) => {
      if (typeof msg.config.content === "string") {
        try {
          const content = JSON.parse(msg.config.content);
          if (content.index !== undefined) {
            currentStepIndex = content.index;
            if (content.plan_length) {
              planLength = content.plan_length;
            }
          }
        } catch {
          // Skip if we can't parse the message
        }
      }
    });

    setProgress({
      currentStep: currentStepIndex,
      totalSteps: planLength,
      plan: currentPlan,
    });

    // Check if we have a final answer
    const hasFinalAnswerExists = lastFinalAnswerIndex !== -1;

    // If we have a final answer, check for plans after it
    if (hasFinalAnswerExists) {
      const messagesAfterFinalAnswer = currentRun.messages.slice(
        lastFinalAnswerIndex + 1
      );
      const hasPlanAfterFinalAnswer = messagesAfterFinalAnswer.some(
        (msg) =>
          typeof msg.config.content === "string" &&
          messageUtils.isPlanMessage(msg.config.metadata)
      );

      if (hasPlanAfterFinalAnswer) {
        setIsPlanning(currentStepIndex === -1);
        setHasFinalAnswer(false);
      } else {
        setIsPlanning(false);
        setHasFinalAnswer(true);
      }
    } else {
      // No final answer - check for recent plans
      const recentMessages = currentRun.messages.slice(-3);
      const hasPlan = recentMessages.some(
        (msg: Message) =>
          typeof msg.config.content === "string" &&
          messageUtils.isPlanMessage(msg.config.metadata)
      );

      setHasFinalAnswer(false);
      setIsPlanning(hasPlan && currentStepIndex === -1);
    }

    // Hide progress if run is not in an active state
    if (
      currentRun.status !== "active" &&
      currentRun.status !== "awaiting_input" &&
      currentRun.status !== "paused" &&
      currentRun.status !== "pausing"
    ) {
      setIsPlanning(false);
      setProgress({ currentStep: -1, totalSteps: -1 });
    }
  }, [currentRun?.messages, currentRun?.status, currentPlan]);

  return {
    progress,
    isPlanning,
    hasFinalAnswer,
    currentPlan,
  };
};

