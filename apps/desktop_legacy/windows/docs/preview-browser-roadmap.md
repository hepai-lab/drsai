# Right Sidebar Preview Browser Roadmap

This document defines the staged plan for the right sidebar Preview Browser in
the OpenDrSai Windows desktop app.

The long-term direction is to use `browser-use` for agent-controlled browser
tasks. The staged design keeps Version 1 and Version 2 reusable by placing all
shared browser behavior behind a controller interface. Version 3 should add a
`browser-use` adapter rather than replacing the browser panel.

## Product Direction

Goal: provide a lightweight browser surface in the right sidebar that can grow
from manual preview into supervised agent operation.

The browser is not just a visual iframe. It is a controlled tool surface with:

- A user-visible page preview.
- A consistent URL and navigation policy.
- Page context capture for chat and agent runs.
- Screenshots and DOM/text snapshots.
- A supervised action pipeline for click, type, wait, and assert operations.
- A future `browser-use` runtime for multi-step browser tasks.

The main architectural rule:

```text
Browser panel UI
  -> BrowserController interface
  -> Engine adapter
       - ElectronWebviewController in V1/V2
       - BrowserUseController in V3
```

V1 and V2 must not bake browser behavior directly into the React component in a
way that prevents replacing the engine later.

## Version 1: Preview Browser

Goal: make a small, stable browser available in the right sidebar for manual
preview and context capture.

Core capabilities:

- Show a `Browser` tab in the existing right sidebar.
- Open local development URLs such as `http://localhost:3000/`,
  `http://127.0.0.1`, and loopback IPv6.
- Open public `https:` URLs.
- Block unsafe public `http:` URLs by default.
- Block URLs with embedded credentials.
- Do not auto-load a page when the Browser tab is first opened.
- When a chat link targets a local preview URL, stage the URL in the address bar
  instead of immediately loading it.
- Allow the user to explicitly load the staged URL with `Open`.
- Provide back, forward, reload, and stop controls.
- Support multiple tabs.
- Support persisted browser history and bookmarks.
- Use a persistent browser session partition for normal page state and logins.
- Keep the embedded page isolated from the app renderer.
- Disable Node integration in embedded pages.
- Disable permissions, popups, downloads, and unexpected navigation by default.
- Show load failures, blocked URLs, crashes, and unresponsive page state in the
  browser panel instead of blanking the whole app.
- Provide a browser-panel error boundary so React errors in this feature do not
  take down the main workspace.
- Keep browser code in a dedicated module directory rather than a monolithic
  component file.

Acceptance:

- A user can open the right sidebar Browser tab without any page being loaded.
- A user can paste or stage a URL and intentionally open it.
- Local development pages and public HTTPS pages load when allowed.
- Unsafe URLs are blocked with a visible reason.
- Browser failures are contained to the browser panel.
- The rest of the desktop app remains usable if the embedded browser crashes.

Recommended implementation:

- Use the existing Electron `webview` adapter for the first pass because it is
  simple to render inside the React right panel.
- Keep the adapter contained and replaceable. Electron documents `webview` as a
  stability-sensitive API and recommends considering alternatives such as
  `WebContentsView`.
- Do not expose raw `webview` methods to chat or agent code.

## Version 2: Browser Controller And Agent Tool Surface

Goal: turn the Preview Browser into a reusable, supervised browser tool without
committing to the final automation engine.

Core capabilities:

- Define a shared `BrowserController` interface.
- Route all browser actions through the controller, not directly through React
  refs or raw `webview` calls.
- Define stable browser state types:
  - `BrowserPageState`
  - `BrowserSnapshot`
  - `BrowserScreenshot`
  - `BrowserActionRequest`
  - `BrowserActionResult`
  - `BrowserActionLogEntry`
- Provide read-only actions:
  - `open`
  - `snapshot`
  - `screenshot`
  - `read_text`
  - `eval_readonly`
- Provide supervised interactive actions:
  - `click`
  - `type`
  - `select`
  - `key_press`
  - `wait_for`
  - `assert_text`
- Require explicit user approval before side-effecting actions.
- Log each action with:
  - timestamp
  - target URL
  - action name
  - selector or target
  - result status
  - approval state
  - failure reason when available
- Capture page context into chat attachments:
  - URL
  - title
  - visible text
  - headings
  - links
  - buttons
  - inputs
  - candidate interactive elements
  - viewport and scroll position
  - recent console messages
  - recent load/network failures
  - optional screenshot data URL
- Provide an element picker for generating selectors from the visible page.
- Show agent-proposed browser actions in the UI before execution.
- Make browser actions available to chat/agent flows through a typed IPC/API
  boundary.

