# Desktop 文件树（FilesTree）VSCode 对齐修复方案

日期：2026-09-07

## 1. 范围约束

本方案的 Desktop 范围**仅限**：

- 渲染层：`apps/desktop/shared/renderer/src`（`components/files/*`、`styles.css`、`desktopApi.ts`）
- 适配层：`apps/desktop/shared/api`（`desktopApi.ts`、`desktopGateway.ts`）
- 主进程：`apps/desktop/shared/main`（`workspaceContext.ts`、`preload.ts`）、`apps/desktop/windows/src/main/index.ts`
- Desktop 网关：`cores/python/packages/drsai/src/drsai/backend/desktop_gateway`（`_workspace_files.py`、`routes/workspaces.py`）

旧兼容网关 `backend/gateway_legacy.py` 不属于本方案，不引用、不修改。开发用 `workbench`（`renderer/src/workbench`）为旁支，仅在第 5.7 节注明，不纳入本次必改项。

## 2. 当前实际链路

```text
FilesContextPanel.refresh()
  -> desktopApi.listWorkspaceFiles({ workspacePath, workspaceId,
       query, maxDepth: query ? 8 : 5, maxEntries: 900 })
  -> renderer/src/desktopApi.ts（Proxy → window.openDrSai）
  -> shared/main/preload.ts:1101  ipc "desktop:workspace-files"
  -> windows/src/main/index.ts:5248
       有 workspaceId 且网关可达：
         listWorkspaceFilesViaGateway(client, request)   (shared/main/workspaceContext.ts:2177)
       否则回退：
         listWorkspaceFiles(request)                      (shared/main/workspaceContext.ts:193)
  -> 网关 GET /v1/workspaces/{id}/files?path=.&depth=..&max_entries=..
  -> cores/python/.../desktop_gateway/routes/workspaces.py:65
  -> cores/python/.../desktop_gateway/_workspace_files.py:95  list_files()
  -> 适配回 WorkspaceFileTreeResult -> FilesTree 渲染
```

关键点：渲染层拿到的**永远是 `WorkspaceFileTreeResult`**，无法得知网关返回的是 `tree` 还是 `flat`（`shape` 字段在适配层被丢弃）。

## 3. 问题与根因

### P0-1 条目超限退化为平铺列表，树不再是树

`_workspace_files.py:196`：

```python
flat = bool(needle or offset or len(matched) > max_entries)
return {"shape": "flat" if flat else "tree", "data": page if flat else tree, ...}
```

- 客户端固定 `max_entries=900`。只要 DFS 后匹配条目 `> 900`，服务端剥掉 `children`，返回**按 DFS 顺序的前 900 条扁平列表**。
- 适配层 `convertGatewayFileList()`（`workspaceContext.ts:2130` 附近）**忽略 `shape`**，`FilesTree` 又统一按 `depth=0` 渲染。

后果：正常规模仓库（如本仓库）的"文件树"实际是一条**无层级、无缩进、无折叠箭头**的列表——这是"不像 VSCode"的头号根因。

### P0-2 深度硬限制与客户端不对齐，筛选直接 422

- 服务端路由 `routes/workspaces.py:68`：`depth: int = Query(default=2, ge=0, le=5)`。
- 客户端带筛选时发送 `maxDepth: 8`（`FilesContextPanel.tsx` refresh 参数），经 `clampInt(x,1,8)` 后仍为 `8` → 触发 `le=5` 校验 → **FastAPI 返回 422** → `refresh()` 抛错 → 错误提示、树不更新。筛选功能整体失效。

### P0-3 无懒加载：深度封顶后目录永远展不开

- `visit()` L152：仅当 `remaining > 0` 才写 `children`；到边界时**连 `children` 键都不产生**。
- 客户端一次性抓固定深度快照，之后纯前端展开。

后果：超过 5 层的目录永远展不开；且边界目录没有 `children`，`FilesTree.tsx:80` 的 `hasChildren` 为 false → 不显示折叠箭头，**空目录与"未加载目录"无法区分**。

### P1-1 每次刷新清空展开态，无法保持 VSCode 式展开

`FilesTree.tsx:26`：

```tsx
useEffect(() => {
  setExpandedPaths(autoExpand ? collectDirectoryPaths(nodes) : new Set());
}, [autoExpand, nodes]);
```

`nodes` 每次 `refresh()` 都是新引用；`refresh()` 由挂载、query 变化、**文件监听事件（`FilesContextPanel.tsx` 去抖 250ms）**触发。用户展开的目录会在任何一次文件变更后被全部折叠。

