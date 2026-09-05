---
name: pptx
description: Create, inspect, validate, and render editable PowerPoint presentations. Use whenever the user asks to create or modify a presentation, slide deck, slides, or a .pptx artifact.
---

# PPTX

Create editable `.pptx` files with the bundled scripts. Keep every output inside the current workspace and do not download external images unless the user explicitly requests them.

## Required workflow

1. Convert the requested content into a UTF-8 JSON specification accepted by `scripts/create_deck.py`.
2. Run `create_deck.py SPEC.json OUTPUT.pptx` to create the presentation.
3. Run `validate_deck.py OUTPUT.pptx`. Fix every reported error before continuing.
4. Run `render_deck.py OUTPUT.pptx RENDER_DIR` to render every slide to PNG.
5. Inspect every rendered slide for overflow, clipping, unintended overlap, blank slides, poor contrast, and inconsistent styling. Revise and repeat creation, validation, and rendering when needed.
6. Register the final `.pptx` as a presentation artifact and return its interactive artifact link.

Do not claim that rendering or visual inspection succeeded unless the corresponding command and inspection actually completed.
Execute each create, validate, or render script in a separate foreground tool call. Never chain commands with `;`, `&&`, `|`, redirection, or a second PowerShell call operator.

## JSON specification

Use this structure:

```json
{
  "title": "Deck title",
  "subtitle": "Optional subtitle",
  "theme": "blue-tech",
  "slides": [
    {"kind": "title", "title": "Deck title", "subtitle": "Subtitle"},
    {"kind": "content", "title": "Section", "bullets": ["First point", "Second point"]}
  ]
}
```

Supported slide kinds are `title` and `content`. Keep content slides to at most six concise bullets. The generator creates a 16:9 deck, editable text, consistent blue styling, and a page number on every slide.

## Commands

Use the Python executable available to the Agent runtime:

```text
python scripts/create_deck.py spec.json artifacts/deck.pptx
python scripts/validate_deck.py artifacts/deck.pptx
python scripts/render_deck.py artifacts/deck.pptx tmp/presentation-render
```

`render_deck.py` uses LibreOffice when available and Microsoft PowerPoint automation on Windows otherwise. If neither renderer is available, stop and report the missing renderer; do not substitute structural validation for visual inspection.
