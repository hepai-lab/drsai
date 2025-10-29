import * as React from "react";
import { debounce } from "lodash";
import { planAPI } from "../../../api";
import { IPlan } from "../../../../types/plan";

interface UsePlanSearchProps {
  userId: string;
  runStatus?: string;
  isPlanMessage?: boolean;
}

interface UsePlanSearchReturn {
  isSearching: boolean;
  relevantPlans: any[];
  allPlans: any[];
  attachedPlan: IPlan | null;
  isLoading: boolean;
  isRelevantPlansVisible: boolean;
  isPlanModalVisible: boolean;
  searchPlans: (query: string) => void;
  handleUsePlan: (plan: IPlan) => void;
  clearAttachedPlan: () => void;
  handlePlanClick: () => void;
  handlePlanModalClose: () => void;
  setRelevantPlans: React.Dispatch<React.SetStateAction<any[]>>;
  setIsRelevantPlansVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

export const usePlanSearch = ({
  userId,
  runStatus,
  isPlanMessage,
}: UsePlanSearchProps): UsePlanSearchReturn => {
  const [isSearching, setIsSearching] = React.useState(false);
  const [relevantPlans, setRelevantPlans] = React.useState<any[]>([]);
  const [allPlans, setAllPlans] = React.useState<any[]>([]);
  const [attachedPlan, setAttachedPlan] = React.useState<IPlan | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isRelevantPlansVisible, setIsRelevantPlansVisible] =
    React.useState(false);
  const [isPlanModalVisible, setIsPlanModalVisible] = React.useState(false);

  // Fetch all plans on mount
  React.useEffect(() => {
    const fetchAllPlans = async () => {
      try {
        setIsLoading(true);
        const response = await planAPI.listPlans(userId);

        if (response) {
          if (Array.isArray(response)) {
            setAllPlans(response);
          } else {
            console.warn("Unexpected response format:", response);
          }
        } else {
          console.warn("Empty response received");
        }
      } catch (error) {
        console.error("Error fetching plans:", error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchAllPlans();
  }, [userId]);

  // Create searchable data structure
  const searchableData = React.useMemo(() => {
    return allPlans.map((plan) => ({
      ...plan,
      taskLower: plan.task?.toLowerCase() || "",
      stepTexts:
        plan.steps?.map(
          (step: { title: string; details: string }) =>
            (step.title?.toLowerCase() || "") +
            " " +
            (step.details?.toLowerCase() || "")
        ) || [],
    }));
  }, [allPlans]);

  // Search plans with debounce
  const searchPlans = React.useCallback(
    debounce((query: string) => {
      console.log("Search request with query:", query);

      // Don't search if query is too short, no plans available, or plan is already attached
      if (
        query.length < 3 ||
        !searchableData ||
        searchableData.length === 0 ||
        attachedPlan
      ) {
        return;
      }

      setIsSearching(true);
      try {
        const searchTerms = query.toLowerCase().split(" ");
        const matchingPlans = searchableData.filter((plan) => {
          if (query.length <= 2) {
            if (plan.taskLower.startsWith(query.toLowerCase())) {
              return true;
            }
          }
          const taskMatches = searchTerms.every((term) =>
            plan.taskLower.includes(term)
          );
          if (taskMatches) {
            return true;
          }

          return plan.stepTexts.some((stepText: string | string[]) =>
            searchTerms.every((term) => stepText.includes(term))
          );
        });

        if (matchingPlans.length > 0) {
          setRelevantPlans(matchingPlans.slice(0, 5));
          setIsRelevantPlansVisible(true);
        } else {
          setRelevantPlans([]);
          setAttachedPlan(null);
          setIsRelevantPlansVisible(false);
        }
      } catch (error) {
        console.error("Error searching plans:", error);
      } finally {
        setIsSearching(false);
      }
    }, 1000),
    [searchableData, runStatus, isPlanMessage, attachedPlan]
  );

  const handleUsePlan = (plan: IPlan) => {
    setRelevantPlans([]);
    setAttachedPlan(plan);
    setIsRelevantPlansVisible(false);
  };

  const clearAttachedPlan = () => {
    setAttachedPlan(null);
  };

  const handlePlanClick = () => {
    setIsPlanModalVisible(true);
  };

  const handlePlanModalClose = () => {
    setIsPlanModalVisible(false);
  };

  return {
    isSearching,
    relevantPlans,
    allPlans,
    attachedPlan,
    isLoading,
    isRelevantPlansVisible,
    isPlanModalVisible,
    searchPlans,
    handleUsePlan,
    clearAttachedPlan,
    handlePlanClick,
    handlePlanModalClose,
    setRelevantPlans,
    setIsRelevantPlansVisible,
  };
};

