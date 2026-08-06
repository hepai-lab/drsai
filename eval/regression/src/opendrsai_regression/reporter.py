from __future__ import annotations

import json
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


def write_reports(output_dir: str | Path, execution_id: str, results: list[dict[str, Any]]) -> None:
    root = Path(output_dir) / execution_id
    latest = _latest_by_case(results)
    counts = {status: sum(item.get("status") == status for item in latest) for status in ("passed", "failed", "error", "inconclusive")}
    summary = {"execution_id": execution_id, "total": len(latest), "attempts": len(results), **counts, "results": latest}
    (root / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    rows = [f"# Regression result: {execution_id}", "", f"Cases: {len(latest)} · Attempts: {len(results)} · Passed: {counts['passed']} · Failed: {counts['failed']} · Error: {counts['error']} · Inconclusive: {counts['inconclusive']}", "", "| Case | Status | Run | Category | First failed assertion |", "|---|---|---|---|---|"]
    for item in latest:
        failed = next((value for value in item.get("assertions") or [] if not value.get("passed")), None)
        detail = (failed or {}).get("path") or item.get("error") or ""
        values = [item["case_id"], item.get("status"), item.get("run_id") or "-", item.get("error_category") or "-", detail or "-"]
        rows.append("| " + " | ".join(str(value).replace("|", "\\|").replace("\n", " ") for value in values) + " |")
    case_args = " ".join(f"--case {item['case_id']}" for item in latest)
    adapter = next((item.get("evidence", {}).get("adapter") for item in latest if item.get("evidence", {}).get("adapter")), "gateway")
    adapter_args = "--adapter fixture --fixture-dir eval/regression/assets/evidence" if adapter == "fixture" else "--adapter gateway"
    rows.extend(["", "## Reproduce", "", f"`python eval/regression/run_regression.py run {case_args} {adapter_args} --execution-id {execution_id} --resume`"])
    (root / "summary.md").write_text("\n".join(rows) + "\n", encoding="utf-8")
    suite = ET.Element("testsuite", name="opendrsai-regression", tests=str(len(latest)), failures=str(counts["failed"] + counts["inconclusive"]), errors=str(counts["error"]))
    for item in latest:
        case = ET.SubElement(suite, "testcase", classname="opendrsai.regression", name=str(item["case_id"]), time=str(item.get("duration_seconds") or 0))
        if item.get("status") == "error":
            ET.SubElement(case, "error", type=str(item.get("error_category") or "error"), message=str(item.get("error") or "error"))
        elif item.get("status") != "passed":
            failures = [value for value in item.get("assertions") or [] if not value.get("passed")]
            node = ET.SubElement(case, "failure", type=str(item.get("status")), message=str(item.get("status")))
            node.text = json.dumps(failures, ensure_ascii=False)
    ET.ElementTree(suite).write(root / "junit.xml", encoding="utf-8", xml_declaration=True)


def _latest_by_case(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest: dict[str, dict[str, Any]] = {}
    for item in results:
        latest[str(item.get("case_id"))] = item
    return [latest[key] for key in sorted(latest)]