### P1-2 分页（Load more）对不上

- `FilesContextPanel.loadMore()` 依赖返回的 `nextOffset`。
- 本地 `listWorkspaceFiles()` 返回体**无 `nextOffset`**，`validateTreeRequest()` 也**不读 `offset`** → 本地路径下"加载更多"永不出现，超出部分**静默丢失**。
- 网关路径即使返回 `next_offset`，`loadMore` 把补页**平铺 append 到树顶层**（`setNodes(curr => [...curr, ...page.nodes])`），树里混入根级平铺项。

### P2-1 本地 walk 的 DFS 预算吞掉顶层兄弟

`workspaceContext.ts:193` 的 `walk()` 先递归子目录、后 push 自身，且全局共享 `totalEntries`。第一个子目录吃满预算时，后续顶层目录直接 `break` 消失。表现为"前面几个顶层目录正常、后面凭空少一截"。

### P2-2 隐藏策略与 VSCode 默认不一致

`workspaceContext.ts` 隐藏所有 `.` 开头文件（仅放行 `.env`/`.github`/`.claude`），并把 `dist/build/out/target/coverage` 归入 `NOISY_DIRS`。用户会觉得"文件莫名不见了"。

### P3 UI／主题／性能／交互

- **暗色主题硬编码**：`styles.css:12907` 起 `.files-tree-row { color:#1f2937 }`、`.files-tree-row.selected { background:#f1f1f2 }`，未用主题变量，暗色模式不可读。
- **无虚拟化**：`FilesTreeRow` 递归渲染全部节点；筛选时 `autoExpand` 触发 `collectDirectoryPaths` **展开全部目录**（`FilesTree.tsx:133`）。
- 行高 `36px`（`styles.css:12907`）偏松散；无缩进参考线。
- 缺键盘导航（↑↓/←→/Enter）、根节点标题、"全部折叠"、右键菜单、拖拽、多选。

### 机制总结

现状不是"按需展开的树"，而是"**服务端一次性固定深度快照 + 超限退化平铺 + 前端纯内存展开 + 每次刷新清空展开态**"的列表。四类偏差：①数据形态会退化为 flat；②深度封顶且无懒加载；③展开态不持久；④筛选/分页/本地回退各有硬伤。

## 4. 目标形态（对齐 VSCode）

1. **永远是树**：根节点 → 目录 → 文件，逐层缩进、可折叠；顶层不会因超限退化为平铺。
2. **按需展开**：初始只取根的一级子项；展开某目录时才取该目录下一层，结果缓存；无深度上限。
3. **展开态持久**：同一工作区内跨刷新、跨文件变更保留展开集合；仅切换工作区时重置。
4. **筛选是过滤树**：保留命中项的祖先链，而非平铺。
5. **截断可见**：达到 `max_entries`/`scan_limit` 时显式提示"已截断"，而非静默丢弃。
6. **外观与交互**：主题变量、紧凑行高、缩进参考线、键盘导航、git 状态徽标。

## 5. 修复方案

### 5.1 P0-1 适配层透传并重建 shape（flat → tree）

**目标**：渲染层永远拿到真正的树。

- 在 `shared/main/workspaceContext.ts` 的 `convertGatewayFileList()` 中读取 `response.shape`：
  - `shape === "tree"`：现状映射，节点树。
  - `shape === "flat"`：**按 `path` 的 `/` 关系重建树**（把扁平条目按目录前缀挂回父子；缺失的中间目录用 `directory:true` 合成占位节点），再交给渲染层。
- 在 `WorkspaceFileTreeResult` 增加可选 `flat?: boolean`、`total?: number`、`scanLimit?: number`，供 UI 区分"过滤结果"与"浏览树"，并显示截断提示。
- 若不希望重建树：为 flat 结果提供**专用平铺呈现**（每行显示完整 `relativePath`），避免把它当树渲染。二者择一，优先重建树。

### 5.2 P0-2 对齐 depth 限制

- 首选：服务端 `routes/workspaces.py:68` 放开上限（如 `le=8`）或改为不做 `le` 限制，仅做 `ge=0`。
- 或：客户端把筛选时的 `maxDepth` 从 `8` 降回 `<=5`，与 `clampInt` 上限一致。
- 二者必须**同时**满足"客户端请求值 ≤ 服务端上限"，并加一条契约测试防止回归。

### 5.3 P1-1 懒加载（按目录加载）

