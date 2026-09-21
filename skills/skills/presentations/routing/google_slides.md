# Google Slides Routing

Read this file for every request whose target is a native Google Slides deck.

## Existing Native Google Slides Decks

If a Google Slides integration is configured in the OpenDrSai environment, use it for
edits to an existing native Google Slides deck. Do not round-trip it through a local
PPTX unless the user asks.

## Net-New Native Google Slides Decks

Create and verify a local `.pptx` with this skill first. Then, if a Google Slides
import integration is available in the OpenDrSai environment, use it to import the
PPTX as a native Google Slides deck.

Do not use browser automation, blank-Google-Slides creation plus Google Slides write
APIs, or another direct-to-Slides construction path unless the user explicitly asks
for that alternate workflow.

If no Google Slides integration is configured, deliver the local `.pptx` as the
primary deliverable and inform the user that automatic Google Slides import is not
available in this environment.

After successful native import, return the Google Slides link as the primary
deliverable. Treat the local PPTX as a build artifact unless the user asks to
receive it.
