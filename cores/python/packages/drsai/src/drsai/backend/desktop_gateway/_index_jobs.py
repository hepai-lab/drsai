"""Process-owned background execution for Knowledge Base index builds.

An index build is not a request.  Walking a real folder, parsing documents, and
chunking them can take minutes, which is far longer than any HTTP client will
hold a connection open, so the build is owned by the process and addressed by
the Knowledge Base it belongs to: a route starts it and returns immediately, and
the caller polls until the job reaches a terminal state.

One build per Knowledge Base is deliberate.  Two builds of the same corpus would
write the same index file, so the second would either duplicate the first's
whole cost or silently discard its work.  A start request that arrives while a
build is already running joins that build instead.

The one case that cannot be joined is a build whose Knowledge Base was
reconfigured underneath it: publishing that build would leave an index for a
folder the Knowledge Base no longer points at.  Such a request asks the running
build to stop *and* records what to build instead, so the job restarts itself
against the current configuration.  That keeps the contract the caller sees
simple and true: after the route returns, the job it names ends up holding an
index of what the Knowledge Base points at now.
"""

from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path

from drsai.config import IndexBuildCancelled, KnowledgeResource, index_local_files

# Terminal jobs are kept so a client that polls right after a build still sees
# its outcome.  Only the most recent handful are retained; a Knowledge Base that
# is being rebuilt in a loop must not grow this process's memory.
_RETAINED_JOBS = 32

# How long ``wait`` sleeps between state checks.  Short enough that a finished
# build is reported promptly, long enough not to spin.
_POLL_SECONDS = 0.05

JOB_RUNNING = "running"
JOB_SUCCEEDED = "succeeded"
JOB_FAILED = "failed"
JOB_CANCELLED = "cancelled"

TERMINAL_STATES = (JOB_SUCCEEDED, JOB_FAILED, JOB_CANCELLED)


@dataclass(frozen=True)
class _BuildTarget:
    """What a build is asked to produce."""

    resource: KnowledgeResource
    reuse_unchanged: bool


@dataclass
class _IndexJob:
    """One background index build and everything a poller may ask about it."""

    knowledge_id: str
    config_dir: Path
    target: _BuildTarget
    job_id: str = field(default_factory=lambda: uuid.uuid4().hex)
    state: str = JOB_RUNNING
    phase: str = "queued"
    done: int = 0
    total: int = 0
    current: str = ""
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    result: dict[str, object] | None = None
    error: dict[str, str] | None = None
    # Signalled to ask the build to stop; polled once per document.
    cancel: threading.Event = field(default_factory=threading.Event)
    # Set when a request asks for a *different* build than the running one.  The
    # worker picks it up after the current build stops and starts over.
    pending: _BuildTarget | None = None
    # True while the worker is holding a build that is not the one the latest
    # request asked for, so a poller can say "reconfiguring" rather than lie
    # about progress it is about to throw away.
    restarting: bool = False
    thread: threading.Thread | None = None


