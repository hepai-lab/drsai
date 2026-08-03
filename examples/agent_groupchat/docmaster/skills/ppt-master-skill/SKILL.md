---
name: ppt-master
description: >
  AI-driven multi-format SVG content generation system for creating professional
  presentations. Converts source documents (PDF/DOCX/URL/Markdown) into high-quality
  SVG pages through multi-role collaboration (Strategist → Image_Generator → Executor)
  and exports to PPTX. Use when user asks to "create PPT", "make presentation",
  "生成PPT", "做PPT", "制作演示文稿", or explicitly mentions "ppt-master".
---

# PPT Master Skill

> **This skill is activated when the user explicitly requests "ppt-master" or mentions
> wanting to use the ppt-master workflow.** When activated, the agent must follow the
> ppt-master pipeline described below instead of the legacy DocMaster PPT tools
> (ppt_init_workspace_tool, ppt_build_pptx_tool, etc.).

## Activation Rule

When the user's message contains any of these signals:
- Explicit mention of "ppt-master" or "ppt master"
- Request to use the "SVG-based" or "multi-role" presentation workflow
- Request that clearly maps to ppt-master capabilities

Then:
1. Read the full SKILL.md from the ppt-master directory: `skills/ppt-master/skills/ppt-master/SKILL.md`
2. Follow the ppt-master workflow steps described therein
3. Use the ppt-master scripts located at `skills/ppt-master/skills/ppt-master/scripts/`
4. Use the ppt-master references located at `skills/ppt-master/skills/ppt-master/references/`
5. Use the ppt-master templates located at `skills/ppt-master/skills/ppt-master/templates/`
6. **Do NOT** use the legacy DocMaster PPT tools (ppt_init_workspace_tool, ppt_build_pptx_tool, etc.)

## Key Directories

| Path | Purpose |
|------|---------|
| `skills/ppt-master/skills/ppt-master/scripts/` | Pipeline scripts (source_to_md, project_manager, analyze_images, etc.) |
| `skills/ppt-master/skills/ppt-master/references/` | Methodology references (strategist.md, executor-base.md, etc.) |
| `skills/ppt-master/skills/ppt-master/templates/` | Layout, brand, deck, chart, and icon templates |
| `skills/ppt-master/skills/ppt-master/workflows/` | Standalone workflow guides |

## Core Pipeline

`Source Document → Create Project → [Template] → Strategist → [Image_Generator] → Executor → Live Preview → Quality Check → Post-processing → Export`

## Quick Reference

For the complete workflow with all steps, gates, and checkpoints, read:
```bash
run_read skills/ppt-master/skills/ppt-master/SKILL.md
```

For methodology references, read the appropriate file from `skills/ppt-master/skills/ppt-master/references/`:
- `strategist.md` — Strategy phase (brief, narrative, spec)
- `executor-base.md` — Execution phase (SVG generation, quality gates)
- `shared-standards.md` — Shared design standards
- `visual-review.md` — Visual quality review process
- `animations.md` — Animation and transition guidelines
- `canvas-formats.md` — Canvas format specifications
- `template-designer.md` — Template design system
- `image-generator.md` — AI image generation guidelines
- `image-layout-patterns.md` — Image layout pattern library
- `svg-image-embedding.md` — SVG image embedding rules