Acceptance:

- A user can attach browser text context to the next chat message.
- A user can attach a browser screenshot to the next chat message.
- An agent can request a read-only page snapshot without user confirmation.
- An agent cannot click, type, select, or press keys without explicit approval.
- Action results are visible in the Browser panel.
- The same action schema can be executed by the Electron adapter now and a
  `browser-use` adapter later.

Recommended implementation:

```ts
interface BrowserController {
  open(url: string): Promise<BrowserPageState>;
  back(): Promise<BrowserPageState>;
  forward(): Promise<BrowserPageState>;
  reload(): Promise<BrowserPageState>;
  stop(): Promise<BrowserPageState>;

  snapshot(): Promise<BrowserSnapshot>;
  screenshot(): Promise<BrowserScreenshot>;
  readText(): Promise<string>;

  click(selector: string, options?: BrowserActionOptions): Promise<BrowserActionResult>;
  type(selector: string, text: string, options?: BrowserActionOptions): Promise<BrowserActionResult>;
  select(selector: string, value: string, options?: BrowserActionOptions): Promise<BrowserActionResult>;
  keyPress(key: string, options?: BrowserActionOptions): Promise<BrowserActionResult>;
  waitFor(target: BrowserWaitTarget): Promise<BrowserActionResult>;
  assertText(text: string, selector?: string): Promise<BrowserActionResult>;
}
```

The React panel should call high-level actions. It should not know which engine
implements them.

## Version 3: browser-use Agent Browser

Goal: add `browser-use` as the agent-grade browser automation engine while
reusing V1 and V2 UI, policy, action schema, logs, attachments, and approval
flows.

Core capabilities:

- Add a Python `browser-use` worker process or service.
- Add a `BrowserUseController` adapter that implements the same
  `BrowserController` interface from V2.
- Keep the Browser panel as the user-visible cockpit:
  - current task
  - current URL
  - screenshot preview
  - action log
  - pending approvals
  - final extracted result
- Let simple deterministic actions use the Electron adapter when appropriate.
- Let complex multi-step tasks use `browser-use`.
- Support agent tasks such as:
  - navigate to a website
  - inspect page content
  - fill simple forms
  - click through local development UI
  - compare visible UI with expected behavior
  - collect evidence for debugging
- Return structured progress events from the `browser-use` worker:
  - task started
  - navigation
  - observation
  - proposed action
  - action executed
  - screenshot captured
  - extracted data
  - task completed
  - task failed
  - task cancelled
- Require approval for sensitive operations:
  - form submission
  - checkout/payment
  - login or auth flows
  - sending messages or emails
  - file upload/download
  - changing account/settings state
  - cross-origin data transfer
- Provide stop/cancel for running browser-use tasks.
- Isolate browser-use profiles from the app session by default.
- Support optional profile reuse only after explicit user opt-in.
- Persist task traces for debugging:
  - prompt/task
  - action timeline
  - screenshots
  - final result
  - failure reason

Acceptance:

- A user can ask the agent to operate a local development page.
- The agent can run a multi-step browser-use task and stream visible progress to
  the Browser panel.
- The user can approve, reject, or cancel pending browser actions.
- The agent can return screenshots and page context back to chat.
- V1/V2 Browser UI and attachment flows remain unchanged.
- The controller interface does not need to change when switching from
  Electron to browser-use for supported actions.

Recommended V3 runtime shape:

```text
Renderer
  Browser panel
  Chat/Agent request
      |
      v
Preload desktopApi
      |
      v
Main process BrowserController registry
      |
      +--> ElectronWebviewController
      |
      +--> BrowserUseController
              |
              v
          Python browser-use worker
              |
              v
          Playwright/Chromium browser context
```

The worker should communicate through a narrow local protocol. Prefer newline
delimited JSON or a small HTTP server bound to loopback. Each message should be
typed, versioned, and scoped to a browser task ID.

## Reuse Contract Between Versions

V3 must reuse:

- Right sidebar Browser panel layout.
- Browser tab state model.
- History and bookmark state.
- URL normalization and URL allow/block policy.
- Browser action request/result types.
- Approval UI and approval rules.
- Action log UI.
- Browser context attachment format.
- Screenshot attachment format.
- DOM snapshot schema where possible.
- IPC channel names or compatibility wrappers.
- Verification scripts.

V3 may replace:

- The actual browser engine.
- The page observation implementation.
- The screenshot implementation.
- Selector grounding internals.
- Multi-step planning and action selection.

V3 must not require:

