# WebUI Reuse Plan

The Windows desktop renderer should look and behave close to WebUI, but it
should not embed Gatsby or depend on WebUI routing.

## Current Desktop Boundary

The first Windows implementation keeps the Electron shell, installer,
gateway lifecycle, update flow, and diagnostics in `apps/desktop/windows`.
It mirrors WebUI's left navigation, central workspace, and right panel at the
layout level, but shared WebUI components have not been extracted yet.

Only completed desktop views should be enabled in the left navigation. WebUI
sections such as agents, skills, library, usage analytics, and admin should
remain disabled until their shared UI modules and desktop adapters exist.

## Extract First

1. Shared navigation model
   - Source candidate:
     - `apps/webui/frontend/src/components/views/menuRoutes.ts`
   - Target shape: pure `MenuId` / `CanvasViewId` constants and helpers shared
     by WebUI and Windows.

2. Workspace shell
   - Source candidates:
     - `apps/webui/frontend/src/layout/AppLayout.tsx`
     - `apps/webui/frontend/src/layout/LeftMenu.tsx`
     - `apps/webui/frontend/src/layout/RightPanel.tsx`
     - `apps/webui/frontend/src/layout/Canvas.tsx`
   - Target shape: `WorkspaceShell`, `NavTree`, `CanvasFrame`, and
     `TabbedSidePanel` components that receive all state through props.

3. Message rendering
   - Source candidates:
     - `apps/webui/frontend/src/pages/chat/rendermessage.tsx`
     - `apps/webui/frontend/src/components/common/markdownrender.tsx`
   - Target shape: pure `MessageList` / `MessageBubble` components that accept
     normalized message props.

4. Composer
   - Source candidate:
     - `apps/webui/frontend/src/pages/chat/chat/chatinput.tsx`
   - Target shape: controlled input component with callbacks for submit,
     attachments, and model selection.

5. Session and agent cards
   - Source candidates:
     - `apps/webui/frontend/src/components/features/Agents/*`
     - `apps/webui/frontend/src/components/views/sidebar.tsx`
   - Target shape: presentational cards/lists with no direct API calls.

## Do Not Extract Directly

- Gatsby pages under `apps/webui/frontend/src/pages`
- WebUI `SessionManager` state machine as-is
- WebSocket ownership hooks
- auth/session globals
- `/api/*` fetch wrappers

## Adapter Boundary

Windows desktop should expose an adapter that maps Electron IPC/SSE state into
the shared UI component props. Shared UI must not import `window.openDrSai`.

Desktop-only status such as install progress, gateway health, Python/Git
diagnostics, and update state should live in a right-panel `overview` slot or a
dedicated desktop status slot. It should not replace the WebUI right-panel
model of files, overview, history, and templates.
