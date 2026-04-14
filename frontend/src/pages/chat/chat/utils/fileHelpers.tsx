import * as React from "react";
import type { UploadFile } from "antd/es/upload/interface";
import {
  FileTextIcon,
  ImageIcon,
} from "lucide-react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Progress } from "antd";

/**
 * Format file size to human readable format
 */
export const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

/**
 * Get appropriate icon for file type
 */
export const getFileIcon = (file: UploadFile, darkMode: string) => {
  const fileType = file.type || "";
  const fileName = file.name || "";

  // Show upload status
  if (file.status === "uploading") {
    return (
      <Progress
        type="circle"
        size={16}
        percent={50}
        strokeColor={darkMode === "dark" ? "#a855f7" : "#7c3aed"}
      />
    );
  }

  if (file.status === "error") {
    return <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />;
  }

  if (fileType.startsWith("image/")) {
    return (
      <ImageIcon
        className={`w-4 h-4 ${darkMode === "dark" ? "text-magenta-400" : "text-magenta-600"
          }`}
      />
    );
  }

  if (fileType === "application/pdf") {
    return <FileTextIcon className="w-4 h-4 text-red-500" />;
  }

  if (
    fileType.includes("word") ||
    fileName.endsWith(".doc") ||
    fileName.endsWith(".docx")
  ) {
    return (
      <FileTextIcon
        className={`w-4 h-4 ${darkMode === "dark" ? "text-magenta-400" : "text-magenta-600"
          }`}
      />
    );
  }

  if (fileType === "text/plain" || fileName.endsWith(".txt")) {
    return <FileTextIcon className="w-4 h-4 text-green-500" />;
  }

  return (
    <FileTextIcon
      className={`w-4 h-4 ${darkMode === "dark" ? "text-gray-400" : "text-gray-500"
        }`}
    />
  );
};