- Rewriting the chat attachment schema.
- Rewriting the right sidebar shell.
- Rewriting the user approval model.
- Giving browser-use unsupervised access to credentials or arbitrary websites.

## Proposed Code Structure

Current and near-term renderer files:

```text
src/renderer/src/components/PreviewBrowserPanel.tsx
src/renderer/src/components/previewBrowser/
  BrowserPanelErrorBoundary.tsx
  types.ts
  state.ts
  scripts.ts
```

Target V2/V3 structure:

```text
src/shared/browser/
  types.ts
  actionPolicy.ts
  snapshotSchema.ts

src/main/browser/
  browserController.ts
  browserControllerRegistry.ts
  urlPolicy.ts
  actionApproval.ts
  adapters/
    electronWebviewController.ts
    browserUseController.ts
  browserUse/
    workerClient.ts
    protocol.ts
    processManager.ts

src/renderer/src/components/previewBrowser/
  PreviewBrowserPanel.tsx
  BrowserChrome.tsx
  BrowserTabs.tsx
  BrowserToolbar.tsx
  BrowserActions.tsx
  BrowserSurface.tsx
  BrowserActionLog.tsx
  BrowserPanelErrorBoundary.tsx
  state.ts
  usePreviewBrowser.ts
  useBrowserActions.ts

src/preload/
  browserApi.ts

src/shared/desktopApi.ts
  BrowserActionRequest
  BrowserActionResult
  BrowserSnapshot
  BrowserTaskEvent

src/python/browser_use_worker/
  worker.py
  protocol.py
  requirements.txt
```

The exact split can be incremental. The important boundary is that shared
action and snapshot types live outside the React component before V3 starts.

## IPC And Protocol

Renderer to main process:

```text
desktop:browser-check-url
desktop:browser-open
desktop:browser-action-request
desktop:browser-task-start
desktop:browser-task-stop
desktop:browser-task-events
```

Main process to browser-use worker:

```json
{"type":"task.start","taskId":"...","instruction":"...","url":"...","policy":{}}
{"type":"action.approve","taskId":"...","actionId":"...","approved":true}
{"type":"task.stop","taskId":"..."}
```

Worker to main process:

```json
{"type":"task.started","taskId":"..."}
{"type":"page.observed","taskId":"...","url":"...","title":"..."}
{"type":"action.proposed","taskId":"...","actionId":"...","action":"click","target":"..."}
{"type":"action.completed","taskId":"...","actionId":"...","ok":true}
{"type":"screenshot","taskId":"...","dataUrl":"..."}
{"type":"task.completed","taskId":"...","result":"..."}
{"type":"task.failed","taskId":"...","error":"..."}
```

## Security And Policy

Baseline rules:

- Default to local development URLs and public HTTPS.
- Block public HTTP unless explicitly allowed for a workspace.
- Block credential-bearing URLs.
- Block downloads by default.
- Block popup windows by default.
- Deny camera, microphone, geolocation, notifications, clipboard write, and
  file-system permissions by default.
- Keep embedded browser sessions separate from the app renderer.
- Keep browser-use profiles separate from the user's normal browser profile by
  default.
- Treat web page text as untrusted input.
- Do not let page text override user or system instructions.
- Require approval for side-effecting actions.
- Require stronger approval for sensitive actions.
- Log browser actions for auditability.

Agent-specific risks:

- Prompt injection from page content.
- Cross-origin data leakage through agent summaries or automated copy/paste.
- Accidental form submission.
- Credential exposure.
- Hidden or misleading UI elements.
- Download/upload side effects.

Mitigations:

- Separate observed page content from instructions in prompts.
- Include origin and URL in every observation.
- Limit what page content can be sent back to the model.
- Require explicit user approval for cross-origin transfer of page data.
- Maintain a per-origin action policy.
- Add red-team fixtures for prompt injection and deceptive UI.

## Testing Plan

### Feature/Test Matrix

Each shipped browser context feature must map to at least one verification
item. The current matrix is:

