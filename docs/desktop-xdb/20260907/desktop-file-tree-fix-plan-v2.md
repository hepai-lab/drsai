# 桌面文件树优化方案 V2

> 日期: 2026-09-10  
> 背景: P0–P3 重构后出现两个问题 — ① 树只显示少量条目且无法滚动/加载更多 ② 缺少右键菜单（复制路径等）

---

## 问题诊断

### 问题 1: 树截断 + 无法滚动 + "加载更多"不可用

#### 根因 A — CSS 高度链断裂（核心）

```
.files-context-panel          → grid-template-rows: auto auto minmax(0,1fr) auto; overflow:hidden
  └─ .files-context-body      → grid-template-columns: ...; overflow:hidden; min-height:0
       ├─ main (preview)      → 左列
       └─ aside (tree-pane)   → 右列, overflow:auto, min-height:0
            ├─ .files-context-tree (div, 无 height/flex/overflow)
            └─ .files-context-tree-footer
```

`.files-context-body` **只定义了 `grid-template-columns`，没有定义 `grid-template-rows`**。  
默认 grid row 高度为 `auto` → 行高随内容增长 → tree-pane 没有固定高度约束 →  
`overflow: auto` **不触发滚动条** → 父级 `overflow: hidden` 直接裁剪超出部分 →  
用户只看到视野内的 ~3 行，无法滚动。

#### 根因 B — `.files-context-tree` 无布局约束

`.files-context-tree` 仅有 `min-width: 0`，没有 `flex: 1`、`overflow: auto` 或 `height` 属性。  
作为 tree-pane 的子元素，它自然撑高父容器，导致父级 overflow 裁剪。

#### 根因 C — `.files-context-load-more` 无 CSS

`grep` 确认 `styles.css` 中 **完全不存在** `.files-context-load-more` 的样式规则。  
按钮以浏览器默认样式渲染，在裁剪区域内可能不可见或无法点击。

#### 根因 D — tree-pane 布局为普通块级，非 flex

tree-pane 内部是普通流式布局（tree div + footer div），没有用 flex 纵向排列。  
即使修复高度链，footer 也可能被 tree 内容推到裁剪区外。

### 问题 2: 无右键菜单

`FilesTree.tsx` 和 `FilesContextPanel.tsx` 中 **完全没有 context menu 实现**。  
用户无法复制路径、在系统资源管理器中打开、或执行其他文件操作。

---

## 优化方案

### P0: 修复滚动与布局（关键路径）

**目标**: 文件树可滚动，所有条目可见，"加载更多"按钮可用。

#### P0-1: 修复 `.files-context-body` grid 行高

```css
/* Before */
.files-context-body {
  grid-row: 3;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 42%);
  /* 缺少 grid-template-rows */
}

/* After */
.files-context-body {
  grid-row: 3;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(160px, 42%);
  grid-template-rows: minmax(0, 1fr);  /* ← 关键：约束行高 */
}
```

#### P0-2: tree-pane 改为 flex 纵向布局

```css
/* Before */
.files-context-tree-pane {
  padding: 8px 0;
}

/* After */
.files-context-tree-pane {
  padding: 8px 0;
  display: flex;
  flex-direction: column;
  min-height: 0;       /* 已有，保留 */
  overflow: hidden;     /* 改为 hidden，让内部 tree 区域滚动 */
}
```

#### P0-3: `.files-context-tree` 添加滚动

```css
/* Before */
.files-context-tree {
  min-width: 0;
}

/* After */
.files-context-tree {
  min-width: 0;
  flex: 1 1 0;
  overflow-y: auto;
  overflow-x: hidden;
}
```

#### P0-4: tree-footer 固定在底部

```css
.files-context-tree-footer {
  flex: 0 0 auto;       /* 不收缩 */
  /* 已有的其他属性保留 */
}
```

#### P0-5: 补全 `.files-context-load-more` 样式

```css
.files-context-load-more {
  font-size: 12px;
  color: var(--app-accent, #2563eb);
  background: none;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}
.files-context-load-more:hover {
  background: var(--app-panel-soft, #f0f4ff);
}
```

### P1: 右键上下文菜单

**目标**: 右键文件/文件夹弹出菜单，提供常用操作。

#### P1-1: 定义菜单数据结构

在 `desktopApi.ts` 中新增类型：

```typescript
export interface FileTreeNodeContextMenuAction {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}
```

#### P1-2: 在 FilesTree 中添加 onContextMenu 支持

```tsx
// FilesTree.tsx 新增 props
interface FilesTreeProps {
  // ... existing props
  onContextMenu?: (node: WorkspaceFileNode, x: number, y: number) => void;
}
```

在 `FilesTreeRow` 的 `<button>` 上添加：
```tsx
onContextMenu={(e) => {
  e.preventDefault();
  onContextMenu?.(node, e.clientX, e.clientY);
}}
```

#### P1-3: 实现右键菜单组件

新建 `FilesTreeContextMenu.tsx`：

