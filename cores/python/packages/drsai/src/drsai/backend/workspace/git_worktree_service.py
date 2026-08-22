"""Runtime-owned Git Worktree creation and reconciliation."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Mapping

from drsai.backend.runtime.registry import RuntimeRegistry, WorktreeRecord


_BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9._/-]{1,255}$")
_SAFE_SLUG = re.compile(r"[^a-z0-9]+")


class GitWorktreeError(RuntimeError):
    def __init__(self, code: str, message: str, *, retryable: bool = False, detail: Mapping[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.detail = dict(detail or {})


@dataclass(frozen=True)
class GitWorktreeEntry:
    path: str
    head: str | None
    branch: str | None
    prunable: bool


@dataclass(frozen=True)
class WorktreeReconcileReport:
    recovered: tuple[str, ...]
    missing: tuple[str, ...]
    orphaned_paths: tuple[str, ...]
    prunable_paths: tuple[str, ...]


class GitWorktreeService:
    """Execute Worktree lifecycle operations in the Workspace-owning Runtime."""

    def __init__(
        self,
        registry: RuntimeRegistry,
        worktree_root: Path,
        *,
        command_timeout_seconds: float = 30.0,
        minimum_free_bytes: int = 16 * 1024 * 1024,
        active_resource_probe: Callable[[str], list[dict[str, Any]]] | None = None,
        event_journal: Any | None = None,
        fault_injector: Callable[[str], None] | None = None,
    ):
        self.registry = registry
        self.worktree_root = worktree_root.expanduser().resolve(strict=False)
        self.command_timeout_seconds = command_timeout_seconds
        self.minimum_free_bytes = minimum_free_bytes
        self.active_resource_probe = active_resource_probe or (lambda _workspace_id: [])
        self.event_journal = event_journal
        self.fault_injector = fault_injector or (lambda _stage: None)
        self._lock = threading.RLock()

    def create(
        self,
        *,
        source_workspace_id: str,
        idempotency_key: str,
        intent: str,
        location: str = "local",
    ) -> WorktreeRecord:
        with self._lock:
            source = self.registry.get_workspace(source_workspace_id)
            if source is None:
                raise GitWorktreeError("workspace_not_found", "Source Workspace is not open.")
            repo_root = self._git_output(Path(source.path), ["rev-parse", "--show-toplevel"], "workspace_not_git")
            repo = Path(repo_root).resolve(strict=True)
            base_commit = self._git_output(repo, ["rev-parse", "HEAD"], "git_head_unavailable")
            status = self._git_output(repo, ["status", "--porcelain=v1"], "git_status_failed", allow_empty=True)
            slug = self._slug(intent)
            digest = hashlib.sha256(f"{source_workspace_id}\0{idempotency_key}".encode("utf-8")).hexdigest()[:10]
            branch = f"opendrsai/worktree/{slug}-{digest}"
            target = (self.worktree_root / f"{slug}-{digest}").resolve(strict=False)
            reserved = self.registry.reserve_worktree(
                source_workspace_id=source_workspace_id,
                idempotency_key=idempotency_key,
                repo_root=str(repo),
                canonical_path=str(target),
                branch=branch,
                base_commit=base_commit,
                location=location,
                source_dirty=bool(status),
                source_status_summary=self._summarize_status(status),
            )
            if reserved.workspace_id and reserved.status != "creating":
                self._emit("worktree.created", reserved)
                return reserved
            entries = self.list_git_worktrees(repo)
            existing = entries.get(str(target))
            if existing:
                self._assert_entry_matches(reserved, existing)
                bound = self.registry.bind_worktree_workspace(reserved.worktree_id)
                self._emit("worktree.created", bound)
                return bound
            self._preflight(repo, target, branch)
            target.parent.mkdir(parents=True, exist_ok=True)
            try:
                self._git(repo, ["worktree", "add", "-b", branch, str(target), base_commit])
            except GitWorktreeError as exc:
                # A response may be lost after Git commits the side effect. Re-read before failing.
                existing = self.list_git_worktrees(repo).get(str(target))
                if existing:
                    self._assert_entry_matches(reserved, existing)
                    bound = self.registry.bind_worktree_workspace(reserved.worktree_id)
                    self._emit("worktree.created", bound)
                    return bound
                self.registry.record_worktree_error(reserved.worktree_id, exc.code, str(exc))
                raise
            bound = self.registry.bind_worktree_workspace(reserved.worktree_id)
            self._emit("worktree.created", bound)
            return bound

    def reconcile(self, *, source_workspace_id: str | None = None) -> WorktreeReconcileReport:
        recovered: list[str] = []
        missing: list[str] = []
        orphaned: list[str] = []
        prunable: list[str] = []
        records = self.registry.list_worktrees(source_workspace_id=source_workspace_id, include_removed=True)
        by_repo: dict[str, list[WorktreeRecord]] = {}
        for record in records:
            by_repo.setdefault(record.repo_root, []).append(record)
        for repo_root, repo_records in by_repo.items():
            try:
                entries = self.list_git_worktrees(Path(repo_root))
            except GitWorktreeError as exc:
                for record in repo_records:
                    self.registry.record_worktree_error(record.worktree_id, exc.code, str(exc))
                    missing.append(record.worktree_id)
                continue
            registered_paths = {record.canonical_path for record in repo_records}
            for record in repo_records:
                entry = entries.get(record.canonical_path)
                if entry and entry.prunable:
                    prunable.append(entry.path)
                if record.status == "creating" and entry and not entry.prunable:
                    try:
                        self._assert_entry_matches(record, entry)
                        self.registry.bind_worktree_workspace(record.worktree_id)
                        recovered.append(record.worktree_id)
                    except (GitWorktreeError, OSError, ValueError) as exc:
                        self.registry.record_worktree_error(record.worktree_id, "worktree_reconcile_failed", str(exc))
                elif record.status not in {"creating", "removed"} and (entry is None or entry.prunable):
                    self.registry.record_worktree_error(
                        record.worktree_id, "worktree_missing", "Registered Worktree is missing from the Git Worktree list."
                    )
                    missing.append(record.worktree_id)
            managed_prefix = str(self.worktree_root)
            for entry in entries.values():
                if entry.path.startswith(managed_prefix) and entry.path not in registered_paths:
                    orphaned.append(entry.path)
        return WorktreeReconcileReport(
            tuple(sorted(set(recovered))), tuple(sorted(set(missing))),
            tuple(sorted(set(orphaned))), tuple(sorted(set(prunable))),
        )

    def describe(self, source_workspace_id: str, worktree_id: str) -> WorktreeRecord:
        record = self.registry.get_worktree(worktree_id)
        if record is None or record.source_workspace_id != source_workspace_id:
            raise GitWorktreeError("worktree_not_found", "Worktree does not belong to this Source Workspace.")
        return record

    def finalize_candidate_snapshot(
        self,
        source_workspace_id: str,
        worktree_id: str,
        *,
        experiment_id: str,
        run_id: str,
    ) -> dict[str, Any]:
        """Commit the isolated candidate state so Comparison/Adoption sees real Agent writes."""
        with self._lock:
            record = self.describe(source_workspace_id, worktree_id)
            if record.status not in {"active", "review", "merge_pending"}:
                raise GitWorktreeError("worktree_state_conflict", "Worktree is not available for candidate finalization.")
            worktree = Path(record.canonical_path)
            status = self._git_output(
                worktree, ["status", "--porcelain=v1", "--untracked-files=normal"],
                "candidate_snapshot_status_failed", allow_empty=True,
            )
            previous_head = self._git_output(worktree, ["rev-parse", "HEAD"], "git_head_unavailable")
            if not status:
                return {
                    "worktree_id": worktree_id,
                    "experiment_id": experiment_id,
                    "run_id": run_id,
                    "snapshot_created": False,
                    "candidate_head": previous_head,
                    "change_count": 0,
                }
            self._git(worktree, ["add", "-A"], code="candidate_snapshot_stage_failed")
            message = f"OpenDrSai experiment snapshot\n\nExperiment: {experiment_id}\nRun: {run_id}"
            self._git(worktree, [
                "-c", "user.name=OpenDrSai Runtime",
                "-c", "user.email=runtime@opendrsai.local",
                "commit", "-m", message,
            ], code="candidate_snapshot_commit_failed")
            candidate_head = self._git_output(worktree, ["rev-parse", "HEAD"], "git_head_unavailable")
            self._require_clean(worktree, "candidate_snapshot_not_clean")
            result = {
                "worktree_id": worktree_id,
                "experiment_id": experiment_id,
                "run_id": run_id,
                "snapshot_created": True,
                "previous_head": previous_head,
                "candidate_head": candidate_head,
                "change_count": len([line for line in status.splitlines() if line]),
                "status_digest": "sha256:" + hashlib.sha256(status.encode()).hexdigest(),
            }
            self._emit("worktree.candidate.snapshot", record)
            return result

    def adoption_preview(self, source_workspace_id: str, worktree_id: str) -> dict[str, Any]:
        """Describe an immutable merge/selective-adoption candidate without writing either tree."""
        with self._lock:
            record = self.describe(source_workspace_id, worktree_id)
            if record.status not in {"active", "review", "merge_pending"}:
                raise GitWorktreeError("worktree_state_conflict", "Worktree is not available for adoption review.")
            source = Path(record.repo_root)
            worktree = Path(record.canonical_path)
            source_head = self._git_output(source, ["rev-parse", "HEAD"], "git_head_unavailable")
            candidate_head = self._git_output(worktree, ["rev-parse", "HEAD"], "git_head_unavailable")
            source_status = self._git_output(source, ["status", "--porcelain=v1"], "git_status_failed", allow_empty=True)
            candidate_status = self._git_output(worktree, ["status", "--porcelain=v1"], "git_status_failed", allow_empty=True)
            raw = self._git_output(
                worktree, ["diff", "--name-status", "-z", f"{record.base_commit}..{candidate_head}"],
                "worktree_preview_failed", allow_empty=True,
            )
            changes = self._parse_name_status(raw)
            source_changed = set(filter(None, self._git_output(
                source, ["diff", "--name-only", f"{record.base_commit}..{source_head}"],
                "worktree_preview_failed", allow_empty=True,
            ).splitlines()))
            for change in changes:
                affected = {str(change.get("path") or ""), str(change.get("old_path") or ""), str(change.get("new_path") or "")}
                change["conflict_possible"] = bool(source_changed.intersection(affected))
            facts = {
                "source_workspace_id": source_workspace_id,
                "worktree_id": worktree_id,
                "base_commit": record.base_commit,
                "source_head": source_head,
                "candidate_head": candidate_head,
                "source_status_digest": hashlib.sha256(source_status.encode()).hexdigest(),
                "candidate_status_digest": hashlib.sha256(candidate_status.encode()).hexdigest(),
                "changes": changes,
            }
            digest = "sha256:" + hashlib.sha256(
                json.dumps(facts, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            return {
                **facts,
                "preview_digest": digest,
                "source_clean": not source_status,
                "candidate_clean": not candidate_status,
                "conflict_count": sum(bool(item["conflict_possible"]) for item in changes),
                "can_apply": not source_status and not candidate_status and bool(changes),
            }

    def adopt_selection(
        self,
        source_workspace_id: str,
        worktree_id: str,
        *,
        preview_digest: str,
        selected_paths: list[str],
        operation_id: str | None = None,
    ) -> WorktreeRecord:
        """Apply reviewed paths atomically enough for a clean Git source, then commit them."""
        with self._lock:
            if operation_id and not re.fullmatch(r"adoption-[0-9a-f-]{36}", operation_id):
                raise GitWorktreeError("adoption_operation_invalid", "Adoption operation identity is invalid.")
            record = self.describe(source_workspace_id, worktree_id)
            source = Path(record.repo_root)
            if operation_id and self._adoption_commit_present(source, operation_id):
                return self._complete_adoption_registry(record)
            preview = self.adoption_preview(source_workspace_id, worktree_id)
            if preview["preview_digest"] != preview_digest:
                if not operation_id or not self._recover_precommit_selection(
                    source, str(preview["candidate_head"]), selected_paths,
                ):
                    raise GitWorktreeError("adoption_preview_stale", "Workspace or experiment Worktree changed after preview.")
                self._commit_adoption(source, worktree_id, operation_id)
                self.fault_injector("after_commit")
                merged = self._complete_adoption_registry(record)
                self.fault_injector("after_registry_transition")
                return merged
            if not preview["can_apply"]:
                raise GitWorktreeError("adoption_not_applicable", "Adoption requires clean source and experiment Worktrees with changes.")
            available: set[str] = set()
            rename_groups: list[set[str]] = []
            for change in preview["changes"]:
                group = {str(change[key]) for key in ("path", "old_path", "new_path") if change.get(key)}
                available.update(group)
                if change["status"] == "renamed":
                    rename_groups.append(group)
            selected = set(selected_paths)
            if not selected or not selected <= available or any(group & selected and not group <= selected for group in rename_groups):
                raise GitWorktreeError("adoption_selection_invalid", "Selected paths are invalid or omit one side of a rename.")
            if any(
                change["conflict_possible"]
                and selected.intersection({str(change.get(key) or "") for key in ("path", "old_path", "new_path")})
                for change in preview["changes"]
            ):
                raise GitWorktreeError("adoption_conflict", "Selected paths changed in the source Workspace after the experiment base.")
            try:
                self._git(
                    source,
                    ["restore", "--source", str(preview["candidate_head"]), "--staged", "--worktree", "--", *sorted(selected)],
                    code="adoption_apply_failed",
                )
                self.fault_injector("after_restore")
                self._commit_adoption(source, worktree_id, operation_id)
                self.fault_injector("after_commit")
            except Exception:
                subprocess.run(
                    ["git", "restore", "--staged", "--worktree", "--", *sorted(selected)],
                    cwd=source, capture_output=True, text=True, check=False, timeout=self.command_timeout_seconds,
                )
                raise
            merged = self._complete_adoption_registry(record)
            self.fault_injector("after_registry_transition")
            return merged

    def _commit_adoption(self, source: Path, worktree_id: str, operation_id: str | None) -> None:
        message = f"Adopt OpenDrSai experiment {worktree_id}"
        if operation_id:
            message += f"\n\nOpenDrSai-Adoption: {operation_id}"
        self._git(source, ["commit", "-m", message], code="adoption_commit_failed")

    def _adoption_commit_present(self, source: Path, operation_id: str) -> bool:
        messages = self._git_output(
            source, ["log", "-50", "--format=%B"], "adoption_log_failed", allow_empty=True,
        )
        return f"OpenDrSai-Adoption: {operation_id}" in messages.splitlines()

    def _recover_precommit_selection(
        self, source: Path, candidate_head: str, selected_paths: list[str],
    ) -> bool:
        selected = set(selected_paths)
        changed: set[str] = set()
        for args in (
            ["diff", "--name-only", "-z", "HEAD"],
            ["diff", "--cached", "--name-only", "-z", "HEAD"],
            ["ls-files", "--others", "--exclude-standard", "-z"],
        ):
            raw = self._git_output(source, args, "adoption_recovery_status_failed", allow_empty=True)
            changed.update(path for path in raw.split("\x00") if path)
        if not changed or not changed <= selected:
            return False
        for path in selected:
            compared = subprocess.run(
                ["git", "diff", "--quiet", candidate_head, "--", path], cwd=source,
                capture_output=True, text=True, timeout=self.command_timeout_seconds,
            )
            if compared.returncode != 0:
                return False
        return True

    def _complete_adoption_registry(self, record: WorktreeRecord) -> WorktreeRecord:
        current = self.describe(record.source_workspace_id, record.worktree_id)
        if current.status == "merged":
            return current
        reviewed = current if current.status == "review" else self.registry.transition_worktree(current.worktree_id, "review")
        merged = self.registry.transition_worktree(reviewed.worktree_id, "merged", expected_status="review")
        self._emit("worktree.merged", merged)
        return merged

    def adopt(
        self,
        *,
        source_workspace_id: str,
        idempotency_key: str,
        canonical_path: str,
        branch: str,
        base_ref: str,
        location: str,
    ) -> WorktreeRecord:
        """Register a pre-Runtime Desktop Worktree without recreating it."""
        with self._lock:
            source = self.registry.get_workspace(source_workspace_id)
            if source is None:
                raise GitWorktreeError("workspace_not_found", "Source Workspace is not open.")
            repo = Path(self._git_output(Path(source.path), ["rev-parse", "--show-toplevel"], "workspace_not_git")).resolve(strict=True)
            target = Path(canonical_path).resolve(strict=True)
            existing_record = self.registry.get_worktree_by_path(str(target))
            if existing_record:
                if existing_record.source_workspace_id != source_workspace_id:
                    raise GitWorktreeError("worktree_adoption_conflict", "Existing Worktree belongs to another Source Workspace.")
                return existing_record
            entry = self.list_git_worktrees(repo).get(str(target))
            if entry is None or entry.prunable:
                raise GitWorktreeError("legacy_worktree_missing", "Legacy path is not an active Git Worktree.")
            if entry.branch != branch:
                raise GitWorktreeError("legacy_worktree_branch_mismatch", "Legacy Worktree branch differs from Thread metadata.")
            base_commit = self._git_output(repo, ["rev-parse", f"{base_ref}^{{commit}}"], "legacy_worktree_base_invalid")
            status = self._git_output(repo, ["status", "--porcelain=v1"], "git_status_failed", allow_empty=True)
            reserved = self.registry.reserve_worktree(
                source_workspace_id=source_workspace_id,
                idempotency_key=idempotency_key,
                repo_root=str(repo),
                canonical_path=str(target),
                branch=branch,
                base_commit=base_commit,
                location=location,
                source_dirty=bool(status),
                source_status_summary=self._summarize_status(status),
            )
            bound = self.registry.bind_worktree_workspace(reserved.worktree_id)
            self._emit("worktree.created", bound)
            return bound

    def list(self, source_workspace_id: str, *, include_removed: bool = False) -> list[WorktreeRecord]:
        if self.registry.get_workspace(source_workspace_id, include_closed=True) is None:
            raise GitWorktreeError("workspace_not_found", "Source Workspace does not exist.")
        return self.registry.list_worktrees(
            source_workspace_id=source_workspace_id, include_removed=include_removed
        )

    def merge(self, source_workspace_id: str, worktree_id: str, *, expected_head: str | None = None) -> WorktreeRecord:
        with self._lock:
            record = self.describe(source_workspace_id, worktree_id)
            if record.status == "merged":
                return record
            if record.status not in {"active", "review", "merge_pending"}:
                raise GitWorktreeError("worktree_state_conflict", f"Worktree cannot merge from {record.status}.")
            source = Path(record.repo_root)
            worktree = Path(record.canonical_path)
            self._require_clean(source, "source_worktree_dirty")
            self._require_clean(worktree, "derived_worktree_dirty")
            actual_head = self._git_output(worktree, ["rev-parse", "HEAD"], "git_head_unavailable")
            if expected_head is not None and actual_head != expected_head:
                raise GitWorktreeError("worktree_head_conflict", "Worktree HEAD changed before merge.")
            if record.status == "active":
                record = self.registry.transition_worktree(record.worktree_id, "review", expected_status="active")
            try:
                self._git(source, ["merge", "--no-ff", "--no-edit", record.branch], code="worktree_merge_failed")
            except GitWorktreeError as exc:
                unmerged = self._git_output(
                    source, ["diff", "--name-only", "--diff-filter=U"], "worktree_merge_failed", allow_empty=True
                )
                subprocess.run(
                    ["git", "merge", "--abort"], cwd=source, capture_output=True, text=True,
                    check=False, timeout=self.command_timeout_seconds,
                )
                if unmerged:
                    pending = self.registry.transition_worktree(record.worktree_id, "merge_pending")
                    conflicted = self.registry.record_worktree_error(
                        pending.worktree_id, "worktree_merge_conflict", f"Merge conflict: {unmerged[:2000]}"
                    )
                    self._emit("worktree.conflict", conflicted)
                    self._emit("worktree.status_changed", conflicted)
                    return conflicted
                self.registry.record_worktree_error(record.worktree_id, exc.code, str(exc))
                raise
            merged = self.registry.transition_worktree(record.worktree_id, "merged")
            self._emit("worktree.merged", merged)
            self._emit("worktree.status_changed", merged)
            return merged

    def archive(self, source_workspace_id: str, worktree_id: str) -> WorktreeRecord:
        with self._lock:
            record = self.describe(source_workspace_id, worktree_id)
            if record.status == "archived":
                return record
            if record.status not in {"active", "review", "merge_pending"}:
                raise GitWorktreeError("worktree_state_conflict", f"Worktree cannot archive from {record.status}.")
            self._require_clean(Path(record.canonical_path), "derived_worktree_dirty")
            suffix = record.worktree_id.removeprefix("worktree-")[:12]
            leaf = record.branch.rsplit("/", 1)[-1]
            archived_branch = f"opendrsai/archive/{leaf}-{suffix}"
            self._git(Path(record.repo_root), ["branch", "-m", record.branch, archived_branch], code="worktree_archive_failed")
            updated = self.registry.update_worktree_branch(record.worktree_id, archived_branch)
            archived = self.registry.transition_worktree(updated.worktree_id, "archived")
            self._emit("worktree.archived", archived)
            self._emit("worktree.status_changed", archived)
            return archived

    def remove(self, source_workspace_id: str, worktree_id: str, *, expected_status: str) -> WorktreeRecord:
        with self._lock:
            record = self.describe(source_workspace_id, worktree_id)
            if record.status == "removed":
                return record
            if expected_status not in {"merged", "archived"} or record.status != expected_status:
                raise GitWorktreeError("worktree_state_conflict", "Worktree removal status changed or is unsafe.")
            # Phase one: stop accepting new Session/Run/Terminal bindings before
            # observing active resources. A retry reopens nothing implicitly.
            if record.workspace_id:
                self.registry.close_workspace(record.workspace_id)
            active = self.active_resource_probe(record.workspace_id) if record.workspace_id else []
            if active:
                raise GitWorktreeError(
                    "worktree_active_resources",
                    "Worktree has active Session, Run, or Terminal resources.",
                    detail={"resources": active},
                )
            self._require_clean(Path(record.canonical_path), "derived_worktree_dirty")
            removing = self.registry.transition_worktree(record.worktree_id, "removing", expected_status=expected_status)
            try:
                self._git(Path(record.repo_root), ["worktree", "remove", record.canonical_path], code="worktree_remove_failed")
                if expected_status == "merged":
                    self._git(Path(record.repo_root), ["branch", "-d", record.branch], code="worktree_branch_delete_failed")
            except GitWorktreeError as exc:
                self.registry.record_worktree_error(removing.worktree_id, exc.code, str(exc))
                raise
            removed = self.registry.transition_worktree(removing.worktree_id, "removed")
            self._emit("worktree.removed", removed)
            self._emit("worktree.status_changed", removed)
            return removed

    def prune(self, source_workspace_id: str, *, dry_run: bool) -> tuple[list[str], bool]:
        records = self.list(source_workspace_id, include_removed=True)
        repositories = sorted({record.repo_root for record in records})
        candidates: list[str] = []
        for repo_root in repositories:
            entries = self.list_git_worktrees(Path(repo_root))
            candidates.extend(entry.path for entry in entries.values() if entry.prunable)
            if not dry_run and candidates:
                self._git(Path(repo_root), ["worktree", "prune"], code="git_worktree_prune_failed")
        return sorted(set(candidates)), not dry_run

    def list_git_worktrees(self, repo_root: Path) -> dict[str, GitWorktreeEntry]:
        output = self._git_output(repo_root, ["worktree", "list", "--porcelain"], "git_worktree_list_failed", allow_empty=True)
        result: dict[str, GitWorktreeEntry] = {}
        current: dict[str, str | bool] = {}
        for line in [*output.splitlines(), ""]:
            if not line:
                if "worktree" in current:
                    path = str(Path(str(current["worktree"])).resolve(strict=False))
                    branch = str(current["branch"]) if "branch" in current else None
                    if branch and branch.startswith("refs/heads/"):
                        branch = branch[len("refs/heads/"):]
                    result[path] = GitWorktreeEntry(
                        path=path,
                        head=str(current["HEAD"]) if "HEAD" in current else None,
                        branch=branch,
                        prunable=bool(current.get("prunable", False)),
                    )
                current = {}
                continue
            key, _, value = line.partition(" ")
            current[key] = value if value else True
        return result

    def project(self, record: WorktreeRecord) -> dict[str, Any]:
        result = GitWorktreeOWOPOperations.resource(record)
        activity = self.active_resource_probe(record.workspace_id) if record.workspace_id else []
        counts = {
            "sessions": sum(item.get("kind") == "session" for item in activity),
            "runs": sum(item.get("kind") == "run" for item in activity),
            "terminals": sum(item.get("kind") == "terminal" for item in activity),
        }
        result["activity"] = {**counts, "total": sum(counts.values())}
        path = Path(record.canonical_path)
        if record.status != "removed" and path.is_dir():
            try:
                result["head_commit"] = self._git_output(path, ["rev-parse", "HEAD"], "git_head_unavailable")
                result["dirty"] = bool(self._git_output(path, ["status", "--porcelain=v1"], "git_status_failed", allow_empty=True))
                divergence = self._git_output(
                    path, ["rev-list", "--left-right", "--count", f"{record.base_commit}...HEAD"],
                    "git_divergence_failed",
                ).split()
                result["behind"], result["ahead"] = int(divergence[0]), int(divergence[1])
            except (GitWorktreeError, IndexError, ValueError):
                # Identity and lifecycle state remain available while Git diagnostics recover.
                pass
        return result

    def _emit(self, event_type: str, record: WorktreeRecord) -> None:
        if self.event_journal is not None:
            self.event_journal.append(
                record.source_workspace_id,
                event_type,
                GitWorktreeOWOPOperations.resource(record),
                dedupe_key=f"{event_type}:{record.worktree_id}:{record.updated_at}",
            )

    def _preflight(self, repo: Path, target: Path, branch: str) -> None:
        if not _BRANCH_PATTERN.fullmatch(branch) or branch.startswith("-") or ".." in branch or branch.endswith("/"):
            raise GitWorktreeError("git_branch_invalid", "Generated Worktree branch is invalid.")
        if target == repo or repo in target.parents:
            raise GitWorktreeError("worktree_path_invalid", "Managed Worktree must be outside the Source repository.")
        if target.exists() and any(target.iterdir()):
            raise GitWorktreeError("worktree_path_exists", "Worktree target path is not empty.")
        disk_path = target.parent
        while not disk_path.exists() and disk_path != disk_path.parent:
            disk_path = disk_path.parent
        if shutil.disk_usage(disk_path).free < self.minimum_free_bytes:
            raise GitWorktreeError("worktree_disk_space_low", "Insufficient free space for Worktree creation.")
        branch_check = subprocess.run(
            ["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"],
            cwd=repo, capture_output=True, check=False, timeout=self.command_timeout_seconds,
        )
        if branch_check.returncode == 0:
            raise GitWorktreeError("worktree_branch_exists", "Worktree branch already exists.")
        if branch_check.returncode not in {0, 1}:
            raise GitWorktreeError("git_branch_check_failed", "Unable to check Worktree branch.")

    def _require_clean(self, path: Path, code: str) -> None:
        status = self._git_output(path, ["status", "--porcelain=v1"], "git_status_failed", allow_empty=True)
        if status:
            raise GitWorktreeError(code, self._summarize_status(status) or "Git Worktree is dirty.")

    def _git_output(self, cwd: Path, args: list[str], code: str, *, allow_empty: bool = False) -> str:
        completed = self._git(cwd, args, code=code)
        output = completed.stdout.strip()
        if not output and not allow_empty:
            raise GitWorktreeError(code, f"Git {' '.join(args[:2])} returned no output.")
        return output

    def _git(self, cwd: Path, args: list[str], code: str = "git_worktree_failed") -> subprocess.CompletedProcess[str]:
        try:
            completed = subprocess.run(
                ["git", *args], cwd=cwd, capture_output=True, text=True, check=False,
                timeout=self.command_timeout_seconds,
            )
        except subprocess.TimeoutExpired as exc:
            raise GitWorktreeError(code, "Git Worktree operation timed out.", retryable=True) from exc
        except OSError as exc:
            raise GitWorktreeError(code, "Git executable could not be started.") from exc
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "Git Worktree operation failed.").strip()
            raise GitWorktreeError(code, detail[:2000])
        return completed

    @staticmethod
    def _slug(intent: str) -> str:
        normalized = _SAFE_SLUG.sub("-", (intent or "task").strip().lower()).strip("-")
        return (normalized or "task")[:48].rstrip("-") or "task"

    @staticmethod
    def _summarize_status(status: str) -> str | None:
        lines = [line for line in status.splitlines() if line]
        if not lines:
            return None
        preview = "; ".join(lines[:10])
        return preview + (f"; +{len(lines) - 10} more" if len(lines) > 10 else "")

    @staticmethod
    def _parse_name_status(raw: str) -> list[dict[str, Any]]:
        tokens = raw.split("\x00") if raw else []
        result: list[dict[str, Any]] = []
        index = 0
        while index < len(tokens) and tokens[index]:
            status = tokens[index]
            index += 1
            if status.startswith("R") or status.startswith("C"):
                if index + 1 >= len(tokens):
                    break
                old_path, new_path = tokens[index], tokens[index + 1]
                index += 2
                result.append({"status": "renamed" if status.startswith("R") else "copied", "old_path": old_path, "new_path": new_path})
            else:
                if index >= len(tokens):
                    break
                path = tokens[index]
                index += 1
                result.append({
                    "status": {"A": "added", "M": "modified", "D": "deleted", "T": "type_changed"}.get(status[:1], "modified"),
                    "path": path,
                })
        return result

    @staticmethod
    def _assert_entry_matches(record: WorktreeRecord, entry: GitWorktreeEntry) -> None:
        if entry.branch != record.branch:
            raise GitWorktreeError("worktree_identity_conflict", "Git Worktree branch does not match its Registry identity.")
        if entry.prunable:
            raise GitWorktreeError("worktree_prunable", "Git Worktree entry is prunable and cannot be activated.")


class GitWorktreeOWOPOperations:
    """Strongly typed OWOP handler adapter for one Source Workspace."""

    def __init__(self, service: GitWorktreeService, source_workspace_id: str, journal: Any | None = None):
        self.service = service
        self.source_workspace_id = source_workspace_id
        self.journal = journal

    def handlers(self) -> dict[str, Any]:
        handlers = {
            "git.worktree.list": self.list,
            "git.worktree.create": self.create,
            "git.worktree.describe": self.describe,
            "git.worktree.merge": self.merge,
            "git.worktree.archive": self.archive,
            "git.worktree.remove": self.remove,
            "git.worktree.prune": self.prune,
        }
        return {name: self._wrap(handler) for name, handler in handlers.items()}

    def list(self, params: Mapping[str, Any]) -> dict[str, Any]:
        records = self.service.list(self.source_workspace_id, include_removed=bool(params.get("include_removed")))
        return {"worktrees": [self.service.project(record) for record in records]}

    def create(self, params: Mapping[str, Any]) -> dict[str, Any]:
        record = self.service.create(
            source_workspace_id=self.source_workspace_id,
            idempotency_key=str(params["idempotency_key"]),
            intent=str(params["intent"]),
        )
        self._event("worktree.created", record)
        return {"worktree": self.service.project(record)}

    def describe(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return {"worktree": self.service.project(self.service.describe(self.source_workspace_id, str(params["worktree_id"])))}

    def merge(self, params: Mapping[str, Any]) -> dict[str, Any]:
        record = self.service.merge(
            self.source_workspace_id, str(params["worktree_id"]),
            expected_head=str(params["expected_head"]) if params.get("expected_head") else None,
        )
        self._event("worktree.conflict" if record.status == "merge_pending" else "worktree.merged", record)
        self._event("worktree.status_changed", record)
        return {"worktree": self.service.project(record)}

    def archive(self, params: Mapping[str, Any]) -> dict[str, Any]:
        record = self.service.archive(self.source_workspace_id, str(params["worktree_id"]))
        self._event("worktree.archived", record)
        self._event("worktree.status_changed", record)
        return {"worktree": self.service.project(record)}

    def remove(self, params: Mapping[str, Any]) -> dict[str, Any]:
        record = self.service.remove(
            self.source_workspace_id, str(params["worktree_id"]), expected_status=str(params["expected_status"])
        )
        self._event("worktree.removed", record)
        self._event("worktree.status_changed", record)
        return {"worktree": self.service.project(record)}

    def prune(self, params: Mapping[str, Any]) -> dict[str, Any]:
        candidates, pruned = self.service.prune(self.source_workspace_id, dry_run=bool(params["dry_run"]))
        return {"candidates": candidates, "pruned": pruned}

    def _event(self, event_type: str, record: WorktreeRecord) -> None:
        if self.journal is not None:
            self.journal.append(
                self.source_workspace_id,
                event_type,
                self.service.project(record),
                dedupe_key=f"{event_type}:{record.worktree_id}:{record.updated_at}",
            )

    @staticmethod
    def _wrap(handler):
        def invoke(params: Mapping[str, Any]) -> dict[str, Any]:
            try:
                return handler(params)
            except GitWorktreeError as exc:
                from drsai.owop.protocol import OWOPError
                raise OWOPError(exc.code, str(exc), "operation", retryable=exc.retryable) from exc
        return invoke

    @staticmethod
    def resource(record: WorktreeRecord) -> dict[str, Any]:
        return {
            "worktree_id": record.worktree_id,
            "source_workspace_id": record.source_workspace_id,
            "workspace_id": record.workspace_id,
            "repo_root": record.repo_root,
            "canonical_path": record.canonical_path,
            "branch": record.branch,
            "base_commit": record.base_commit,
            "status": record.status,
            "location": record.location,
            "source_dirty": record.source_dirty,
            "source_status_summary": record.source_status_summary,
            "created_at": record.created_at,
            "updated_at": record.updated_at,
            "removed_at": record.removed_at,
            "last_error_code": record.last_error_code,
            "last_error_message": record.last_error_message,
        }