| Version | Feature point | Verification |
| --- | --- | --- |
| V1 | Right sidebar `Browser` tab exists and renders in the shell | `npm run verify:preview-browser` / `V1 right sidebar Browser tab`, `V1 browser panel rendered in right side` |
| V1 | Local/loopback URLs and public `https:` URLs are allowed | `npm run verify:preview-browser` / `V1 public HTTPS and local URL policy` |
| V1 | Public `http:`, credential URLs, and `file:` URLs are blocked | `npm run verify:preview-browser` / `V1 blocks public HTTP and credential URLs`, `V1 blocks file URLs through browser surface` |
| V1 | Browser tab does not auto-load on first open and chat links are staged | `npm run verify:preview-browser` / `V1 lazy webview mount on Browser tab open`, `V1 chat link stages URL before loading` |
| V1 | Explicit `Open`, back, forward, reload, and stop controls exist | `npm run verify:preview-browser` / toolbar, lazy-load, and `dom-ready` gate checks |
| V1 | Multiple tabs, close tab, history, bookmarks, and persisted state exist | `npm run verify:preview-browser` / `V1 multi-tab UI`, `V1 history and bookmarks`, `V1 restored browser state` |
| V1 | Embedded page isolation and webview security preferences are enforced | `npm run verify:preview-browser` / `V1 webview security policy` |
| V1 | Permissions, popups, downloads, redirects, crashes, and unresponsive states are contained | `npm run verify:preview-browser` / `V1 blocks popups downloads redirects permissions`, `V1 webview crash recovery` |
| V1 | Webview methods are called only after mount plus `dom-ready` | `npm run verify:preview-browser` / `V1 webview dom-ready gate`, `V1 webview actions disabled before dom-ready` |
| V1 | Browser code is split out of a monolithic component | `npm run verify:preview-browser` / `V1 browser module split` |
| V2 | Shared `BrowserController` and stable browser state/action types exist | `npm run verify:browser-controller` / controller and shared type checks |
| V2 | Read-only actions are accepted without side-effect approval | `npm run verify:browser-controller` / shared action policy checks |
| V2 | Interactive actions require explicit approval | `npm run verify:preview-browser` and `npm run verify:browser-controller` / approval boundary checks |
| V2 | Browser text context, DOM structure, console/network evidence, and screenshots attach to chat | `npm run verify:preview-browser` / context, DOM, screenshot, console/network checks |
| V2 | Element picker, wait/assert actions, and action log are present | `npm run verify:preview-browser` / `V3 element picker`, `V3 wait/assert/actions`, `V3 action log` |
| V2 | Browser action IPC uses shared policy instead of local ad hoc allowlists | `npm run verify:browser-controller` / `main IPC uses shared approval policy` |
| V3 | `browser-use` adapter, protocol, worker client, and Python worker exist | `npm run verify:browser-use-worker` / adapter, protocol, worker checks |
| V3 | Browser task start, stop, event stream, and approve/reject IPC are exposed through typed APIs | `npm run verify:preview-browser` and `npm run verify:browser-use-worker` / task IPC and approval IPC checks |
| V3 | Browser panel cockpit shows task status, pending approvals, screenshots, final result, and action events | `npm run verify:preview-browser` / task UI, pending approval UI, screenshot/result cockpit checks |
| V3 | Sensitive operations require stronger approval policy | `npm run verify:preview-browser`, `npm run verify:browser-controller`, `npm run verify:browser-use-worker` / sensitive approval checks |
| V3 | Worker profiles and browser-harness directories are isolated from the app session | `npm run verify:browser-use-worker` / profile and harness isolation checks |
| V3 | Task traces persist prompt/task, timeline, screenshots, result, and failure reason | `npm run verify:preview-browser` and `npm run verify:browser-use-worker` / task trace persistence checks |
| V3 | Worker emits structured fallback, fake-real, approval, screenshot, completion, cancellation, and failure events | `npm run verify:browser-use-worker-smoke` |
| All | TypeScript boundaries compile | `npm run typecheck` |
| All | Production build succeeds | `npm run build` |

### Static Verification

Script: `npm run verify:preview-browser`

Checks:

- Browser tab is present in the right sidebar.
- Browser panel is rendered from the app shell.
- URL policy allows local and HTTPS URLs.
- URL policy blocks unsafe URLs.
- Webview or engine adapter applies security preferences.
- Browser code is split into a module directory.
- Browser state is persisted safely.
- Initial Browser tab does not auto-load a page.
- Chat links stage URLs instead of auto-loading.
- Browser panel has an error boundary.
- Embedded browser crash/unresponsive events are handled.
- Context attachment and screenshot attachment paths exist.
- Action API includes read-only and supervised interactive actions.
- Approval boundary exists for side-effecting actions.
- Action log exists.
- V3 adapter interface exists once V3 starts.

### Unit Tests

Target areas:

- `normalizeUrlInput`
- `checkBrowserUrl`
- URL allow/block decisions
- browser action policy
- approval classification
- state serialization/deserialization
- task event parsing
- browser-use worker protocol parsing
- snapshot schema validation

Example cases:

- `localhost:3000` becomes `http://localhost:3000`.
- `example.com` becomes `https://example.com`.
- `http://example.com` is blocked.
- `https://user:pass@example.com` is blocked.
- `https://example.com` is allowed.
- Side-effecting actions require approval.
- Read-only snapshot does not require approval.
- Corrupt persisted browser state falls back to one empty tab.

