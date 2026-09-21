# Files, conversion, and PPTX

Supported analysis inputs include DOCX, PDF, PPTX, XLSX, CSV, TXT, and MD. Use the document-processing route for summaries and metadata. Legacy `.doc` conversion uses the existing `DocToDocxSkill` and Office helper; it does not imply RTF or ODT support.

For PPT/PPTX/deck requests, load the `presentations` skill and follow its workflow, including artifact-tool generation/editing, workspace-local temporary and final paths, and serial shell/download operations. If that skill or artifact tool is unavailable, explain the failure and stop rather than falling back to the legacy PPTX path.
