import { useEffect, useRef } from "react";
import {
  Copy,
  FileText,
  FolderOpen,
  ExternalLink,
} from "lucide-react";
import type { WorkspaceFileNode } from "@shared/desktopApi";

export interface ContextMenuState {
  node: WorkspaceFileNode;
  x: number;
  y: number;
}

export function FilesTreeContextMenu({
  state,
  zh,
  onClose,
  onAction,
}: {
  state: ContextMenuState;
  zh: boolean;
  onClose: () => void;
  onAction: (actionId: string, node: WorkspaceFileNode) => void;
}): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);
  const { node, x, y } = state;
  const isDir = node.type === "directory";

  // Close on click outside, Escape, or scroll.
  useEffect(() => {
    function handlePointerDown(e: PointerEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    function handleScroll(): void {
      onClose();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  // Adjust position so the menu stays within the viewport.
  const menuWidth = 200;
  const menuHeight = 220;
  const adjustedX = Math.min(x, window.innerWidth - menuWidth);
  const adjustedY = Math.min(y, window.innerHeight - menuHeight);

  type MenuItem = { id: string; label: string; icon: typeof Copy; disabled?: boolean };
  type MenuEntry = MenuItem | "separator";

  const items: MenuEntry[] = [
    { id: "copy-path", label: zh ? "复制路径" : "Copy Path", icon: Copy },
    { id: "copy-relative-path", label: zh ? "复制相对路径" : "Copy Relative Path", icon: Copy },
    { id: "copy-name", label: zh ? "复制文件名" : "Copy Name", icon: FileText },
    "separator",
    ...(isDir
      ? [{ id: "open-in-explorer", label: zh ? "在资源管理器中打开" : "Open in Explorer", icon: FolderOpen }] satisfies MenuItem[]
      : []),
    ...(node.type === "file" && !node.path.startsWith("artifact://")
      ? [{ id: "open-with-system", label: zh ? "用系统应用打开" : "Open with System App", icon: ExternalLink }] satisfies MenuItem[]
      : []),
  ];

  return (
    <div
      ref={menuRef}
      className="files-tree-context-menu"
      style={{ left: `${adjustedX}px`, top: `${adjustedY}px` }}
    >
      {items.map((item, index) =>
        item === "separator" ? (
          <div key={`sep-${index}`} className="files-tree-context-menu-separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            className={`files-tree-context-menu-item ${item.disabled ? "disabled" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onAction(item.id, node);
            }}
          >
            <item.icon size={14} />
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
