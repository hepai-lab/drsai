# Bundled implementation

`docmaster_impl/` is the migrated, self-contained Python package for the Drsai skill. Import it from a wrapper or runtime using:

```python
from docmaster_impl.docx_template_skill import DocxTemplateSkill
from docmaster_impl.contract_review_skill import ContractReviewSkill
```

For template filling:

```python
from docmaster_impl.docx_template_skill import DocxTemplateSkill
```

Keep the skill's `scripts` directory on `sys.path` when launching a wrapper from outside this directory. Do not import the implementation from the original DocMaster checkout.
