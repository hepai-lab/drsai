import React, { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  FileText, Folder, FolderOpen, Image, Code, File,
  Download, Send, Upload, Trash2, RotateCw, FolderPlus,
  Check, X, ChevronRight as ChevronRightIcon, ChevronDown as ChevronDownIcon, Home,
} from 'lucide-react';
import { DndProvider, useDrag, useDrop } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useCloudFilesStore, type CloudFile } from '../../../store/cloudFiles';
import { cloudAPI } from '../../views/api';
import { useLang } from '../../../i18n/useLang';
import { appContext } from '../../../hooks/provider';
import { useNavigate, useLocation } from '../../../hooks/useRouter';
import { createSearchWithView } from '../../views/menuRoutes';
import { useRightPanelStore } from '../../../store/rightPanel';

// ── 文件类型图标映射 ──
const FILE_ICONS: Record<string, React.ReactNode> = {
  pdf: <FileText className="w-3.5 h-3.5 text-red-400" />,
  docx: <FileText className="w-3.5 h-3.5 text-blue-400" />,
  doc: <FileText className="w-3.5 h-3.5 text-blue-400" />,
  html: <FileText className="w-3.5 h-3.5 text-blue-400" />,
  csv: <FileText className="w-3.5 h-3.5 text-emerald-400" />,
  txt: <FileText className="w-3.5 h-3.5 text-gray-400" />,
  json: <Code className="w-3.5 h-3.5 text-amber-400" />,
  py: <Code className="w-3.5 h-3.5 text-blue-400" />,
  js: <Code className="w-3.5 h-3.5 text-yellow-400" />,
  ts: <Code className="w-3.5 h-3.5 text-blue-400" />,
  md: <FileText className="w-3.5 h-3.5 text-gray-400" />,
  png: <Image className="w-3.5 h-3.5 text-purple-400" />,
  jpg: <Image className="w-3.5 h-3.5 text-purple-400" />,
  jpeg: <Image className="w-3.5 h-3.5 text-purple-400" />,
  gif: <Image className="w-3.5 h-3.5 text-purple-400" />,
  svg: <Image className="w-3.5 h-3.5 text-purple-400" />,
};

