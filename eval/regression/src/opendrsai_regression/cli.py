from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .assertions import evaluate, semantic_pending, verdict
from .case_loader import CaseCatalog, DefinitionError, RegressionCase
from .models import CaseResult
from .environment import EnvironmentError, EnvironmentProvisioner
from .release_gate import evaluate_gate
from .reporter import write_reports
from .result_store import ResultStore
from .runtime_executor import FixtureRuntimeAdapter, GatewayRuntimeAdapter, RuntimeAdapterError, RuntimeConfig
from .semantic_evaluator import SemanticEvaluator
from .model_capability_runner import ModelCapabilityError, bind_runtime_run_evidence, evaluate_case_model_preflight, evaluate_model_capability_gate, run_profile, verify_audio_product_runtime
from .desktop_p3 import DesktopAutomationError, ElectronE2eTransport, input_text, summarize_runtime_evidence_for_persistence, validate_evidence, write_case_evidence
from .evidence import collect_evidence


def default_root() -> Path:
    return Path(__file__).resolve().parents[2]


def parser() -> argparse.ArgumentParser:
    value = argparse.ArgumentParser(description="OpenDrSai Agent regression evaluations")
    value.add_argument("--root", type=Path, default=default_root())
    commands = value.add_subparsers(dest="command", required=True)
    list_cmd = commands.add_parser("list", help="List and validate cases")
    _selection(list_cmd)
    validate_cmd = commands.add_parser("validate", help="Validate all definitions")
    validate_cmd.add_argument("--suite")
    run_cmd = commands.add_parser("run", help="Execute cases through the official Runtime Gateway")
    _selection(run_cmd)
    run_cmd.add_argument("--gateway-url", default=os.getenv("OPENDRSAI_REGRESSION_GATEWAY_URL"))
    run_cmd.add_argument("--workspace-id", default=os.getenv("OPENDRSAI_REGRESSION_WORKSPACE_ID"))
    run_cmd.add_argument("--gateway-token", default=os.getenv("OPENDRSAI_REGRESSION_GATEWAY_TOKEN"))
    run_cmd.add_argument("--access-token", default=os.getenv("OPENDRSAI_REGRESSION_ACCESS_TOKEN"))
    run_cmd.add_argument("--user-id", default=os.getenv("OPENDRSAI_REGRESSION_USER_ID"))
    run_cmd.add_argument("--adapter", choices=("gateway", "fixture"), default="gateway")
    run_cmd.add_argument("--fixture-dir", type=Path)
    run_cmd.add_argument("--output", type=Path, default=Path("tmp/eval-results/regression"))
    run_cmd.add_argument("--execution-id")
    run_cmd.add_argument("--resume", action="store_true")
    run_cmd.add_argument("--concurrency", type=int, default=None)
    run_cmd.add_argument("--stop-on-failure", action="store_true")
    run_cmd.add_argument("--scope-confirmed", action="store_true", help="Confirm the selected cases' declared external side-effect scope")
    run_cmd.add_argument("--semantic-evaluator-url", default=os.getenv("OPENDRSAI_REGRESSION_EVALUATOR_URL"))
    run_cmd.add_argument("--model-capability-snapshot", type=Path, default=os.getenv("OPENDRSAI_MODEL_CAPABILITY_SNAPSHOT"))
    gate_cmd = commands.add_parser("gate", help="Evaluate a result JSONL against a policy")
    gate_cmd.add_argument("--results", type=Path, required=True)
    gate_cmd.add_argument("--policy", type=Path, default=None)
    model_probe = commands.add_parser("model-probe", help="Probe Agent-bound model capabilities through the Gateway")
    model_probe.add_argument("--profile", type=Path, default=None)
    model_probe.add_argument("--gateway-url", default=os.getenv("OPENDRSAI_REGRESSION_GATEWAY_URL"))
    model_probe.add_argument("--gateway-token", default=os.getenv("OPENDRSAI_REGRESSION_GATEWAY_TOKEN"))
    model_probe.add_argument("--output", type=Path, default=Path("tmp/eval-results/regression"))
    model_gate = commands.add_parser("model-gate", help="Evaluate a model capability snapshot")
    model_gate.add_argument("--profile", type=Path, default=None)
    model_gate.add_argument("--snapshot", type=Path, required=True)
    model_list = commands.add_parser("model-list", help="List saved model capability executions")
    model_list.add_argument("--output", type=Path, default=Path("tmp/eval-results/regression"))
    model_show = commands.add_parser("model-show", help="Show a saved model capability snapshot")
    model_show.add_argument("--snapshot", type=Path, required=True)
    model_runtime = commands.add_parser("model-runtime-verify", help="Verify and bind a formal Runtime Run to a capability snapshot")
    model_runtime.add_argument("--profile", type=Path, default=None)
    model_runtime.add_argument("--snapshot", type=Path, required=True)
    model_runtime.add_argument("--model-id", required=True)
    model_runtime.add_argument("--operation", required=True)
    model_runtime.add_argument("--run-id", required=True)
    model_runtime.add_argument("--gateway-url", default=os.getenv("OPENDRSAI_REGRESSION_GATEWAY_URL"))
    model_runtime.add_argument("--gateway-token", default=os.getenv("OPENDRSAI_REGRESSION_GATEWAY_TOKEN"))
    model_audio = commands.add_parser("model-audio-runtime-verify", help="Verify and bind the formal TTS-to-STT product path")
    model_audio.add_argument("--profile", type=Path, default=None)
    model_audio.add_argument("--snapshot", type=Path, required=True)
    model_audio.add_argument("--gateway-url", default=os.getenv("OPENDRSAI_REGRESSION_GATEWAY_URL"))
    model_audio.add_argument("--gateway-token", default=os.getenv("OPENDRSAI_REGRESSION_GATEWAY_TOKEN"))
    desktop = commands.add_parser("desktop-run", help="Run P3 cases through a real Electron Desktop UI transport")
    _selection(desktop)
    desktop.add_argument("--output", type=Path, default=Path("tmp/eval-results/regression"))
    desktop.add_argument("--execution-id")
    desktop.add_argument("--transport-command", nargs=argparse.REMAINDER, required=True, help="Electron E2E command; must be last and __P3_CASE_ID__ is expanded per case")
    return value


