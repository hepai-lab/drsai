# Task 8: Rewrite Models Page for Unified Backend API

**Status**: ✅ Complete

**Date**: 2025-07-18

## Summary

Rewrote `desktop/drsai-desktop/src/renderer/src/screens/Models/Models.tsx` to use the new unified backend API instead of the old SavedModel interface.

## Changes

### Old Interface (removed)
- `SavedModel` with fields: `id`, `name`, `provider`, `model`, `baseUrl`, `createdAt`
- `providerLabelKey()` helper function
- `resolveCustomEnvKey()` helper function
- Custom provider modal with API key support
- Provider dropdown from `PROVIDERS` constants

### New Interface (added)
- `ModelItem` with fields: `alias`, `display_name`, `client_type`, `model`, `token_limit`, `max_tokens`, `reasoning`
- `CatalogResponse` with `default_alias` and `models: ModelItem[]`
- `formAlias` replaces `formName`
- `formClientType` replaces `formProvider` (values: `anthropic`, `openai`, `auto`)
- `formTokenLimit`, `formMaxTokens`, `formReasoningSupported` new fields
- Reasoning support with `param_type` auto-selected based on client type
- Default alias badge on model cards
- Simplified delete confirmation modal
- Updated API calls:
  - `listModels()` now returns `CatalogResponse` (not array)
  - `addModel()` takes a single object parameter
  - `updateModel()` uses alias as identifier, supports `new_alias`
  - `removeModel()` uses alias instead of id

## Verification

```
npx tsc --noEmit 2>&1
```

Result: **Zero errors** — TypeScript compilation passed cleanly.