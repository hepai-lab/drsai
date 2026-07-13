# OpenDrSai IDE Context for Visual Studio

This source-controlled VSIX package skeleton is the Visual Studio producer for
the Windows desktop chat bar IDE context handoff. It writes the active document
file and selected text to `.drsai/ide-context.json` inside the current solution
folder.

The desktop app already reads that file through `desktop:ide-context`. In the
chat bar, refresh IDE context and attach the current file or selection to turn
the handoff into visible `@file` or `@selection` context chips.

## Handoff Schema

```json
{
  "source": "visual_studio",
  "capturedAt": "2026-07-07T00:00:00.000Z",
  "currentFile": {
    "path": "C:\\repo\\src\\Program.cs",
    "relativePath": "src/Program.cs",
    "language": "csharp",
    "line": 12,
    "column": 4
  },
  "currentSelection": {
    "path": "C:\\repo\\src\\Program.cs",
    "relativePath": "src/Program.cs",
    "text": "selected code",
    "startLine": 12,
    "endLine": 18,
    "language": "csharp",
    "truncated": false
  }
}
```

The producer writes only under the solution root, limits selected text to 12,000 characters,
and uses a temp-file replace so the desktop app does not read
partial JSON.

## Development Notes

1. Create a VSIX project in Visual Studio 2022.
2. Copy `source.extension.vsixmanifest` and
   `source/OpenDrSaiIdeContextPackage.cs` into that project.
3. Add the package class to the VSIX project and build it.
4. Install or debug the VSIX in an experimental Visual Studio instance.

## Packaging Preflight

The checked-in `../packaging-manifest.json` records the VSIX manifest, source
files, handoff path, source tag, and manual validation checklist for this
producer. Run `npm run verify:ide-producers` from `apps/desktop/windows`
before packaging; it checks this README, `source.extension.vsixmanifest`, the
C# producer, and the shared packaging manifest stay aligned.

For a packaged install smoke:

1. Build the VSIX with Microsoft.VSSDK.BuildTools from the host VSIX project.
2. Install or debug the VSIX in an experimental Visual Studio 2022 instance.
3. Complete the manual verification checklist below.

## Manual Verification

1. Open a solution in Visual Studio.
2. Install or debug the OpenDrSai IDE context VSIX.
3. Open a source file and select text.
4. Save the file or invoke the package capture command.
5. Confirm `.drsai/ide-context.json` contains `source: "visual_studio"`, the
   active file, and the selected text.
6. In the Windows desktop app, use Refresh IDE context and attach IDE current
   file or IDE selection from the chat composer.
