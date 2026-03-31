import React from "react";
import { FileText } from "lucide-react";

const FilePreviewPage: React.FC = () => {
  return (
    <div className="flex items-center justify-center h-full text-secondary">
      <div className="text-center">
        <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
        <h2 className="text-base font-medium text-primary">文件预览</h2>
        <p className="mt-2 text-sm opacity-60">请选择右侧文件进行预览</p>
      </div>
    </div>
  );
};

export default FilePreviewPage;
