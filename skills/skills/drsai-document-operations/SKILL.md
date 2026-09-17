---
name: drsai-document-operations
description: "Priority skill for contract and related-business workflows. Invoke immediately for 合同模板填写、按合同模板生成、合同修改、合同审查、合同审核、关联业务、申请资料完整性审核、材料审核、专家推荐或专家意见表. Do not use for general DOCX generation/editing, generic document analysis, or PPTX work; those tasks use separate skills."
metadata:
  short-description: Drsai document operations
---

# Drsai contract and related-business operations

Use this as the Drsai-facing guide only for contract and related-business workflows. The reusable Python implementation is bundled under `scripts/docmaster_impl/`; invoke its public classes/functions through small wrapper scripts or the Drsai runtime, rather than importing from the source DocMaster checkout.

## Import the bundled implementation

When a wrapper or local executor needs DOCX template functionality, add the skill's `scripts` directory to `PYTHONPATH` and import the bundled package:

```python
from docmaster_impl.docx_template_skill import DocxTemplateSkill
```

Other migrated modules are imported from the same package, for example `docmaster_impl.contract_review_skill` and `docmaster_impl.application_review_skill`. Do not import these modules from the original DocMaster checkout.

## Bundled related-business resources

The skill is self-contained for related-business expert workflows. Its `assets/guanlianyewu/` directory contains the expert rosters and the four official templates (attachments 1–4, including the expert-opinion form). `docmaster_impl.guanlianyewu_skill` finds this directory automatically; use `DOCMASTER_GUANLIANYEWU_RESOURCES` only to deliberately provide a replacement resource set.

For the normal template workflow, use the bundled wrappers from the skill root so the implementation is actually executed:

```text
python scripts/inspect_template.py <template_path>
python scripts/fill_template.py <template_path> <output_path> --context '<json-object>' --slot-values '<json-object>' --removal-ids '<json-array>'
```

Do not rewrite these commands inline with ad-hoc Python. The wrappers establish the skill-local import path and emit one JSON result for the runtime to inspect.

## Route the request

Load this skill immediately when the request matches the trigger phrases in its description. Use it only for the following workflows:

- Contract template filling: inspect the selected contract template, confirm unresolved slots and removal candidates, then create a new filled contract. Preserve signature/seal fields for manual completion.
- Contract modification or review: inspect the contract before making targeted edits; use the contract-review path only for actual contracts, not ordinary reports or forms.
- Related-business or application-material completeness audit: submit every supplied material in one audit call and return the generated `report_markdown` unchanged.
- Expert recommendation and expert-opinion forms for related-business applications: recommend candidates first, let the user choose, then generate forms for the selected experts.

Read [Template filling](references/template-filling.md) for contract templates and [Review and audit](references/review-and-audit.md) for contract/application audits.

## Explicit exclusions

Do not load this skill for general DOCX creation, generic DOCX editing, routine file summarization or extraction, spreadsheets, or any PPT/PPTX generation, editing, rendering, or review. Those capabilities are handled by separate skills.

## Non-negotiable behavior

1. Confirm the target contract/template and intended change when ambiguous. Inspect the relevant contract before non-trivial edits.
2. Write filled or modified contracts to a new path unless overwrite is explicit. Keep temporary files in the Drsai temporary workspace and final files in the user workspace.
3. Never auto-fill signatures, seals, or handwritten fields. Treat heuristic slots and removal candidates as requiring user confirmation.
4. For application-material audits, do not separately pre-process the same batch. Trust and return the audit report produced by the dedicated workflow.
5. Keep approval-sensitive, download, process-launch, and external-write tools serial and isolated. If a required capability is unavailable, state the limitation and stop that branch rather than silently falling back.

## Package boundary

Keep `scripts/docmaster_impl/` and `assets/guanlianyewu/` together when installing or copying this skill. Do not resolve expert rosters or templates from the original DocMaster checkout.