```tsx
interface ContextMenuState {
  node: WorkspaceFileNode;
  x: number;
  y: number;
}

export function FilesTreeContextMenu({
  state,
  onClose,
  onAction,
}: {
  state: ContextMenuState;
  onClose: () => void;
  onAction: (actionId: string, node: WorkspaceFileNode) => void;
}): React.JSX.Element {
  // 菜单项:
  // - 复制路径 (copy-path)
  // - 复制相对路径 (copy-relative-path)
  // - 在系统资源管理器中打开 (open-in-explorer) — 仅目录
  // - 用系统程序打开 (open-with-system) — 仅文件
  // - 复制文件名 (copy-name)
}
```

#### P1-4: 在 FilesContextPanel 中集成

```tsx
// 新增状态
const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

// 传递给 FilesTree
<FilesTree
  ...
  onContextMenu={(node, x, y) => setContextMenu({ node, x, y })}
/>

// 渲染菜单
{contextMenu && (
  <FilesTreeContextMenu
    state={contextMenu}
    onClose={() => setContextMenu(null)}
    onAction={handleContextAction}
  />
)}
```

#### P1-5: 实现菜单动作

```typescript
async function handleContextAction(actionId: string, node: WorkspaceFileNode) {
  switch (actionId) {
    case "copy-path":
      await navigator.clipboard.writeText(node.path);
      break;
    case "copy-relative-path":
      await navigator.clipboard.writeText(node.relativePath);
      break;
    case "copy-name":
      await navigator.clipboard.writeText(node.name);
      break;
    case "open-in-explorer":
      await desktopApi.openPath(node.type === "directory" ? node.path : 
        node.path.substring(0, node.path.lastIndexOf(node.name)));
      break;
    case "open-with-system":
      await desktopApi.openPath(node.path);
      break;
  }
  setContextMenu(null);
}
```

#### P1-6: 菜单样式

```css
.files-tree-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 180px;
  background: var(--app-card-bg, #fff);
  border: 1px solid var(--app-panel-border, #e5e7eb);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  padding: 4px 0;
}
.files-tree-context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  color: var(--app-text-primary);
}
.files-tree-context-menu-item:hover {
  background: var(--app-panel-soft, #f0f4ff);
}
.files-tree-context-menu-item.disabled {
  opacity: 0.5;
  cursor: default;
}
.files-tree-context-menu-separator {
  height: 1px;
  margin: 4px 0;
  background: var(--app-panel-border, #e5e7eb);
}
```

### P2: 健壮性改进

#### P2-1: loadMore 增加错误处理与 loading 状态

```typescript
const [loadMoreState, setLoadMoreState] = useState<LoadState>("idle");

const loadMore = useCallback(async () => {
  if (!workspacePath || nextOffset === null || loadMoreState === "loading") return;
  setLoadMoreState("loading");
  try {
    const page = await desktopApi.listWorkspaceFiles({ ... });
    setNodes((current) => mergeTreeNodes(current, page.nodes));
    setNextOffset(page.nextOffset ?? null);
    setTruncated(page.truncated);
    setLoadMoreState("idle");
  } catch (caught) {
    setError(caught instanceof Error ? caught.message : String(caught));
    setLoadMoreState("error");
  }
}, [...]);
```

#### P2-2: tree-pane 空状态与 loading 状态优化

当 `loadState === "loading"` 时在 tree-pane 内显示 skeleton/spinner，而非空白。

#### P2-3: 滚动到底部自动加载

在 `.files-context-tree` 上添加 `onScroll` 监听，当滚动到底部且 `nextOffset !== null` 时自动触发 `loadMore()`。

---

## 实施顺序

| 步骤 | 优先级 | 改动文件 | 预估改动量 |
|------|--------|----------|-----------|
| 1 | P0-1~P0-5 | `styles.css` | ~40 行 CSS |
| 2 | P1-1 | `desktopApi.ts` | ~5 行类型 |
| 3 | P1-2 | `FilesTree.tsx` | ~10 行 |
| 4 | P1-3 | 新建 `FilesTreeContextMenu.tsx` | ~80 行 |
| 5 | P1-4~P1-5 | `FilesContextPanel.tsx` | ~40 行 |
| 6 | P1-6 | `styles.css` | ~30 行 CSS |
| 7 | P2-1 | `FilesContextPanel.tsx` | ~15 行 |
| 8 | P2-3 | `FilesContextPanel.tsx` / `FilesTree.tsx` | ~20 行 |

---

## 风险与注意事项

1. **CSS grid-template-rows 修改**: 需验证不影响 preview 区域布局。preview 和 tree-pane 共用同一 grid row，修改行高约束后两者都受影响。
2. **右键菜单 z-index**: 需确保菜单在所有面板之上，但不遮挡全局模态框。建议 z-index: 10000。
3. **clipboard API**: Electron renderer 中 `navigator.clipboard` 可用，但某些版本可能需要 `electron.clipboard`。需验证。
4. **滚动自动加载**: 需加 debounce 防止重复触发。
5. **右键菜单边界处理**: 菜单弹出位置需检测屏幕边界，避免超出视口。
