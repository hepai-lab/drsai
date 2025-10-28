import React from "react";
import DetailViewer from "../detail_viewer";
import { IPlan } from "../../../types/plan";

/**
 * VNCPanel - VNC 浏览器预览面板
 * 
 * 这是 DetailViewer 的包装组件，用于 magentic-one agent 的浏览器预览功能
 * 包含两个标签页：
 * 1. Screenshots - 浏览器截图历史
 * 2. Live View - VNC 实时浏览器预览
 */

interface VNCPanelProps {
    images: string[];
    imageTitles: string[];
    onMinimize: () => void;
    onToggleExpand: () => void;  // 改为必需
    isExpanded: boolean;          // 改为必需
    currentIndex: number;
    onIndexChange: (index: number) => void;
    novncPort?: string;
    onPause?: () => void;
    runStatus?: string;
    activeTab?: "screenshots" | "live";
    onTabChange?: (tab: "screenshots" | "live") => void;
    detailViewerContainerId?: string;
    onInputResponse?: (
        response: string,
        accepted?: boolean,
        plan?: IPlan
    ) => void;
}

/**
 * VNCPanel 组件
 * 
 * 目前直接使用 DetailViewer 实现
 * 未来可以根据需要进行定制化修改
 */
const VNCPanel: React.FC<VNCPanelProps> = (props) => {
    return <DetailViewer {...props} />;
};

export default VNCPanel;