- 初始请求：`{ path: ".", depth: 0, maxEntries: 小值 }`，只取一级子项。
- 展开目录时：请求 `{ path: <该目录 relativePath>, depth: 0, maxEntries: 小值 }` 取该目录一层，写入 `childrenByPath: Map<string, WorkspaceFileNode[]>`。
- `FilesTree` 改为读 `childrenByPath` + 节点 `hasChildren` 标志（服务端应显式给出 `has_children`，避免"空目录 vs 未加载"歧义；当前 `children` 缺省无法区分）。
- 好处：去掉深度上限、消除一次性 900 条预算问题、天然规避 flat 退化。

### 5.4 P1-2 展开态持久化

- 移除 `FilesTree.tsx:26` 的 `useEffect([autoExpand, nodes])` 无条件重置。
- 展开集合**提升到 `FilesContextPanel`**（或改为受控 prop），用 `useRef` 保留，仅在 `workspaceId/workspacePath` 变化时重置。
- 文件变更刷新时，对已展开目录**保留展开态**并按需重新拉取该层。

### 5.5 P2-1 本地实现补 offset／nextOffset，并修 walk 顺序

- `validateTreeRequest()` 读取 `offset`；`listWorkspaceFiles()` 在 `maxEntries` 之后按 `offset` 切片并返回 `nextOffset`（与网关语义一致）。
- `walk()` 改为**先 push 自身、再递归**，避免 DFS 预算吞掉顶层兄弟。
- 截断时把 `truncated` 透传到 UI。

### 5.6 P2-2 隐藏策略对齐

- 默认**展示点文件**（可配置忽略），保留 `node_modules`/`.git` 等噪声目录的忽略（可通过设置开关）。
- 把 `dist/build/out/target/coverage` 改为**默认展示**，只在用户显式配置时忽略，避免"文件消失"的错觉。

### 5.7 P3 外观／性能／交互

- 用主题变量替换硬编码颜色（`--app-text-primary`/`--app-panel-soft`/`--app-accent-soft` 等），选中态与 hover 随主题。
- 行高降到约 22–24px；增加缩进参考线（indent guide）。
- 大列表引入**虚拟滚动**（仅渲染可视区行）。
- 筛选改为"保留祖先链的过滤树"（或见 5.1 的平铺备选）。
- 补键盘导航（↑↓ 移动、←→ 折叠/展开、Enter 打开）、根节点标题、"全部折叠"、右键菜单。
- 旁支 `workbench/components/FilePane.tsx` 同步上述核心项（至少 flat 处理、展开态、主题配色），本方案不强制。

## 6. 验证矩阵

| 场景 | 预期 |
|---|---|
| 大仓库（>900 项）初次打开 | 显示**逐层缩进的树**，非平铺列表 |
| 展开第 6 层及更深目录 | 可继续展开到底，无深度封顶 |
| 展开若干目录后智能体写文件触发刷新 | 展开态保留，不被折叠 |
| 输入筛选关键字 | 返回**保留层级的过滤树**，不再 422 |
| 条目超限 | 显示"已截断"提示，不静默丢弃 |
| 切换工作区 | 展开态重置为新工作区根 |
| 暗色主题 | 行文字/选中态/图标可读，随主题 |
| 空目录 vs 未加载目录 | 视觉可区分（有/无可展开箭头） |
| 键盘导航 | ↑↓/←→/Enter 行为符合 VSCode 习惯 |

## 7. 执行命令

```powershell
Push-Location apps/desktop/windows
npm run typecheck:web
Pop-Location
git diff --check
python -m compileall -q cores/python/packages/drsai/src/drsai
python -m pytest -q cores/python/packages/drsai/tests -k "workspace_file or file_tree" 
```

若 typecheck 仍出现既有缺失生成文件或既有类型错误，将与本次修改新增错误分开报告。

## 8. 风险与回滚

- **服务端 depth 放开**影响所有 Desktop 客户端，需与适配层版本对齐；回滚点为恢复 `le=5` 并同步客户端 `maxDepth<=5`。
- **flat→tree 重建**是纯适配层行为，回滚代价低（恢复直接映射）。
- **懒加载**改动面最大（新增按目录拉取与缓存），建议独立提交并保留旧"整树"路径的开关，便于灰度回退。

## 9. 仍需确认

1. "左侧文件树"具体指**右侧 Files 面板内的 `FilesTree`**，还是三栏 `workbench` 的 `FilePane`。本方案默认前者。
2. 网关 `has_children` 字段是否可新增（第 5.3 节依赖它消除空目录歧义）。
3. 优先实施范围：建议先做 **P0-1 + P0-2**（改动小、见效快），再排 P1。
