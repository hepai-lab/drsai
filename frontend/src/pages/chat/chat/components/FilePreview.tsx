import * as React from "react";
import { Button } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import { XIcon } from "lucide-react";
import { getFileIcon, formatFileSize } from "../utils/fileHelpers";

interface FilePreviewProps {
    fileList: UploadFile[];
    darkMode: string;
    onRemove: (uid: string) => void;
}

const FilePreview: React.FC<FilePreviewProps> = ({
    fileList,
    darkMode,
    onRemove,
}) => {
    if (fileList.length === 0) return null;

    return (
        <>
            {fileList.map((file) => (
                <div
                    key={file.uid}
                    className={`flex items-center gap-2 ${darkMode === "dark"
                            ? "bg-[#444444] text-white border border-gray-600"
                            : "bg-white text-magenta-800 border border-magenta-200"
                        } rounded-lg px-3 py-2 text-xs shadow-sm hover:shadow-md transition-shadow ${file.status === "error" ? "border-red-500" : ""
                        }`}
                >
                    {getFileIcon(file, darkMode)}
                    <div className="flex flex-col min-w-0 flex-1">
                        <span
                            className={`truncate font-medium ${darkMode === "dark" ? "text-white" : "text-magenta-800"
                                }`}
                        >
                            {file.name}
                        </span>
                        <span
                            className={`text-xs ${darkMode === "dark" ? "text-gray-400" : "text-magenta-600"
                                }`}
                        >
                            {formatFileSize(file.size || 0)}
                            {file.status === "uploading" && " - Uploading..."}
                            {file.status === "error" && " - Upload failed"}
                        </span>
                    </div>
                    <Button
                        type="text"
                        size="small"
                        className={`p-0 ml-1 flex items-center justify-center rounded-full ${darkMode === "dark"
                                ? "hover:bg-red-500/20 hover:text-red-400"
                                : "hover:bg-red-100 hover:text-red-600"
                            }`}
                        onClick={() => onRemove(file.uid)}
                        icon={
                            <XIcon
                                className={`w-3 h-3 ${darkMode === "dark"
                                        ? "text-gray-400"
                                        : "text-magenta-600"
                                    }`}
                            />
                        }
                    />
                </div>
            ))}
        </>
    );
};

export default FilePreview;

