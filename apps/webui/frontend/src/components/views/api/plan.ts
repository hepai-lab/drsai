import { getServerUrl } from "../../utils";

export class PlanAPI {
    private getBaseUrl(): string {
        return getServerUrl();
    }

    private getHeaders(): HeadersInit {
        return {
            "Content-Type": "application/json",
        };
    }

    async listPlans(userId: string): Promise<any[]> {
        const response = await fetch(
            `${this.getBaseUrl()}/plans/?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch plans");
        return data.data;
    }

    async getPlan(planId: number, userId: string): Promise<any> {
        const response = await fetch(
            `${this.getBaseUrl()}/plans/${planId}?user_id=${userId}`,
            {
                headers: this.getHeaders(),
            }
        );
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to fetch plan");
        return data.data;
    }

    async createPlan(planData: Partial<any>, userId: string): Promise<any> {
        const plan = {
            ...planData,
            user_id: userId,
        };

        const response = await fetch(`${this.getBaseUrl()}/plans/`, {
            method: "POST",
            headers: this.getHeaders(),
            body: JSON.stringify(plan),
        });
        const data = await response.json();
        if (!data.status)
            throw new Error(data.message || "Failed to create plan");
        return data.data;
    }

    async updatePlan(
        planId: number,
        planData: Partial<any>,
        userId: string
    ): Promise<any> {
        if (!planData.task) {
            console.error("Missing task in planData:", planData);
        }
        if (!planData.steps || !Array.isArray(planData.steps)) {
            console.error("Missing or invalid steps in planData:", planData);
        }

        const { created_at, ...dataWithoutCreatedAt } = planData;

        const plan = {
            ...dataWithoutCreatedAt,
            id: planId,
            user_id: userId,
            updated_at: null, // This will be replaced by the server with current time
        };

        try {
            const response = await fetch(
                `${this.getBaseUrl()}/plans/${planId}?user_id=${userId}`,
                {
                    method: "PUT",
                    headers: this.getHeaders(),
                    body: JSON.stringify(plan),
                }
            );

            const data = await response.json();
            if (!data.status)
                throw new Error(data.message || "Failed to update plan");
            return data.data;
        } catch (error) {
            console.error("Error in updatePlan:", error);
            throw error;
        }
    }

    async deletePlan(planId: number, userId: string): Promise<void> {
        try {
            const response = await fetch(
                `${this.getBaseUrl()}/plans/${planId}?user_id=${userId}`,
                {
                    method: "DELETE",
                    headers: this.getHeaders(),
                }
            );

            if (!response.ok) {
                throw new Error(
                    `Failed to delete plan. Server responded with status: ${response.status}`
                );
            }

            const data = await response.json();

            if (!data.status) {
                throw new Error(data.message || "Failed to delete plan");
            }
        } catch (error) {
            throw error;
        }
    }

    async learnPlan(sessionId: number, userId: string): Promise<any> {
        try {
            const response = await fetch(
                `${this.getBaseUrl()}/plans/learn_plan`,
                {
                    method: "POST",
                    headers: this.getHeaders(),
                    body: JSON.stringify({
                        session_id: sessionId,
                        user_id: userId,
                    }),
                }
            );

            if (!response.ok) {
                // Log the complete error response
                const errorText = await response.text();
                console.error("Full error response:", errorText);
                try {
                    const errorData = JSON.parse(errorText);
                    throw new Error(errorData.detail || response.statusText);
                } catch (e) {
                    throw new Error(
                        `${response.status} ${response.statusText}: ${errorText}`
                    );
                }
            }

            return await response.json();
        } catch (error) {
            console.error("Error learning plan:", error);
            throw error;
        }
    }
}

export const planAPI = new PlanAPI();