// ── 工具 ──
const formatSize = (bytes: number): string => {
  if (!bytes || bytes === 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

/** CloudFile extended with id + children for the tree */
interface TreeFile extends CloudFile {
  id: string;
  children?: TreeFile[];
  _userId?: string;
  isBucket?: boolean;
}

// ── DnD 常量 ──
const DRAG_TYPE = 'TREE_NODE';

interface DragItem {
  id: string;
  path: string;
}

// ── TreeNode 组件 ──

const TreeNode: React.FC<{
  node: TreeFile;
  depth: number;
  expanded: Set<string>;
  loadingPaths: Set<string>;
  onToggleExpand: (id: string) => void;
  onNavigateIntoFolder: (path: string) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string, isDir: boolean) => void;
  onPreview: (path: string, name: string, size: number, suffix: string | undefined) => void;
  onDownload: (path: string) => void;
  selectedPaths: Set<string>;
  onToggleSelect: (path: string) => void;
  treeData: TreeFile[];
  moveNode: (dragId: string, targetDirId: string) => void;
  /** Recursively check if targetId is a descendant of ancestorId */
  isDescendant: (ancestorId: string, targetId: string) => boolean;
}> = ({
  node, depth, expanded, loadingPaths, onToggleExpand, onNavigateIntoFolder, onRename, onDelete, onPreview, onDownload,
  selectedPaths, onToggleSelect, treeData, moveNode, isDescendant,
}) => {
    const isDir = node.type === 'directory';
    const ext = node.suffix?.toLowerCase() ?? '';
    const isOpen = expanded.has(node.id);
    const isSelected = selectedPaths.has(node.path);
    const editInputRef = useRef<HTMLInputElement | null>(null);
    const [editing, setEditing] = useState(false);
    const [editValue, setEditValue] = useState(node.name);

    // ── Drag ──
    const [{ isDragging }, drag] = useDrag<DragItem, void, { isDragging: boolean }>(() => ({
      type: DRAG_TYPE,
      item: { id: node.id, path: node.path },
      collect: (monitor) => ({ isDragging: monitor.isDragging() }),
    }), [node.id, node.path]);

    // ── Drop (folders only) ──
    const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
      accept: DRAG_TYPE,
      canDrop: (item) => {
        // Can't drop on itself or its descendants
        return isDir && item.id !== node.id && !isDescendant(item.id, node.id);
      },
      drop: (item) => {
        moveNode(item.id, node.id);
      },
      collect: (monitor) => ({
        isOver: monitor.isOver(),
        canDrop: monitor.canDrop(),
      }),
    }), [isDir, node.id, moveNode, isDescendant]);

    // Attach drag/drop refs
    const attachRef = useCallback(
      (el: HTMLDivElement | null) => {
        if (!node.isBucket) drag(el);
        if (isDir) drop(el);
      },
      [drag, drop, isDir, node.isBucket],
    );

    // Auto-focus edit input
    useEffect(() => {
      if (editing && editInputRef.current) {
        editInputRef.current.focus();
        editInputRef.current.select();
      }
    }, [editing]);

    // ── Handlers ──
    const handleDoubleClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.isBucket) return;
      if (!editing) {
        setEditValue(node.name);
        setEditing(true);
      }
    }, [editing, node.name, node.isBucket]);

    const handleEditKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const trimmed = editValue.trim();
        if (trimmed && trimmed !== node.name) {
          onRename(node.id, trimmed);
        }
        setEditing(false);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditValue(node.name);
        setEditing(false);
      }
    }, [editValue, node.name, node.id, onRename]);

    const handleClick = useCallback((e: React.MouseEvent) => {
      if (editing) return;
      if (isDir) {
        onToggleExpand(node.id);
        return;
      }
      onPreview(node.path, node.name, node.size, node.suffix);
    }, [editing, isDir, node, onPreview, onToggleExpand]);

    const handleChevronClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleExpand(node.id);
    }, [node.id, onToggleExpand]);

    const handleDownloadClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      onDownload(node.path);
    }, [node.path, onDownload]);

    const handleDeleteClick = useCallback((e: React.MouseEvent) => {
      e.stopPropagation();
      onDelete(node.path, isDir);
    }, [node.path, isDir, onDelete]);

    // ── 图标 ──
    const icon = isDir
      ? (isOpen
        ? <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
        : <Folder className="w-3.5 h-3.5 text-amber-400" />)
      : (FILE_ICONS[ext] ?? <File className="w-3.5 h-3.5 text-gray-400" />);

    return (
      <>
        <div
          ref={attachRef}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
          className={`flex items-center gap-1.5 pr-1 rounded group cursor-pointer transition-colors ${isOver && canDrop
            ? 'bg-accent/20 ring-1 ring-accent'
            : isDragging
              ? 'opacity-30'
              : 'hover:bg-tertiary/10'
            }`}
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
        >
          {/* Folder tree-expand toggle — always visible for bucket */}
          {isDir ? (
            <button
              type="button"
              onClick={handleChevronClick}
              title={isOpen ? "折叠" : "展开"}
              className={node.isBucket
                ? "flex-shrink-0 w-3.5 flex items-center justify-center rounded text-secondary hover:text-primary hover:bg-tertiary/20 transition-all"
                : "opacity-0 group-hover:opacity-100 flex-shrink-0 w-3.5 flex items-center justify-center rounded text-secondary hover:text-primary hover:bg-tertiary/20 transition-all"
              }
            >
              {isOpen
                ? <ChevronDownIcon className="w-3 h-3" />
                : <ChevronRightIcon className="w-3 h-3" />}
            </button>
          ) : (
            <span className="flex-shrink-0 w-3.5 inline-block" />
          )}

          {/* Checkbox (hover) */}
          <label
            className="opacity-0 group-hover:opacity-100 flex items-center cursor-pointer flex-shrink-0 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(node.path)}
              className="w-3.5 h-3.5 rounded border-border-primary/50 accent-accent cursor-pointer"
            />
          </label>

          {/* Icon */}
          <span className="flex-shrink-0">{icon}</span>

          {/* Name */}
          {editing ? (
            <>
              <input
                ref={editInputRef}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleEditKeyDown}
                onBlur={() => { setEditValue(node.name); setEditing(false); }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="flex-1 min-w-0 text-xs px-1 py-0 bg-tertiary/20 border border-accent rounded outline-none text-primary"
              />
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const trimmed = editValue.trim();
                  if (trimmed && trimmed !== node.name) {
                    onRename(node.id, trimmed);
                  }
                  setEditing(false);
                }}
                title="保存"
                className="flex-shrink-0 p-0.5 rounded text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditValue(node.name);
                  setEditing(false);
                }}
                title="取消"
                className="flex-shrink-0 p-0.5 rounded text-secondary hover:text-primary hover:bg-tertiary/20 transition-colors"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          ) : (
            <span className="flex-1 min-w-0 text-xs text-primary truncate" title={node.name}>
              {node.name}
            </span>
          )}

          {/* Size */}
          {!isDir && (
            <span className="text-[10px] text-primary tabular-nums flex-shrink-0">
              {formatSize(node.size)}
            </span>
          )}

          {/* Download (hover, files only) */}
          {!isDir && (
            <button
              type="button"
              onClick={handleDownloadClick}
              title="下载"
              className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded text-accent hover:text-accent/80 hover:bg-accent/10 transition-all"
            >
              <Download className="w-3 h-3" />
            </button>
          )}

          {/* Delete (hover) */}
          {!node.isBucket && (
            <button
              type="button"
              onClick={handleDeleteClick}
              title="删除"
              className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded text-red-400 hover:text-red-500 hover:bg-red-500/10 transition-all"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Children */}
        {isDir && isOpen && node.children && node.children.length > 0 && (
          node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              loadingPaths={loadingPaths}
              onToggleExpand={onToggleExpand}
              onNavigateIntoFolder={onNavigateIntoFolder}
              onRename={onRename}
              onDelete={onDelete}
              onPreview={onPreview}
              onDownload={onDownload}
              selectedPaths={selectedPaths}
              onToggleSelect={onToggleSelect}
              treeData={treeData}
              moveNode={moveNode}
              isDescendant={isDescendant}
            />
          ))
        )}
        {isDir && isOpen && (!node.children || node.children.length === 0) && (
          loadingPaths.has(node.id) ? (
            <div style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }} className="flex items-center gap-1 text-[10px] text-secondary py-0.5">
              <RotateCw className="w-2.5 h-2.5 animate-spin" />
            </div>
          ) : (
            <div style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }} className="text-[10px] text-primary py-0.5">
              空文件夹
            </div>
          )
        )}
      </>
    );
  };

