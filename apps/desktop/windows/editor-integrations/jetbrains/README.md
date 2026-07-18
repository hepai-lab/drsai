# OpenDrSai IDE Context for JetBrains IDEs

This source-controlled plugin skeleton is the JetBrains producer for the
Windows desktop chat bar IDE context handoff. It writes the active editor file
and selected text to `.drsai/ide-context.json` inside the current project.

The desktop app already reads that file through `desktop:ide-context`. In the
chat bar, refresh IDE context and attach the current file or selection to turn
the handoff into visible `@file` or `@selection` context chips.

## Handoff Schema

```json
{
  "source": "jetbrains",
  "capturedAt": "2026-07-07T00:00:00.000Z",
  "currentFile": {
    "path": "C:\\repo\\src\\app.kt",
    "relativePath": "src/app.kt",
    "language": "kotlin",
    "line": 12,
    "column": 4
  },
  "currentSelection": {
    "path": "C:\\repo\\src\\app.kt",
    "relativePath": "src/app.kt",
    "text": "selected code",
    "startLine": 12,
    "endLine": 18,
    "language": "kotlin",
    "truncated": false
  }
}
```

The producer writes only under the project root, limits selected text to 12,000 characters,
and uses a temp-file replace so the desktop app does not read
partial JSON.

## Development Notes

1. Create a JetBrains Platform plugin project.
2. Copy `plugin.xml` and `src/main/kotlin/org/opendrsai/idecontext/OpenDrSaiIdeContextListener.kt`
   into that plugin.
3. Register the listener in `plugin.xml`.
4. Build or run the plugin in IntelliJ IDEA, PyCharm, WebStorm, or another
   JetBrains IDE.

## Packaging Preflight

The checked-in `../packaging-manifest.json` records the package descriptor,
source files, handoff path, source tag, and manual validation checklist for
this producer. Run `npm run verify:ide-producers` from
`apps/desktop/windows` before packaging; it checks this README, `plugin.xml`,
the Kotlin producer, and the shared packaging manifest stay aligned.

For a packaged install smoke:

1. Build the plugin ZIP with the JetBrains Gradle plugin from the host plugin
   project.
2. Install the ZIP from disk in IntelliJ IDEA, PyCharm, WebStorm, or another
   JetBrains IDE.
3. Restart the IDE and complete the manual verification checklist below.

## Manual Verification

1. Open a project in a JetBrains IDE.
2. Install or run the OpenDrSai IDE context plugin.
3. Open a source file and select text.
4. Switch editor focus or move the caret to trigger capture.
5. Confirm `.drsai/ide-context.json` contains `source: "jetbrains"`, the
   active file, and the selected text.
6. In the Windows desktop app, use Refresh IDE context and attach IDE current
   file or IDE selection from the chat composer.
