# Contract review and application audit

Use `review_contract_tool` only for DOCX contracts or clearly contract-like files. It covers formatting, missing fields, consistency, and available LLM legal-risk checks. Use the returned summary and report issues by severity, location, message, and suggestion; mention an annotated output when produced.

For a group of application or related-business materials, call `audit_application_materials_tool` once with every absolute file path. Do not separately extract the same batch. Return `report_markdown` exactly as received, with at most a short opening and closing.
