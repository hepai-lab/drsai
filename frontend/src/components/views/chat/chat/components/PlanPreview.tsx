import * as React from "react";
import { Button } from "antd";
import { XIcon } from "lucide-react";
import { IPlan } from "../../../../types/plan";

interface PlanPreviewProps {
    plan: IPlan;
    darkMode: string;
    onRemove: () => void;
    onClick: () => void;
}

const PlanPreview: React.FC<PlanPreviewProps> = ({
    plan,
    darkMode,
    onRemove,
    onClick,
}) => {
    return (
        <div
            className={`flex items-center gap-1 ${darkMode === "dark"
                    ? "bg-[#444444] text-white"
                    : "bg-white text-magenta-800 border border-magenta-200"
                } rounded px-2 py-1 text-xs cursor-pointer hover:opacity-80 transition-opacity shadow-sm`}
            onClick={onClick}
        >
            <span
                className={`truncate max-w-[150px] ${darkMode === "dark" ? "text-white" : "text-magenta-800"
                    }`}
            >
                📋 {plan.task}
            </span>
            <Button
                type="text"
                size="small"
                className="p-0 ml-1 flex items-center justify-center"
                onClick={(e: { stopPropagation: () => void }) => {
                    e.stopPropagation();
                    onRemove();
                }}
                icon={
                    <XIcon
                        className={`w-3 h-3 ${darkMode === "dark" ? "text-gray-400" : "text-magenta-600"
                            }`}
                    />
                }
            />
        </div>
    );
};

export default PlanPreview;