def _selection(command: argparse.ArgumentParser) -> None:
    command.add_argument("--suite")
    command.add_argument("--case", action="append", default=[])
    command.add_argument("--tag", action="append", default=[])


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    catalog = CaseCatalog(args.root)
    try:
        if args.command == "validate":
            cases = catalog.load_cases()
            suites = [args.suite] if args.suite else [path.stem for path in sorted(catalog.suites_dir.glob("*.yaml"))]
            for suite_id in suites:
                catalog.load_suite(suite_id, cases)
            print(f"Validated {len(cases)} cases and {len(suites)} suites.")
            return 0
        if args.command == "list":
            for case in catalog.resolve(suite=args.suite, case_ids=args.case, tags=args.tag):
                print(f"{case.id}\trev={case.revision}\t{case.title}")
            return 0
        if args.command == "run":
            return _run(args, catalog)
        if args.command == "desktop-run":
            return _desktop_run(args, catalog)
        if args.command == "gate":
            results = _read_jsonl(args.results)
            policy = args.policy or catalog.root / "policies" / "p1-release-gate.yaml"
            passed, reasons = evaluate_gate(policy, results)
            print("PASS" if passed else "FAIL")
            for reason in reasons:
                print(f"- {reason}")
            return 0 if passed else 2
        if args.command == "model-probe":
            if not args.gateway_url:
                raise ValueError("model-probe requires --gateway-url (or OPENDRSAI_REGRESSION_GATEWAY_URL)")
            profile = args.profile or catalog.root / "model_capabilities" / "profiles" / "hepai-opendrsai-p2.yaml"
            print(run_profile(profile, gateway_url=args.gateway_url, gateway_token=args.gateway_token, output_root=args.output))
            return 0
        if args.command == "model-gate":
            profile = args.profile or catalog.root / "model_capabilities" / "profiles" / "hepai-opendrsai-p2.yaml"
            passed, reasons = evaluate_model_capability_gate(profile, args.snapshot)
            print("PASS" if passed else "FAIL")
            for reason in reasons:
                print(f"- {reason}")
            return 0 if passed else 2
        if args.command == "model-list":
            root = args.output / "model-capabilities"
            for snapshot in sorted(root.glob("*/capability-snapshot.json")) if root.exists() else []:
                payload = json.loads(snapshot.read_text(encoding="utf-8"))
                print(f"{snapshot.parent.name}\t{payload.get('created_at')}\t{payload.get('digest')}")
            return 0
        if args.command == "model-show":
            payload = json.loads(args.snapshot.read_text(encoding="utf-8"))
            print(f"agent={payload.get('agent_id')} created_at={payload.get('created_at')} digest={payload.get('digest')}")
            for row in payload.get("results", []):
                if isinstance(row, dict):
                    print(f"{row.get('model_id')}\t{row.get('operation')}\t{row.get('protocol')}\t{row.get('status')}")
            return 0
        if args.command == "model-runtime-verify":
            if not args.gateway_url:
                raise ValueError("model-runtime-verify requires --gateway-url (or OPENDRSAI_REGRESSION_GATEWAY_URL)")
            profile = args.profile or catalog.root / "model_capabilities" / "profiles" / "hepai-opendrsai-p2.yaml"
            row = bind_runtime_run_evidence(
                profile, args.snapshot, model_id=args.model_id, operation=args.operation,
                run_id=args.run_id, gateway_url=args.gateway_url, gateway_token=args.gateway_token,
            )
            print(f"runtime_verified\t{row.get('model_id')}\t{row.get('operation')}\t{row.get('runtime_evidence', {}).get('run_id')}")
            return 0
        if args.command == "model-audio-runtime-verify":
            if not args.gateway_url:
                raise ValueError("model-audio-runtime-verify requires --gateway-url (or OPENDRSAI_REGRESSION_GATEWAY_URL)")
            profile = args.profile or catalog.root / "model_capabilities" / "profiles" / "hepai-opendrsai-p2.yaml"
            speech, transcription = verify_audio_product_runtime(
                profile, args.snapshot, gateway_url=args.gateway_url, gateway_token=args.gateway_token,
            )
            print(f"runtime_verified\t{speech.get('model_id')}\t{speech.get('operation')}")
            print(f"runtime_verified\t{transcription.get('model_id')}\t{transcription.get('operation')}")
            return 0
    except (DefinitionError, RuntimeAdapterError, ModelCapabilityError, DesktopAutomationError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 2


def _run(args: argparse.Namespace, catalog: CaseCatalog) -> int:
    if args.adapter == "gateway" and not args.gateway_url:
        raise ValueError("gateway run requires --gateway-url (or OPENDRSAI_REGRESSION_GATEWAY_URL)")
    if args.adapter == "fixture" and not args.fixture_dir:
        raise ValueError("fixture run requires --fixture-dir")
    execution_id = args.execution_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    store = ResultStore(args.output, execution_id)
    cases = catalog.resolve(suite=args.suite, case_ids=args.case, tags=args.tag)
    if args.adapter == "gateway":
        if not args.model_capability_snapshot:
            raise ModelCapabilityError("gateway run requires --model-capability-snapshot (or OPENDRSAI_MODEL_CAPABILITY_SNAPSHOT)")
        preflight_passed, preflight_reasons = evaluate_case_model_preflight(cases, Path(args.model_capability_snapshot))
        if not preflight_passed:
            raise ModelCapabilityError("model capability preflight failed: " + "; ".join(preflight_reasons))
    store.initialize({
        "schema_version": "opendrsai.regression-execution/1", "execution_id": execution_id,
        "adapter": args.adapter, "suite": args.suite, "case_ids": [case.id for case in cases],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }, cases)
    case_versions = {case.id: (case.revision, hashlib.sha256(Path(case.path).read_bytes()).hexdigest()) for case in cases}
    completed = store.resumable_case_ids(case_versions) if args.resume else set()
    adapter = (FixtureRuntimeAdapter(args.fixture_dir) if args.adapter == "fixture" else
               GatewayRuntimeAdapter(RuntimeConfig(
                   args.gateway_url, args.workspace_id, args.gateway_token, args.access_token, args.user_id,
                   scope_confirmed=args.scope_confirmed,
               )))
    temp_root = os.getenv("OPENDRSAI_REGRESSION_TEMP_ROOT")
    if temp_root:
        Path(temp_root).mkdir(parents=True, exist_ok=True)
    provisioner = EnvironmentProvisioner(catalog.root, temp_parent=temp_root)
    semantic_evaluator = (
        SemanticEvaluator(args.semantic_evaluator_url) if args.semantic_evaluator_url else
        SemanticEvaluator("gateway-runtime", adapter.semantic_judge) if isinstance(adapter, GatewayRuntimeAdapter) else None
    )
    selected = [case for case in cases if case.id not in completed]
    suite_defaults = catalog.load_suite(args.suite).defaults if args.suite else {}
    concurrency = args.concurrency or int(suite_defaults.get("concurrency") or 1)
    if concurrency < 1 or concurrency > 32:
        raise ValueError("--concurrency must be between 1 and 32")
    if args.stop_on_failure:
        for case in selected:
            attempts = _execute_attempts(execution_id, case, adapter, provisioner, semantic_evaluator)
            for result in attempts:
                store.append(result)
            if not attempts or attempts[-1]["status"] != "passed":
                break
    else:
        with ThreadPoolExecutor(max_workers=concurrency, thread_name_prefix="opendrsai-regression") as executor:
            futures = {executor.submit(_execute_attempts, execution_id, case, adapter, provisioner, semantic_evaluator): case.id for case in selected}
            for future in as_completed(futures):
                for result in future.result():
                    store.append(result)
    results = store.load()
    write_reports(args.output, execution_id, results)
    print(store.root)
    return 0 if results and all(item["status"] == "passed" for item in results) else 1


def _desktop_run(args: argparse.Namespace, catalog: CaseCatalog) -> int:
    execution_id = args.execution_id or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-desktop-" + uuid.uuid4().hex[:8]
    cases = catalog.resolve(suite=args.suite, case_ids=args.case, tags=args.tag)
    if not cases:
        raise ValueError("desktop-run selected no cases")
    store = ResultStore(args.output, execution_id)
    store.initialize({"schema_version": "opendrsai.desktop-p3-execution/1", "execution_id": execution_id, "adapter": "desktop", "suite": args.suite, "case_ids": [case.id for case in cases], "created_at": datetime.now(timezone.utc).isoformat()}, cases)
    for case in cases:
        started = time.monotonic(); started_at = datetime.now(timezone.utc).isoformat()
        digest = hashlib.sha256(Path(case.path).read_bytes()).hexdigest()
        case_root = store.root / "desktop-evidence" / case.id
        try:
            result_path = case_root / "electron-result.json"
            command = [part.replace("__P3_CASE_ID__", case.id).replace("{case_id}", case.id) for part in args.transport_command]
            transport = ElectronE2eTransport(command, result_path, case_root)
            ui = transport.send_and_wait(text=input_text(case.data), timeout_seconds=max(120, int(case.data["execution"]["timeout_seconds"])))
            ui_evidence = validate_evidence(case.data, ui, case_root)
            # A UI run without a Run association is evidence-incomplete, never a pass.
            if not ui_evidence.get("run_id"):
                raise DesktopAutomationError("desktop_ui_run_association_missing")
            summary_path = write_case_evidence(case_root, case.id, ui, case.data)
            evaluation_evidence = {
                "adapter": "desktop", "desktop_ui": ui_evidence, "output": ui.final_response_text,
                # UI proof is necessary but cannot establish the P1 Runtime,
                # behavior, artifact, or OAEP assertions by itself.
                "evidence_complete": False,
                "evidence_missing": ["run_manifest", "run_inspection", "oaep_snapshot"],
                "desktop_summary": summary_path.name,
            }
            if ui.runtime_payload:
                runtime = ui.runtime_payload
                runtime_evidence = collect_evidence(
                    run=runtime.get("run") if isinstance(runtime.get("run"), dict) else {},
                    inspection=runtime.get("inspection") if isinstance(runtime.get("inspection"), dict) else {},
                    snapshot=runtime.get("snapshot") if isinstance(runtime.get("snapshot"), dict) else {},
                    manifest=runtime.get("manifest") if isinstance(runtime.get("manifest"), dict) else {},
                )
                # The user-visible final text is the authoritative output for
                # Desktop acceptance, never a copied Gateway response.
                evaluation_evidence = {
                    **runtime_evidence, **evaluation_evidence, "output": ui.final_response_text,
                    "evidence_complete": runtime_evidence.get("evidence_complete", False),
                    "evidence_missing": runtime_evidence.get("missing", []),
                }
                assertions = evaluate(case, evaluation_evidence)
                status = verdict(assertions)
            else:
                assertions = [item for item in evaluate(case, evaluation_evidence) if item.path.startswith("output.")]
                status = "inconclusive" if all(item.passed for item in assertions) else "failed"
            evidence = {
                **summarize_runtime_evidence_for_persistence(evaluation_evidence),
                "adapter": "desktop", "desktop_ui": ui_evidence,
                "desktop_summary": summary_path.name,
            }
            result = CaseResult(execution_id, case.id, case.revision, status=status, run_id=ui.run_id, session_id=ui.session_id, output=None, evidence=evidence, assertions=[item.to_dict() for item in assertions])
        except DesktopAutomationError as exc:
            result = CaseResult(execution_id, case.id, case.revision, status="error", error_category=str(exc), error=str(exc), evidence={"adapter": "desktop", "evidence_complete": False})
        result.started_at = started_at; result.completed_at = datetime.now(timezone.utc).isoformat(); result.duration_seconds = time.monotonic() - started; result.case_snapshot_sha256 = digest
        store.append(result.to_dict())
    results = store.load(); write_reports(args.output, execution_id, results); print(store.root)
    return 0 if all(item["status"] == "passed" for item in results) else 1


def _execute_attempts(execution_id: str, case: RegressionCase, adapter: Any, provisioner: EnvironmentProvisioner, semantic_evaluator: SemanticEvaluator | None = None) -> list[dict[str, Any]]:
    results = []
    for attempt in range(1, int(case.data["execution"]["attempts"]) + 1):
        result = _execute_case(execution_id, case, adapter, provisioner, attempt, semantic_evaluator)
        results.append(result)
        if result["status"] != "error":
            break
    return results


def _execute_case(execution_id: str, case: RegressionCase, adapter: GatewayRuntimeAdapter, provisioner: EnvironmentProvisioner, attempt: int = 1, semantic_evaluator: SemanticEvaluator | None = None) -> dict[str, Any]:
    started = time.monotonic()
    started_at = datetime.now(timezone.utc).isoformat()
    digest = hashlib.sha256(Path(case.path).read_bytes()).hexdigest()
    try:
        with provisioner.prepare(case, attempt) as environment:
            evidence = adapter.execute(case, environment)
            if semantic_evaluator is not None:
                semantic = semantic_evaluator.evaluate(case, evidence)
                evidence["semantic_evaluation"] = semantic.to_dict()
                if semantic.status != "inconclusive":
                    evidence["semantic_judgments"] = semantic.judgments
                if semantic.status == "passed":
                    for activation in evidence.get("skill_activations") or []:
                        if isinstance(activation, dict) and activation.get("skill_id") == "pptx":
                            activation["required_steps"] = sorted(set(activation.get("required_steps") or []) | {"visual_check_completed"})
            # Local paths exist only long enough to feed the independent
            # visual Judge. They must never enter persisted Evidence/Result.
            evidence.pop("_semantic_media", None)
        assertions = evaluate(case, evidence)
        status = verdict(assertions, semantic_pending=semantic_pending(case, evidence))
        result = CaseResult(execution_id, case.id, case.revision, attempt=attempt, status=status, run_id=evidence.get("run_id"), session_id=evidence.get("session_id"), output=evidence.get("output"), evidence=evidence, assertions=[item.to_dict() for item in assertions])
    except EnvironmentError as exc:
        result = CaseResult(execution_id, case.id, case.revision, attempt=attempt, status="error", error_category="environment_failed", error=str(exc))
    except TimeoutError as exc:
        evidence = dict(getattr(exc, "evidence", {}) or {})
        evidence.pop("_semantic_media", None)
        result = CaseResult(
            execution_id, case.id, case.revision, attempt=attempt, status="error",
            run_id=evidence.get("run_id"), session_id=evidence.get("session_id"),
            error_category="timeout", error=str(exc), evidence=evidence,
        )
    except RuntimeAdapterError as exc:
        result = CaseResult(execution_id, case.id, case.revision, attempt=attempt, status="error", error_category="runtime_failed", error=str(exc))
    except Exception as exc:
        result = CaseResult(execution_id, case.id, case.revision, attempt=attempt, status="error", error_category="runner_failed", error=str(exc))
    result.started_at = started_at
    result.completed_at = datetime.now(timezone.utc).isoformat()
    result.duration_seconds = time.monotonic() - started
    result.case_snapshot_sha256 = digest
    return result.to_dict()


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


if __name__ == "__main__":
    raise SystemExit(main())
