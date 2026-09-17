"""Indexing a Knowledge Base is a job, not a request.

The original failure this suite exists for: the renderer asked the Gateway to
index a real folder, the Gateway did the whole build inside that one request,
and the client's 15s timeout fired long before the build finished.  The client
saw a timeout for work that actually succeeded, and a follow-up "list files"
arrived while nothing had been published yet and came back as a 400.  Both
symptoms came from one mistake -- treating a build as request-bound work.

What has to stay true, and is pinned here:

* starting an index returns promptly and names a job the caller can poll;
* a second start for the same Knowledge Base joins the running build instead of
  duplicating it, and a start for a *reconfigured* Knowledge Base replaces it;
* re-indexing an unchanged corpus reuses every document instead of re-reading it;
* a corpus that has not been published yet is an empty list, not an error, and a
  build in flight does not unpublish the index it is replacing;
* a file the size policy declines to read is reported as skipped, while a file
  that could not be read is reported as a failure that makes the corpus
  incomplete -- they are different facts and must not be merged;
* cancelling (or deleting the Knowledge Base) stops the build without touching
  the index that is already published.

The builds here run on temporary directories with a handful of tiny documents,
so they finish in milliseconds; the tests that need to observe a build *while*
it runs substitute a blocking stand-in for the builder rather than racing a real
one.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from drsai.config import IndexBuildCancelled
from drsai.backend.desktop_gateway import _index_jobs, _state
from drsai.backend.desktop_gateway.routes import config_knowledge

KNOWLEDGE_ID = "reference"
BASE_PATH = f"/v1/config/knowledge-bases/{KNOWLEDGE_ID}"
INDEX_PATH = f"{BASE_PATH}/index"
FILES_PATH = f"{BASE_PATH}/files"
REFRESH_PATH = f"{BASE_PATH}/refresh-if-stale"

#: The build a request is willing to wait for.  Long enough that a tiny corpus
#: finishes inside one request, short enough that a test that accidentally waits
#: for a build that never ends fails loudly instead of hanging the suite.
PATIENT_WAIT_MS = 20_000

#: A minimal well-formed build result, for the stand-in builder.
FAKE_RESULT: dict[str, object] = {
    "knowledge_id": KNOWLEDGE_ID,
    "status": "ready",
    "document_count": 0,
    "chunk_count": 0,
    "corpus_complete": True,
    "corpus_revision": "",
    "corpus_document_count": 0,
    "reused_document_count": 0,
    "parsed_document_count": 0,
    "skipped_document_count": 0,
    "failed_document_count": 0,
    "ignored_file_count": 0,
    "indexed_at": "2026-01-01T00:00:00Z",
}


class BlockingBuilder:
    """A stand-in for a build that runs until the test lets it finish.

    The first call blocks; later calls return immediately.  That is enough to
    observe a build while it is in flight, and it keeps the restart case
    (a build that is stopped and then replaced) from deadlocking on the same
    gate twice.
    """

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.entered = threading.Event()
        self.release = threading.Event()
        self._lock = threading.Lock()

    def __call__(self, config_dir, resource, *, reuse_unchanged=True, progress=None, should_stop=None):
        with self._lock:
            position = len(self.calls)
            self.calls.append(str((resource.config or {}).get("root_path")))
        if progress is not None:
            progress({"phase": "indexing", "done": 0, "total": 1, "current": "guide.md"})
        self.entered.set()
        if position == 0:
            assert self.release.wait(timeout=30), "the test never released the stand-in build"
        # Exactly the contract a real build offers: the stop condition is polled
        # per document and honoured by raising.
        if should_stop is not None and should_stop():
            raise IndexBuildCancelled("stand-in build was cancelled")
        return dict(FAKE_RESULT)


# --------------------------------------------------------------------------- #
# harness
# --------------------------------------------------------------------------- #


@pytest.fixture()
def state_root(tmp_path, monkeypatch):
    """A private state root, so no test reads or writes the real ``~/.drsai``."""
    monkeypatch.setenv("DRSAI_HOME", str(tmp_path / "home"))
    _state.reset_state()
    try:
        yield tmp_path
    finally:
        _state.reset_state()


@pytest.fixture()
def config_dir(tmp_path, state_root, monkeypatch):
    """A private config directory for the knowledge routes.

    The real resolver walks ``WORKDIR``, which is fixed at import time from
    ``DRSAI_HOME``; overriding it here is what keeps these tests from writing a
    Knowledge Base into the developer's own workspace.
    """
    directory = tmp_path / "configs"
    monkeypatch.setattr(config_knowledge, "_get_config_dir", lambda user_id=None: directory)
    return directory


@pytest.fixture()
def corpus(tmp_path):
    """A small but real corpus: two documents, one of each text format."""
    root = tmp_path / "corpus"
    root.mkdir()
    (root / "guide.md").write_text("# Guide\n\nHow the Runtime starts.\n", encoding="utf-8")
    (root / "notes.txt").write_text("A note about ports.\nAnd a second line.\n", encoding="utf-8")
    (root / "cover.png").write_bytes(b"\x89PNG\r\n\x1a\n")  # not a corpus member
    return root


@pytest.fixture()
def client(config_dir):
    app = FastAPI()
    app.include_router(config_knowledge.router())
    return TestClient(app)


def create_knowledge_base(client: TestClient, root: Path, **config: object) -> dict:
    response = client.post(
        "/v1/config/knowledge-bases",
        json={
            "knowledge_id": KNOWLEDGE_ID,
            "display_name": "Reference",
            "type": "local-files",
            "enabled": True,
            "config": {"root_path": str(root), **config},
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def wait_for_terminal(client: TestClient, timeout: float = 30.0) -> dict:
    """Poll the Knowledge Base's status until its build is no longer running.

    Polling with ``GET`` and never with another ``POST`` is deliberate: the
    status read can observe a build, while a repeated start would be the thing
    this suite is proving callers no longer need to do.
    """
    deadline = time.monotonic() + timeout
    while True:
        payload = client.get(BASE_PATH).json()
        if not payload.get("in_progress"):
            return payload
        assert time.monotonic() < deadline, f"build never finished: {payload}"
        time.sleep(0.02)


def index_and_wait(client: TestClient, **body: object) -> dict:
    """Start a build and hold the request open until it publishes."""
    response = client.post(INDEX_PATH, json={"wait_ms": PATIENT_WAIT_MS, **body})
    assert response.status_code == 200, response.text
    return response.json()


# --------------------------------------------------------------------------- #
# the request is a start, not the whole build
# --------------------------------------------------------------------------- #


def test_index_publishes_inside_the_request_when_the_corpus_is_small(client, corpus):
    create_knowledge_base(client, corpus)

    payload = index_and_wait(client)

    assert payload["job_state"] == "succeeded"
    assert payload["in_progress"] is False
    assert payload["status"] == "ready"
    assert payload["document_count"] == 2
    assert payload["chunk_count"] >= 2
    assert payload["corpus_complete"] is True
    assert payload["skipped_document_count"] == 0
    assert payload["failed_document_count"] == 0
    # The ignored file is counted, not silently dropped: "2 of 2 documents read"
    # would otherwise hide that something in the folder was never considered.
    assert payload["ignored_file_count"] == 1
    assert payload["job_id"]
    assert payload["index_progress"]["phase"] == "completed"


def test_a_long_build_answers_immediately_and_is_observable(client, corpus, monkeypatch):
    """The request that used to time out now returns a running job."""
    create_knowledge_base(client, corpus)
    index_and_wait(client)  # so there is a published index to compare against
    builder = BlockingBuilder()
    monkeypatch.setattr(_index_jobs, "index_local_files", builder)

    started = client.post(INDEX_PATH).json()

    assert builder.entered.wait(timeout=30)
    assert started["job_state"] == "running"
    assert started["in_progress"] is True
    assert started["terminal"] is False

    # A build in flight does not unpublish what is already searchable, so the
    # Knowledge Base reports both facts rather than pretending to be unindexed.
    observed = client.get(BASE_PATH).json()
    assert observed["status"] == "indexing"
    assert observed["previous_status"] == "ready"
    assert observed["document_count"] == 2
    assert observed["index_progress"]["phase"] == "indexing"

    builder.release.set()
    finished = wait_for_terminal(client)
    assert finished["status"] == "ready"
    assert finished["job_state"] == "succeeded"


def test_a_second_start_joins_the_running_build(client, corpus, monkeypatch):
    create_knowledge_base(client, corpus)
    builder = BlockingBuilder()
    monkeypatch.setattr(_index_jobs, "index_local_files", builder)

    first = client.post(INDEX_PATH).json()
    assert builder.entered.wait(timeout=30)
    second = client.post(INDEX_PATH).json()

    assert second["job_id"] == first["job_id"]
    assert second["job_state"] == "running"

    builder.release.set()
    wait_for_terminal(client)
    # One build, not two: rebuilding the same corpus would write the same index
    # file twice over and waste the whole walk.
    assert len(builder.calls) == 1


def test_a_reconfigured_knowledge_base_replaces_the_running_build(client, corpus, tmp_path, monkeypatch):
    """A build for the old folder must not publish once the KB points elsewhere."""
    other = tmp_path / "other"
    other.mkdir()
    (other / "replacement.md").write_text("# Replacement\n\nNew material.\n", encoding="utf-8")
    create_knowledge_base(client, corpus)
    builder = BlockingBuilder()
    monkeypatch.setattr(_index_jobs, "index_local_files", builder)

    first = client.post(INDEX_PATH).json()
    assert builder.entered.wait(timeout=30)

    updated = client.put(BASE_PATH, json={
        "knowledge_id": KNOWLEDGE_ID, "display_name": "Reference", "type": "local-files",
        "enabled": True, "config": {"root_path": str(other)},
    })
    assert updated.status_code == 200, updated.text
    restarted = client.post(INDEX_PATH).json()

    assert restarted["job_id"] == first["job_id"]
    assert restarted["index_progress"]["restarting"] is True

    builder.release.set()
    wait_for_terminal(client)
    assert builder.calls == [str(corpus.resolve()), str(other.resolve())]


def test_a_missing_folder_is_refused_without_starting_a_job(client, tmp_path):
    create_knowledge_base(client, tmp_path / "gone")

    response = client.post(INDEX_PATH, json={"wait_ms": PATIENT_WAIT_MS})

    assert response.status_code == 400
    assert "root_path" in str(response.json()["detail"])
    # Refused at the boundary: nothing was queued that the caller would have to
    # poll to discover the folder is gone.
    assert _state.index_jobs().state(KNOWLEDGE_ID) is None


# --------------------------------------------------------------------------- #
# what the corpus contains
# --------------------------------------------------------------------------- #


def test_files_answers_before_the_first_index_without_an_error(client, corpus):
    create_knowledge_base(client, corpus)

    response = client.get(FILES_PATH)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "knowledge_id": KNOWLEDGE_ID, "data": [], "indexed": False, "status": "not_indexed",
    }


def test_files_lists_documents_once_the_build_publishes(client, corpus):
    create_knowledge_base(client, corpus)
    index_and_wait(client)

    payload = client.get(FILES_PATH).json()

    assert payload["indexed"] is True
    assert [row["source"] for row in payload["data"]] == ["guide.md", "notes.txt"]
    assert all(row["status"] == "ok" for row in payload["data"])


def test_a_document_over_the_size_policy_is_skipped_not_failed(client, corpus):
    (corpus / "huge.txt").write_text("x" * (1024 * 1024 + 64), encoding="utf-8")
    create_knowledge_base(client, corpus, max_document_bytes=1024 * 1024)

    payload = index_and_wait(client)

    assert payload["skipped_document_count"] == 1
    assert payload["failed_document_count"] == 0
    assert payload["document_count"] == 2
    # Declining to read a file by policy is not the same as failing to read it:
    # the corpus is still fully known, so a refusal to answer stays meaningful.
    assert payload["corpus_complete"] is True

    rows = {row["source"]: row for row in client.get(FILES_PATH).json()["data"]}
    assert rows["huge.txt"]["status"] == "skipped"
    assert rows["huge.txt"]["reason"] == "file_too_large"
    assert rows["huge.txt"]["chunk_count"] == 0


def test_an_unreadable_document_makes_the_corpus_incomplete(client, corpus):
    (corpus / "broken.pdf").write_bytes(b"this is not a pdf at all")
    create_knowledge_base(client, corpus)

    payload = index_and_wait(client)

    assert payload["failed_document_count"] == 1
    assert payload["document_count"] == 2
    # The build still publishes -- two documents were readable -- but the corpus
    # is no longer fully known, which is what makes an empty search result
    # answerable as "not in the material".
    assert payload["status"] == "ready"
    assert payload["corpus_complete"] is False

    rows = {row["source"]: row for row in client.get(FILES_PATH).json()["data"]}
    assert rows["broken.pdf"]["status"] == "failed"
    assert rows["broken.pdf"]["reason"]


# --------------------------------------------------------------------------- #
# incremental builds
# --------------------------------------------------------------------------- #


def test_reindexing_an_unchanged_corpus_reuses_every_document(client, corpus):
    create_knowledge_base(client, corpus)
    first = index_and_wait(client)

    second = index_and_wait(client)

    assert second["document_count"] == first["document_count"]
    assert second["chunk_count"] == first["chunk_count"]
    assert second["reused_document_count"] == 2
    assert second["parsed_document_count"] == 0
    assert second["corpus_revision"] == first["corpus_revision"]


def test_only_the_changed_document_is_read_again(client, corpus):
    create_knowledge_base(client, corpus)
    first = index_and_wait(client)

    (corpus / "notes.txt").write_text("A note about ports, revised.\n", encoding="utf-8")
    second = index_and_wait(client)

    assert second["reused_document_count"] == 1
    assert second["parsed_document_count"] == 1
    assert second["document_count"] == 2
    assert second["corpus_revision"] != first["corpus_revision"]


def test_a_removed_document_leaves_the_index(client, corpus):
    create_knowledge_base(client, corpus)
    index_and_wait(client)

    (corpus / "notes.txt").unlink()
    payload = index_and_wait(client)

    assert payload["document_count"] == 1
    assert [row["source"] for row in client.get(FILES_PATH).json()["data"]] == ["guide.md"]


def test_refresh_starts_a_build_only_when_the_corpus_changed(client, corpus):
    create_knowledge_base(client, corpus)
    index_and_wait(client)

    unchanged = client.post(REFRESH_PATH, json={"wait_ms": PATIENT_WAIT_MS}).json()
    assert unchanged["stale"] is False
    assert unchanged["status"] == "unchanged"

    (corpus / "added.md").write_text("# Added\n\nA new document.\n", encoding="utf-8")
    changed = client.post(REFRESH_PATH, json={"wait_ms": PATIENT_WAIT_MS}).json()

    assert changed["stale"] is True
    assert changed["job_state"] == "succeeded"
    assert changed["document_count"] == 3


# --------------------------------------------------------------------------- #
# stopping a build
# --------------------------------------------------------------------------- #


def test_cancelling_a_build_keeps_the_published_index(client, corpus, monkeypatch):
    create_knowledge_base(client, corpus)
    index_and_wait(client)
    builder = BlockingBuilder()
    monkeypatch.setattr(_index_jobs, "index_local_files", builder)

    client.post(INDEX_PATH)
    assert builder.entered.wait(timeout=30)
    assert _state.index_jobs().cancel(KNOWLEDGE_ID) is True
    builder.release.set()
    wait_for_terminal(client)

    state = _state.index_jobs().state(KNOWLEDGE_ID)
    assert state is not None and state["job_state"] == "cancelled"
    assert "result" not in state
    # A cancelled build publishes nothing, so the corpus that was already
    # searchable is still exactly that.
    payload = client.get(FILES_PATH).json()
    assert payload["indexed"] is True
    assert len(payload["data"]) == 2


def test_deleting_a_knowledge_base_stops_its_build(client, corpus, monkeypatch):
    create_knowledge_base(client, corpus)
    builder = BlockingBuilder()
    monkeypatch.setattr(_index_jobs, "index_local_files", builder)

    client.post(INDEX_PATH)
    assert builder.entered.wait(timeout=30)

    assert client.delete(BASE_PATH).status_code == 200
    assert _state.index_jobs().state(KNOWLEDGE_ID)["cancel_requested"] is True

    builder.release.set()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        state = _state.index_jobs().state(KNOWLEDGE_ID)
        if state is None or state["job_state"] != "running":
            break
        time.sleep(0.02)
    assert state is not None and state["job_state"] == "cancelled"
