# Channel Adapter Package Runtime Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend smart chat bar channel adapter runtime verification so package and build ecosystem inputs are exercised through `importChannelContext`, not only static source-string checks.

**Architecture:** Reuse the existing temporary workspace verifier in `apps/desktop/windows/scripts/verify-channel-adapter-runtime-fixtures.mjs`. Add representative selected-file fixtures for Cargo, Dart, Apple, PHP/Ruby, Node package-manager config, and Elixir/Haskell manifests, then assert their specialized preview text and no-runtime safety copy.

**Tech Stack:** Node.js ESM verifier scripts, TypeScript transpilation via `typescript.transpileModule`, Windows desktop `channelAdapters.ts`, Markdown checklist/roadmap evidence.

## Global Constraints

- Do not launch package managers, compilers, build tools, registries, providers, or network calls.
- Do not change importer behavior unless a fixture exposes a concrete defect.
- Keep fixtures workspace-local and temporary.
- Keep docs evidence aligned with `verify:chatbar-checklist` and `verify:channel-adapters`.

---

### Task 1: Runtime Package Fixture Coverage

**Files:**
- Modify: `apps/desktop/windows/scripts/verify-channel-adapter-runtime-fixtures.mjs`
- Modify: `apps/desktop/windows/scripts/verify-chatbar-checklist.mjs`
- Modify: `apps/desktop/windows/docs/chatbar-capability-checklist.md`
- Modify: `apps/desktop/windows/docs/smart-chat-bar-roadmap.md`

**Interfaces:**
- Consumes: `importChannelContext({ adapterId: "file-input", workspacePath, paths, limit })`
- Produces: `npm run verify:channel-adapter-runtime-fixtures` assertions for package/config selected-file previews

- [x] **Step 1: Write failing verification expectations**

Add checklist verifier assertions for `runtime-package-manifest-golden-agent`, `runtime package/config golden fixtures`, and the selected fixture scope.

- [x] **Step 2: Run test to verify it fails**

Run: `npm run verify:chatbar-checklist`
Expected: FAIL because checklist/roadmap do not yet mention the new runtime package/config golden fixture evidence.

- [x] **Step 3: Add runtime fixtures**

Add temporary workspace fixtures for `Cargo.toml`, `pubspec.yaml`, `Package.swift`, `composer.json`, `Gemfile`, `sample.gemspec`, `.npmrc`, `mix.exs`, `stack.yaml`, and `sample.cabal`. Import them through `importChannelContext` and assert specialized preview text plus no-runtime safety copy.

- [x] **Step 4: Update docs evidence**

Add an agent workflow row and addendum describing the fixture suite, verification commands, manual verification limits, and remaining gaps.

- [x] **Step 5: Run verification**

Run: `npm run verify:channel-adapter-runtime-fixtures`, `npm run verify:channel-adapter-route-order`, `npm run verify:channel-adapters`, `npm run verify:chatbar-checklist`, and `npm run typecheck:node`.
Expected: PASS for all commands.
