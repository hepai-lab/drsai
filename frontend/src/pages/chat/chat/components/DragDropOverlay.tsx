import * as React from "react";
import { UploadIcon } from "lucide-react";

interface DragDropOverlayProps {
    isDragActive: boolean;
    darkMode: string;
}

const DragDropOverlay: React.FC<DragDropOverlayProps> = ({
    isDragActive,
    darkMode,
}) => {
    if (!isDragActive) return null;

    return (
        <div
            className={`absolute inset-0 border-2 border-dashed rounded-lg flex items-center justify-center z-10 pointer-events-none ${darkMode === "dark"
                ? "bg-magenta-500 bg-opacity-10 border-magenta-500"
                : "bg-magenta-500 bg-opacity-5 border-magenta-500"
                }`}
        >
            <div className="text-center">
                <UploadIcon
                    className={`w-12 h-12 mx-auto mb-2 ${darkMode === "dark" ? "text-magenta-400" : "text-magenta-600"
                        }`}
                />
                <p
                    className={`font-medium ${darkMode === "dark" ? "text-magenta-300" : "text-magenta-700"
                        }`}
                >
                    Drop files here to upload
                </p>
                <p
                    className={`text-sm ${darkMode === "dark" ? "text-magenta-400" : "text-magenta-600"
                        }`}
                >
                    Supported: Images, PDF, Word, Text files
                </p>
            </div>
        </div>
    );
};

export default DragDropOverlay;