// ── Root-level drop zone ──

const TreeRoot: React.FC<{
  children: React.ReactNode;
  onDropToRoot: (dragId: string) => void;
}> = ({ children, onDropToRoot }) => {
  const [{ isOver, canDrop }, drop] = useDrop<DragItem, void, { isOver: boolean; canDrop: boolean }>(() => ({
    accept: DRAG_TYPE,
    drop: (item) => {
      onDropToRoot(item.id);
    },
    collect: (monitor) => ({
      isOver: monitor.isOver(),
      canDrop: monitor.canDrop(),
    }),
  }), [onDropToRoot]);

  return (
    <div
      ref={drop}
      className={`min-h-[40px] rounded ${isOver && canDrop ? 'bg-accent/10 ring-1 ring-accent/50' : ''}`}
    >
      {children}
      {isOver && canDrop && children && React.Children.count(children) === 0 && (
        <div className="text-[10px] text-accent text-center py-2">释放到根目录</div>
      )}
    </div>
  );
};

// ── 递归 flat map（收集所有后代） ──
function flattenTree(nodes: TreeFile[]): TreeFile[] {
  const result: TreeFile[] = [];
  const walk = (list: TreeFile[]) => {
    for (const n of list) {
      result.push(n);
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return result;
}

// ── 主组件 ──

const WorkspaceFiles: React.FC = () => {
  const { t } = useLang();
  const { user } = useContext(appContext);
  const files = useCloudFilesStore((s) => s.files);
  const filesLoading = useCloudFilesStore((s) => s.filesLoading);
  const selectedFilePaths = useCloudFilesStore((s) => s.selectedFilePaths);
  const setFiles = useCloudFilesStore((s) => s.setFiles);
  const setFilesLoading = useCloudFilesStore((s) => s.setFilesLoading);
  const toggleFileSelection = useCloudFilesStore((s) => s.toggleFileSelection);
  const clearFileSelection = useCloudFilesStore((s) => s.clearFileSelection);

  const navigate = useNavigate();
  const location = useLocation();
  const setLayoutTab = useRightPanelStore((s) => s.setLayoutTab);
  const setRightPanelOpen = useRightPanelStore((s) => s.setIsOpen);

  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [treeData, setTreeData] = useState<TreeFile[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // ── Breadcrumb helpers (tree mode: always root) ──
  const currentPath = '';

  const handleNavigateIntoFolder = useCallback((_path: string) => {
    // no-op: tree mode, folders expand inline
  }, []);

  const handleNavigateToCrumb = useCallback((_path: string) => {
    // no-op: tree mode
  }, []);

  // ── Build flat → tree; always wrap each bucket as a folder node ──
  const buildTreeFromFiles = useCallback((fileList: CloudFile[], uid: string): TreeFile[] => {
    const groups: Record<string, CloudFile[]> = {};
    for (const f of fileList) {
      const b = (f as any).bucket_name || '__none__';
      if (!groups[b]) groups[b] = [];
      groups[b].push(f);
    }
    const bucketKeys = Object.keys(groups);

    return bucketKeys.map((bucketName) => {
      const label = bucketName === '__none__' ? '默认存储桶' : bucketName;
      const children: TreeFile[] = groups[bucketName].map((f) => ({
        ...f,
        id: f.path,
        children: f.type === 'directory' ? [] : undefined,
        _userId: uid,
      } as TreeFile));
      return {
        id: `__bucket__${bucketName}`,
        name: label,
        path: `__bucket__${bucketName}`,
        type: 'directory' as const,
        size: 0,
        suffix: undefined,
        bucket_name: bucketName,
        syncStatus: 'synced' as const,
        children,
        _userId: uid,
        isBucket: true,
      } as TreeFile;
    });
  }, []);

  // Sync Zustand files → treeData, then reload children for expanded folders
  const isReloadingRef = useRef(false);
  useEffect(() => {
    const userId = user?.email ?? '';
    setTreeData(buildTreeFromFiles(files, userId));

    // After a refresh rebuild, re-fetch children for all expanded folders
    const expandedIds = Array.from(expanded);
    if (expandedIds.length === 0) return;
    if (isReloadingRef.current) return;

    isReloadingRef.current = true;
    setLoadingPaths((prev) => {
      const next = new Set(prev);
      expandedIds.forEach((id) => next.add(id));
      return next;
    });

    (async () => {
      const results = await Promise.allSettled(
        expandedIds.map((id) =>
          cloudAPI.listFiles(id, userId || undefined).then((entries) => ({ id, entries }))
        )
      );

      setTreeData((cur) => {
        let updated = cur;
        for (const r of results) {
          if (r.status !== 'fulfilled') continue;
          const { id, entries } = r.value;
          const children: TreeFile[] = entries.map((e) => ({
            ...e,
            id: e.path,
            syncStatus: e.syncStatus as CloudFile['syncStatus'],
            children: e.type === 'directory' ? [] : undefined,
            _userId: userId,
          } as TreeFile));
          const replace = (ns: TreeFile[]): TreeFile[] =>
            ns.map((cn) =>
              cn.id === id
                ? { ...cn, children }
                : { ...cn, children: cn.children ? replace(cn.children) : cn.children }
            );
          updated = replace(updated);
        }
        return updated;
      });

      setLoadingPaths((prev) => {
        const next = new Set(prev);
        expandedIds.forEach((id) => next.delete(id));
        return next;
      });

      isReloadingRef.current = false;
    })();
  }, [files, user?.email, buildTreeFromFiles]);

  // ── Helpers ──
  const triggerRefresh = useCallback(() => {
    window.dispatchEvent(new CustomEvent('drsai:cloud:refresh'));
  }, []);

  /** Recursively check ancestry: true if targetId exists under ancestorId */
  const isDescendant = useCallback((ancestorId: string, targetId: string): boolean => {
    const walk = (nodes: TreeFile[]): boolean => {
      for (const n of nodes) {
        if (n.id === ancestorId && n.children) {
          // Check if targetId is in this subtree
          const check = (kids: TreeFile[]): boolean =>
            kids.some((k) => k.id === targetId || (k.children ? check(k.children) : false));
          return check(n.children);
        }
        if (n.children && walk(n.children)) return true;
      }
      return false;
    };
    return walk(treeData);
  }, [treeData]);

  // ── Expand / collapse with lazy loading ──
  const handleToggleExpand = useCallback((id: string) => {
    const userId = user?.email ?? '';

    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      next.add(id);

      // Lazy-load children on first expand
      setTreeData((current) => {
        let needsFetch = false;
        const load = (nodes: TreeFile[]): TreeFile[] =>
          nodes.map((n) => {
            if (n.id === id && n.type === 'directory' && Array.isArray(n.children) && n.children.length === 0) {
              needsFetch = true;
            }
            if (n.children) return { ...n, children: load(n.children) };
            return n;
          });
        load(current);

        if (needsFetch) {
          // Mark as loading
          setLoadingPaths((prev) => new Set(prev).add(id));

          setTimeout(async () => {
            try {
              const entries = await cloudAPI.listFiles(id, userId || undefined);
              const children: TreeFile[] = entries.map((e) => ({
                ...e,
                id: e.path,
                syncStatus: e.syncStatus as CloudFile['syncStatus'],
                children: e.type === 'directory' ? [] : undefined,
                _userId: userId,
              } as TreeFile));
              setTreeData((cur) => {
                const replace = (ns: TreeFile[]): TreeFile[] =>
                  ns.map((cn) =>
                    cn.id === id ? { ...cn, children } : { ...cn, children: cn.children ? replace(cn.children) : cn.children }
                  );
                return replace(cur);
              });
            } catch { /* ignore */ }
            finally {
              setLoadingPaths((prev) => { const next = new Set(prev); next.delete(id); return next; });
            }
          }, 0);
        }

        return load(current);
      });

      return next;
    });
  }, [user?.email]);

  // ── Inline rename ──
  const handleRename = useCallback(async (id: string, newName: string) => {
    const userId = user?.email ?? '';
    try {
      await cloudAPI.renameFile(id, newName, userId || undefined);
      // Optimistic tree update
      setTreeData((prev) => {
        const rename = (nodes: TreeFile[]): TreeFile[] =>
          nodes.map((n) => {
            if (n.id === id) {
              const parts = n.path.split('/');
              parts[parts.length - 1] = newName;
              return { ...n, name: newName, path: parts.join('/') };
            }
            if (n.children) return { ...n, children: rename(n.children) };
            return n;
          });
        return rename(prev);
      });
      triggerRefresh();
    } catch (err) {
      window.alert(`重命名失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [user?.email, triggerRefresh]);

  // ── Delete ──
  const handleDelete = useCallback(async (path: string, isDir: boolean) => {
    const name = path.split('/').pop() ?? path;
    const ok = window.confirm(
      isDir
        ? `确定要删除文件夹 "${name}" 及其所有内容吗？此操作不可恢复。`
        : `确定要删除 "${name}" 吗？此操作不可恢复。`
    );
    if (!ok) return;
    try {
      await cloudAPI.deleteFile(path, { recursive: isDir, userId: user?.email ?? '' });
      triggerRefresh();
    } catch (err) {
      window.alert(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [user?.email, triggerRefresh]);

  // ── Preview ──
  const handlePreview = useCallback((path: string, name: string, size: number, suffix: string | undefined) => {
    window.dispatchEvent(new CustomEvent('drsai:cloud:previewFile', {
      detail: { name, remotePath: path, size, suffix },
    }));
  }, []);

  // ── Download single file ──
  const handleDownload = useCallback((filePath: string) => {
    const url = cloudAPI.getDownloadUrl(filePath, user?.email ?? undefined);
    window.open(url, '_blank');
  }, [user?.email]);

  // ── Move node (DnD drop handler) ──
  const moveNode = useCallback((dragId: string, targetDirId: string) => {
    const userId = user?.email ?? '';

    // Snapshot for rollback
    const snapshot = JSON.parse(JSON.stringify(treeData)) as TreeFile[];

    // Find the dragged node
    const findNode = (nodes: TreeFile[], id: string): TreeFile | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children) {
          const found = findNode(n.children, id);
          if (found) return found;
        }
      }
      return null;
    };
    const draggedNode = findNode(treeData, dragId);
    if (!draggedNode) return;

    // Source path for API
    const srcPath = draggedNode.path;

    // Optimistic update
    setTreeData((prev) => {
      const draggedNodes: TreeFile[] = [];

      // Remove from old location
      const remove = (nodes: TreeFile[]): TreeFile[] =>
        nodes.reduce<TreeFile[]>((acc, n) => {
          if (n.id === dragId) {
            draggedNodes.push(n);
            return acc;
          }
          if (n.children) return [...acc, { ...n, children: remove(n.children) }];
          return [...acc, n];
        }, []);

      let newTree = remove(prev);

      // Insert into target
      const insert = (nodes: TreeFile[]): TreeFile[] =>
        nodes.map((n) => {
          if (n.id === targetDirId) {
            const targetNode = findNode(treeData, targetDirId);
            const targetDir = targetNode?.path ?? '';
            const newPath = targetDir ? `${targetDir}/${draggedNode.name}` : draggedNode.name;
            return {
              ...n,
              children: [...(n.children ?? []), { ...draggedNodes[0], id: newPath, path: newPath }],
            };
          }
          if (n.children) return { ...n, children: insert(n.children) };
          return n;
        });

      return insert(newTree);
    });

    // Auto-expand target folder
    setExpanded((prev) => new Set(prev).add(targetDirId));

    // Background API call
    const targetNode = findNode(treeData, targetDirId);
    const targetDir = targetNode?.path || '/';
    cloudAPI.moveFile(srcPath, targetDir, userId || undefined)
      .then(() => triggerRefresh())
      .catch((err) => {
        setTreeData(snapshot); // rollback
      });
  }, [treeData, user?.email, triggerRefresh]);

  // ── Move to root (drop on root area) ──
  const handleDropToRoot = useCallback((dragId: string) => {
    const userId = user?.email ?? '';

    const findNode = (nodes: TreeFile[], id: string): TreeFile | null => {
      for (const n of nodes) {
        if (n.id === id) return n;
        if (n.children) {
          const found = findNode(n.children, id);
          if (found) return found;
        }
      }
      return null;
    };
    const draggedNode = findNode(treeData, dragId);
    if (!draggedNode) return;

    const srcPath = draggedNode.path;
    const snapshot = JSON.parse(JSON.stringify(treeData)) as TreeFile[];

    setTreeData((prev) => {
      const draggedNodes: TreeFile[] = [];
      const remove = (nodes: TreeFile[]): TreeFile[] =>
        nodes.reduce<TreeFile[]>((acc, n) => {
          if (n.id === dragId) { draggedNodes.push(n); return acc; }
          if (n.children) return [...acc, { ...n, children: remove(n.children) }];
          return [...acc, n];
        }, []);
      return [...remove(prev), ...draggedNodes.map((n) => ({ ...n, id: n.name, path: n.name }))];
    });

    cloudAPI.moveFile(srcPath, '/', userId || undefined)
      .then(() => triggerRefresh())
      .catch((err) => {
        setTreeData(snapshot);
      });
  }, [treeData, user?.email, triggerRefresh]);

  // ── Sync / refresh ──
  const handleManualRefresh = useCallback(async () => {
    if (filesLoading || syncing) return;
    setSyncing(true);
    try {
      await cloudAPI.refreshSync(user?.email ?? undefined);
    } catch { /* ignore */ }
    finally {
      setSyncing(false);
      triggerRefresh();
    }
  }, [filesLoading, syncing, user?.email, triggerRefresh]);

  // Listen for external refresh
  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener('drsai:cloud:refresh', handler);
    return () => window.removeEventListener('drsai:cloud:refresh', handler);
  }, []);

  // Load root files on mount / refresh; subfolders lazy-load on expand
  useEffect(() => {
    let cancelled = false;
    const userId = user?.email ?? '';
    setFilesLoading(true);
    cloudAPI.listFiles(undefined, userId || undefined)
      .then((entries) => {
        if (!cancelled) {
          setFiles(entries.map((e) => ({ ...e, syncStatus: e.syncStatus as CloudFile['syncStatus'] })));
        }
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => { if (!cancelled) setFilesLoading(false); });
    return () => { cancelled = true; };
  }, [setFiles, setFilesLoading, refreshKey, user?.email]);

  // ── Toolbar actions ──

  const selectedCount = selectedFilePaths.size;

  const handleSendToAgent = useCallback(async () => {
    if (selectedCount === 0) return;
    const paths = Array.from(selectedFilePaths);
    setSending(true);
    try {
      const { errors } = await cloudAPI.pullToWorkspace(paths, user?.email ?? '');
      const ok = paths.map((p) => `- ${p}`).join('\n');
      const failed = errors.length > 0
        ? `\n\n以下文件准备失败：\n${errors.map((e) => `- ${e.path}: ${e.error}`).join('\n')}`
        : '';
      const msg = `请读取以下 GFS 文件：\n${ok}${failed}`;
      window.dispatchEvent(new CustomEvent('drsai:chatinput:setValue', { detail: { text: msg } }));
      clearFileSelection();
      setLayoutTab("overview");
      setRightPanelOpen(true);
      navigate(createSearchWithView(location.search, "chat"));
    } catch { /* ignore */ }
    finally { setSending(false); }
  }, [selectedFilePaths, selectedCount, clearFileSelection, user?.email, navigate, location.search, setLayoutTab, setRightPanelOpen]);

  // When checkbox selection changes, auto-inject file paths into chat input
  const prevSelectedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Skip if selection didn't actually change (initial mount)
    const prev = prevSelectedRef.current;
    const curr = selectedFilePaths;
    if (prev.size === curr.size && Array.from(prev).every((p) => curr.has(p))) return;
    prevSelectedRef.current = new Set(curr);

    if (curr.size === 0) {
      window.dispatchEvent(new CustomEvent('drsai:chatinput:setValue', { detail: { text: '' } }));
      return;
    }
    const paths = Array.from(curr);
    const msg = `请读取以下 GFS 文件：\n${paths.map((p) => `- ${p}`).join('\n')}`;
    window.dispatchEvent(new CustomEvent('drsai:chatinput:setValue', { detail: { text: msg } }));
  }, [selectedFilePaths]);

  const handleDownloadAll = useCallback(() => {
    const allFiles = flattenTree(treeData);
    const candidates = selectedCount > 0
      ? allFiles.filter((f) => selectedFilePaths.has(f.path) && f.type !== 'directory')
      : allFiles.filter((f) => f.type !== 'directory');
    if (candidates.length === 0) { window.alert('没有可下载的文件。'); return; }
    candidates.forEach((f, i) => {
      setTimeout(() => {
        const url = cloudAPI.getDownloadUrl(f.path, user?.email ?? undefined);
        window.open(url, '_blank');
      }, i * 300);
    });
  }, [treeData, selectedFilePaths, selectedCount, user?.email]);

  const handleUploadClick = useCallback(() => fileInputRef.current?.click(), []);

  const handleFilesPicked = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    if (e.target) e.target.value = '';
    if (picked.length === 0) return;
    setUploading(true);
    try {
      const destDir = 'uploads';
      const { uploaded, errors } = await cloudAPI.uploadFiles(picked, destDir, user?.email ?? '');
      if (errors.length > 0) window.alert(`部分文件上传失败：\n${errors.map((e) => `- ${e.name}: ${e.error}`).join('\n')}`);
      if (uploaded.length > 0) triggerRefresh();
    } catch (err) {
      window.alert(`上传失败：${err instanceof Error ? err.message : String(err)}`);
    } finally { setUploading(false); }
  }, [user?.email, triggerRefresh]);

  const handleNewFolder = useCallback(() => {
    const name = window.prompt('请输入文件夹名称：');
    if (!name?.trim()) return;
    cloudAPI.createFolder('', name.trim(), user?.email ?? undefined)
      .then(() => triggerRefresh())
      .catch((err) => window.alert(`创建文件夹失败：${err instanceof Error ? err.message : String(err)}`));
  }, [user?.email, triggerRefresh]);

  const totalItems = treeData.length;

  // ── Breadcrumb (tree mode: root only) ──
  const breadcrumbs = [{ label: '根目录', path: '' }];

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="flex flex-col h-full space-y-2">
        {/* 工具栏 */}
        {/* <div className="flex items-center justify-between gap-1.5 px-0.5 pt-0.5">
          <span className="text-[10px] text-secondary"></span>
          <div className="flex items-center gap-1">
            <button
              type="button" onClick={handleManualRefresh} disabled={filesLoading || syncing}
              title="刷新文件列表"
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-tertiary/20 text-secondary hover:bg-tertiary/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <RotateCw className={`w-2.5 h-2.5 ${(filesLoading || syncing) ? 'animate-spin' : ''}`} />
              {syncing ? '同步中…' : '刷新'}
            </button>
            <button
              type="button" onClick={handleNewFolder}
              title="新建文件夹"
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-tertiary/20 text-secondary hover:bg-tertiary/30 transition-colors"
            >
              <FolderPlus className="w-2.5 h-2.5" /> 新建
            </button>
            <button
              type="button" onClick={handleUploadClick} disabled={uploading}
              title="上传文件到 GFS"
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Upload className="w-2.5 h-2.5" />
              {uploading ? '上传中…' : '上传'}
            </button>
          </div>
        </div> */}

        {/* 面包屑 */}
        <div className="flex items-center gap-0.5 flex-wrap px-0.5 text-[11px] select-text">
          {breadcrumbs.map((seg, idx) => {
            const isLast = idx === breadcrumbs.length - 1;
            return (
              <React.Fragment key={seg.path || 'root'}>
                {idx > 0 && (
                  <span className="text-secondary select-text px-0.5">/</span>
                )}
                <button
                  type="button"
                  onClick={() => !isLast && handleNavigateToCrumb(seg.path)}
                  disabled={isLast}
                  className={`px-1.5 py-0.5 rounded transition-colors flex items-center gap-1 ${isLast
                    ? 'text-primary font-medium cursor-default'
                    : 'text-secondary hover:text-primary hover:bg-tertiary/20'
                    }`}
                >
                  {idx === 0 && <Home className="w-3 h-3" />}
                  <span className="truncate max-w-[180px]" title={seg.label}>{seg.label}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>

        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesPicked} />

        {/* 文件树 */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {filesLoading ? (
            <div className="text-center py-4 text-[11px] text-secondary">加载中…</div>
          ) : treeData.length === 0 ? (
            <div className="text-center py-4 text-[11px] text-secondary">暂无文件</div>
          ) : (
            <TreeRoot onDropToRoot={handleDropToRoot}>
              {treeData.map((node) => (
                <TreeNode
                  key={node.id}
                  node={node}
                  depth={0}
                  expanded={expanded}
                  loadingPaths={loadingPaths}
                  onToggleExpand={handleToggleExpand}
                  onNavigateIntoFolder={handleNavigateIntoFolder}
                  onRename={handleRename}
                  onDelete={handleDelete}
                  onPreview={handlePreview}
                  onDownload={handleDownload}
                  selectedPaths={selectedFilePaths}
                  onToggleSelect={toggleFileSelection}
                  treeData={treeData}
                  moveNode={moveNode}
                  isDescendant={isDescendant}
                />
              ))}
            </TreeRoot>
          )}
        </div>

        {/* 操作栏 */}
        {/* <div className="flex items-center gap-1 pt-1 border-t border-border-primary/20"> */}
        {/* <button
            type="button" onClick={handleSendToAgent} disabled={selectedCount === 0 || sending}
            className="flex items-center gap-1 px-1.5 py-1 text-[10px] font-medium rounded bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-2.5 h-2.5" />
            {sending ? t('operation.fetching') : t('operation.sendToAgent')}
          </button> */}
        {/* <button
            type="button" onClick={handleDownloadAll}
            className="flex items-center gap-1 px-1.5 py-1 text-[10px] font-medium rounded bg-tertiary/20 text-secondary hover:bg-tertiary/30 transition-colors"
          >
            <Download className="w-2.5 h-2.5" />
            {t('operation.downloadAll')}
          </button> */}
        {/* {selectedCount > 0 && (
            <span className="ml-auto text-[10px] text-tertiary tabular-nums">
              {t('operation.selected', selectedCount)}
            </span>
          )} */}
        {/* </div> */}
      </div>
    </DndProvider>
  );
};

export default WorkspaceFiles;
