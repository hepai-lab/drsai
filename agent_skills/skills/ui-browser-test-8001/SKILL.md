---
name: ui-browser-test-8001
description: Runs quick UI smoke tests using Cursor's built-in browser MCP when the user asks to "启动内置浏览器测试UI/测试UI/用内置浏览器测一下". Navigate to http://localhost:8001 (port 8001) and validate basic UI functionality, console errors, and key network requests.
---

# UI Browser Test (localhost:8001)

## When to use

Use this skill when the user asks you to start Cursor's built-in browser to test UI, mentions "内置浏览器", "UI测试", "8001端口", or wants you to open and test the page on port 8001.

## Default target

- URL: `http://localhost:8001`

If the user specifies a different path (e.g. `/chat`) or query params, prefer the user-provided URL while keeping host/port on `localhost:8001` unless explicitly changed.

## Workflow

### 0) Preconditions

- If the page cannot be reached (connection refused / blank), assume the dev server is not running and tell the user what you observed and what URL failed.
- Do not guess alternative ports unless the user asks.

### 1) Open the built-in browser safely

Follow the built-in browser best practices:

- Start by listing existing browser tabs. If a tab already exists, lock it before interacting.
- If no suitable tab exists, navigate directly to `http://localhost:8001`, then lock the tab.
- Between interactions that may change the DOM/URL, take a fresh snapshot before the next structural action.
- Unlock only when completely finished with all browser operations.

### 2) Smoke-test checklist (fast, deterministic)

On the loaded page, perform a quick pass:

- **Visual verification**: take one screenshot after load.
- **Console**: check browser console messages; treat uncaught exceptions and React/Vue runtime errors as failures.
- **Network**: inspect network requests; flag 4xx/5xx responses and failed fetch/XHR as failures.
- **Basic interaction** (minimal):
  - If there is an obvious primary action (e.g. a main button, input, navigation tab), perform exactly one click or one short input action.
  - After the action, re-check console + network + take a second screenshot if the UI changed.

### 3) Report format

Return results in this compact structure:

- **URL tested**: the final URL actually opened
- **Page state**: loaded / partial / failed to load (+ error)
- **Console**: OK / issues (paste the most important message lines)
- **Network**: OK / issues (list failing request URLs + status)
- **UI checks**:
  - What you clicked/typed (if any)
  - What changed (if anything)
- **Artifacts**: screenshots taken (describe them; no embeds)

### 4) If failures happen

- Prefer evidence: screenshot + console + failing network request.
- Suggest the smallest next step: e.g. "start dev server", "fix 500 on /api/xxx", "missing env var", etc.

