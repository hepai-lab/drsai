# How Helios Industrial Services can turn AI-enabled field operations into higher-quality growth

This demo registers a full `word-polished-doc-collab` refined workspace under `demos/` and showcases the current high-end path of the skill: semantic Markdown as the source of truth, a reusable preset-style profile, Python-generated exhibits, preview export, and a traceable QA bundle for a premium Word deliverable.

The document itself is a five-page fictional consulting article about how an industrial service company can redesign field operations around recurring contracts, remote triage, and branch-level economic discipline. It is intentionally content-dense so the demo can show column switching, exhibit handling, table treatment, and review evidence in one workspace.

## What This Demo Covers

- Refined workspace structure with `meta.json`, `asset_manifest.json`, preview evidence, and QA records
- English premium preset `teal_consulting_report`
- Single-column opener blocks, section-switched two-column body treatment, and single-column figure/table interruptions
- Python-figure routing for three exhibits with notes and source lines
- Stable table treatment for compact business tables
- `lint -> build -> preview -> QA -> visual review` as a fixed delivery chain

## Workspace Structure

```text
demos/word-refined-industrial-service-transformation/
  original/
  markdown/
    industrial_service_transformation/
      industrial_service_transformation.md
      meta.json
      asset_manifest.json
      assets/
  build/docx/
  scripts/
  temp/
```

## Quick CLI

Lint the Markdown source:

```bash
python word-polished-doc-collab/scripts/lint_doc_markdown.py \
  --meta demos/word-refined-industrial-service-transformation/markdown/industrial_service_transformation/meta.json
```

Build the `.docx`:

```bash
python word-polished-doc-collab/scripts/build_docx.py \
  --meta demos/word-refined-industrial-service-transformation/markdown/industrial_service_transformation/meta.json \
  --json-out demos/word-refined-industrial-service-transformation/temp/qa/build_report.json
```

Export the preview bundle:

```bash
python word-polished-doc-collab/scripts/export_docx_preview.py \
  --meta demos/word-refined-industrial-service-transformation/markdown/industrial_service_transformation/meta.json \
  --json-out demos/word-refined-industrial-service-transformation/temp/qa/preview_report.json
```

Run DOCX QA:

```bash
python word-polished-doc-collab/scripts/run_docx_qa.py \
  --meta demos/word-refined-industrial-service-transformation/markdown/industrial_service_transformation/meta.json \
  --json-out demos/word-refined-industrial-service-transformation/temp/qa/qa_report.json \
  --md-out demos/word-refined-industrial-service-transformation/temp/qa/qa_report.md
```

## Key Outputs

- Final DOCX: `build/docx/industrial_service_transformation.docx`
- Preview PDF: `temp/preview/industrial_service_transformation.pdf`
- QA report: `temp/qa/qa_report.md`
- Visual review log: `temp/qa/visual_review.md`
- Asset manifest: `markdown/industrial_service_transformation/asset_manifest.json`

## Notes

This demo is fictional and exists to show the refined path of the skill, not to imitate a protected branded template. The preset name and artifact language are generic, while the workflow still exercises the same engineering problems that a real consulting-style Word delivery must solve.
