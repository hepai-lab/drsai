# OpenDrSai IDE Context for VS Code

This lightweight VS Code extension is the first live producer for the Windows
desktop chat bar IDE context handoff. It writes the active editor file and
selected text to `.drsai/ide-context.json` inside the open workspace.

The Windows desktop app already reads that file through its bounded
`desktop:ide-context` IPC path. In the chat bar, refresh IDE context and attach
the current file or selection to turn the handoff into visible `@file` or
`@selection` context chips.

## Handoff Schema

```json
{
  "source": "vscode",
  "capturedAt": "2026-07-07T00:00:00.000Z",
  "currentFile": {
    "path": "C:\\repo\\src\\app.ts",
    "relativePath": "src/app.ts",
    "language": "typescript",
    "line": 12,
    "column": 4
  },
  "currentSelection": {
    "path": "C:\\repo\\src\\app.ts",
    "relativePath": "src/app.ts",
    "text": "selected code",
    "startLine": 12,
    "endLine": 18,
    "language": "typescript",
    "truncated": false
  }
}
```

The producer only writes under the active workspace root, limits selected text
to 12,000 characters, and uses an atomic temp-file rename so the desktop app
does not read partial JSON.

## Manual Verification

1. Open a workspace in VS Code.
2. Load this folder as an extension during development.
3. Open a source file and select text.
4. Run `OpenDrSai: Capture IDE Context`.
5. Confirm `.drsai/ide-context.json` contains `source: "vscode"`, the active
   file, and the selected text.
6. In the Windows desktop app, use Refresh IDE context and attach IDE current
   file or IDE selection from the chat composer.