class KnowledgeIndexJobManager:
    """Runs Knowledge Base index builds in the background, one per Knowledge Base."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._jobs: dict[str, _IndexJob] = {}

    # -- lifecycle ---------------------------------------------------------

    def start(
        self,
        config_dir: str | Path,
        resource: KnowledgeResource,
        *,
        reuse_unchanged: bool = True,
    ) -> dict[str, object]:
        """Start a build, or join the one already running for this Knowledge Base.

        Returns the job snapshot as it stands right now; a caller that needs the
        finished build calls :meth:`wait`.
        """

        target = _BuildTarget(resource, reuse_unchanged)
        key = resource.knowledge_id
        with self._lock:
            existing = self._jobs.get(key)
            if existing is not None and existing.state == JOB_RUNNING:
                if existing.target == target and existing.pending is None:
                    return _snapshot(existing)
                # The Knowledge Base now asks for a different build.  Let the
                # current one stop instead of publishing a stale index, and
                # remember what should be built once it has.
                existing.pending = target
                existing.restarting = True
                existing.cancel.set()
                return _snapshot(existing)
            job = _IndexJob(key, Path(config_dir), target)
            self._jobs[key] = job
            self._trim_locked()
            job.thread = threading.Thread(
                target=self._run, args=(job,), name=f"kb-index-{key}", daemon=True,
            )
            job.thread.start()
            return _snapshot(job)

    def state(self, knowledge_id: str) -> dict[str, object] | None:
        """Return the current snapshot of a Knowledge Base's build, if any."""
        with self._lock:
            job = self._jobs.get(knowledge_id)
            return _snapshot(job) if job is not None else None

    def wait(self, knowledge_id: str, timeout: float) -> dict[str, object] | None:
        """Block until the job for this Knowledge Base finishes, or ``timeout``.

        A timeout is not an error: the caller gets the job's current state and
        decides whether to keep waiting, which is what makes this a poll rather
        than a promise.  A job that is restarting keeps running, so a caller
        waiting here is not handed a build that is about to be discarded.
        """

        deadline = time.monotonic() + max(0.0, timeout)
        while True:
            with self._lock:
                job = self._jobs.get(knowledge_id)
                if job is None:
                    return None
                if job.state in TERMINAL_STATES:
                    return _snapshot(job)
            if time.monotonic() >= deadline:
                return self.state(knowledge_id)
            time.sleep(_POLL_SECONDS)

    def cancel(self, knowledge_id: str) -> bool:
        """Ask a running build to stop.  Returns whether one was asked."""
        with self._lock:
            job = self._jobs.get(knowledge_id)
            if job is None or job.state in TERMINAL_STATES:
                return False
            # A queued restart would outlive the cancellation, so an explicit
            # cancel drops it: the caller said stop, not "stop and start over".
            job.pending = None
            job.cancel.set()
            return True

    def shutdown(self, timeout: float = 30.0) -> None:
        """Stop every running build and drop all records.

        Tests call this through ``_state.reset_state`` so a build thread never
        outlives the state root it was writing into.  The default timeout is
        generous because the worker only checks for cancellation between
        documents: a build stopped inside a large parse still has to finish it.
        """

        with self._lock:
            jobs = list(self._jobs.values())
            self._jobs.clear()
            # Dropped before the cancel so a job that is already stopping does
            # not immediately start building the restart it was waiting for.
            for job in jobs:
                job.pending = None
                job.cancel.set()
        deadline = time.monotonic() + max(0.0, timeout)
        for job in jobs:
            thread = job.thread
            if thread is not None and thread.is_alive():
                thread.join(max(0.0, deadline - time.monotonic()))

    # -- worker ------------------------------------------------------------

    def _run(self, job: _IndexJob) -> None:
        while True:
            try:
                result = index_local_files(
                    job.config_dir,
                    job.target.resource,
                    reuse_unchanged=job.target.reuse_unchanged,
                    progress=lambda payload: self._on_progress(job, payload),
                    should_stop=job.cancel.is_set,
                )
            except IndexBuildCancelled:
                if not self._adopt_pending(job):
                    self._finish(job, state=JOB_CANCELLED)
                    return
                continue
            except Exception as exc:  # noqa: BLE001 - a background build has no other reporter
                self._finish(job, state=JOB_FAILED, error={
                    "code": "index_failed",
                    "message": str(exc) or exc.__class__.__name__,
                    "type": exc.__class__.__name__,
                })
                return
            self._finish(job, state=JOB_SUCCEEDED, result=result)
            return

    def _adopt_pending(self, job: _IndexJob) -> bool:
        """Switch a stopped job to the build that was requested meanwhile.

        Returning ``False`` means nothing was waiting, so the job really is over.
        The job id changes because the build does: a caller holding the old one
        is holding the result of a build that never published.
        """

        with self._lock:
            pending = job.pending
            if pending is None:
                return False
            job.pending = None
            job.target = pending
            job.job_id = uuid.uuid4().hex
            job.phase = "queued"
            job.done = 0
            job.total = 0
            job.current = ""
            job.restarting = False
            job.started_at = time.time()
            # A fresh stop signal: the old one fired to end the previous build.
            job.cancel = threading.Event()
            return True

    def _on_progress(self, job: _IndexJob, payload: dict[str, object]) -> None:
        with self._lock:
            job.phase = str(payload.get("phase") or job.phase)
            job.done = int(payload.get("done") or 0)
            job.total = int(payload.get("total") or 0)
            job.current = str(payload.get("current") or "")

    def _finish(
        self,
        job: _IndexJob,
        *,
        state: str,
        result: dict[str, object] | None = None,
        error: dict[str, str] | None = None,
    ) -> None:
        with self._lock:
            job.state = state
            job.finished_at = time.time()
            job.result = result
            job.error = error
            job.pending = None
            job.restarting = False
            if state == JOB_CANCELLED:
                job.phase = "cancelled"
            elif state == JOB_FAILED:
                job.phase = "failed"

    def _trim_locked(self) -> None:
        """Drop the oldest finished jobs once too many are retained."""
        if len(self._jobs) <= _RETAINED_JOBS:
            return
        finished = sorted(
            (job for job in self._jobs.values() if job.state in TERMINAL_STATES),
            key=lambda job: job.finished_at or job.started_at,
        )
        for job in finished[: max(0, len(self._jobs) - _RETAINED_JOBS)]:
            self._jobs.pop(job.knowledge_id, None)


def _snapshot(job: _IndexJob) -> dict[str, object]:
    payload: dict[str, object] = {
        "knowledge_id": job.knowledge_id,
        "job_id": job.job_id,
        "job_state": job.state,
        "phase": job.phase,
        "done": job.done,
        "total": job.total,
        "current": job.current,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
        "terminal": job.state in TERMINAL_STATES,
        "cancel_requested": job.cancel.is_set(),
        "restarting": job.restarting,
    }
    if job.result is not None:
        payload["result"] = dict(job.result)
    if job.error is not None:
        payload["error"] = dict(job.error)
    return payload