### Renderer Integration Tests

Target areas:

- Open Browser tab.
- Stage URL from chat link.
- Open staged local URL.
- Navigate back/forward.
- Add and close tabs.
- Bookmark current page.
- Attach browser context to chat.
- Attach screenshot to chat.
- Show load failure without blanking the app.
- Show crash recovery state without blanking the app.
- Confirm/reject action approval prompts.
- Show action log entries.

### Main Process Tests

Target areas:

- `will-attach-webview` or adapter creation enforces security settings.
- Permission requests are denied by default.
- Downloads are blocked by default.
- New windows/popups are denied by default.
- Navigation redirects are rechecked by URL policy.
- Browser action IPC validates action, selector, text, key, and approval.
- Browser task process manager starts/stops worker safely.

### browser-use Worker Tests

Target areas:

- Worker starts with an isolated profile.
- Worker accepts a task over the local protocol.
- Worker emits task progress events.
- Worker returns screenshot and final result.
- Worker can be stopped.
- Worker failure is surfaced as a structured error.
- Worker does not run actions after cancellation.
- Worker does not access non-allowed URLs.

### End-to-End Smoke Tests

V1 smoke:

- Start the desktop app.
- Open Browser tab.
- Confirm no page is auto-loaded.
- Load a local fixture page.
- Capture text and screenshot.

V2 smoke:

- Ask the agent to inspect a local fixture page.
- Agent requests snapshot.
- Agent proposes a click.
- User approves.
- Click executes visibly.
- Result is attached to chat.

V3 smoke:

- Start browser-use worker.
- Ask the agent to complete a simple task on a local fixture page.
- Browser panel streams task progress.
- User approves a side-effecting action.
- browser-use completes the task.
- Final result, screenshot, and action log appear in chat/browser panel.

### Regression Tests For Known Failure Modes

- Clicking Browser tab should not create or load a browser engine immediately.
- Clicking a chat link should not auto-load a browser engine immediately.
- Browser engine crash should not blank the app.
- Re-rendering Browser panel should not duplicate browser event listeners.
- Unavailable local dev server should show a load failure, not a blank panel.
- Corrupt localStorage browser state should not crash the panel.
- Visual verification failures should produce useful logs and artifacts.

## Documentation And Verification Files

Planned docs and scripts:

```text
docs/preview-browser-roadmap.md
scripts/verify-preview-browser.mjs
scripts/verify-browser-controller.mjs
scripts/verify-browser-use-worker.mjs
```

`verify-preview-browser.mjs` should remain the high-level contract check for
V1/V2/V3. New implementation details should be added to focused verification
scripts rather than overloading one file indefinitely.

## Milestones

Milestone 1: stabilize V1.

- Browser tab opens safely.
- URL staging is safe.
- Webview failures are contained.
- Context and screenshot attachments work.
- Static verification and build pass.

Milestone 2: extract V2 controller.

- Shared browser types move out of renderer-only code.
- Main process owns URL policy and action approval.
- Browser panel calls controller actions.
- Agent tools use the same action schema.
- Integration tests cover snapshots and approved actions.

Milestone 3: add browser-use worker.

- Python worker can start, stop, and execute a local fixture task.
- Main process adapter translates controller calls into worker protocol.
- Browser panel streams progress and screenshots.
- User approval is enforced for side effects.
- V1/V2 Electron adapter still works.

Milestone 4: agent workflow hardening.

- Per-origin policies.
- Prompt injection fixtures.
- Cross-origin data transfer approval.
- Trace storage.
- Task replay/debug artifacts.
- Workspace-level browser settings.

## Open Decisions

- Whether V2 should migrate from Electron `webview` to `WebContentsView` before
  browser-use integration.
- Whether browser-use runs inside the existing Python backend environment or a
  separate worker environment.
- Whether browser-use should use a visible headed browser, a remote browser, or
  screenshots mirrored into the right sidebar.
- How much normal browser profile reuse to support.
- Where to store browser traces and screenshots.
- Whether per-workspace browser policies should be stored in workspace metadata
  or app-level settings.

## References

- Electron `webview` docs:
  https://www.electronjs.org/docs/latest/api/webview-tag
- Electron `WebContentsView` docs:
  https://www.electronjs.org/docs/latest/api/web-contents-view
- Playwright `connectOverCDP` docs:
  https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp
- browser-use:
  https://github.com/browser-use/browser-use
- Stagehand:
  https://github.com/browserbase/stagehand
