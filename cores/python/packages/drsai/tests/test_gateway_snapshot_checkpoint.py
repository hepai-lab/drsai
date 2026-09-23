"""Offline regression coverage for full P2 checkpoint streaming and page reuse."""
import asyncio
import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from drsai.backend.desktop_gateway import _oaep
from drsai.backend.desktop_gateway.routes import sessions
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.oaep.digest import oaep_items_digest
from drsai.oaep.resource_associations import migrate_p1_snapshot, P1_READER_ENV


class SnapshotCheckpointTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.engine = RuntimeEngine(Path(self.directory.name) / "runtime.db", RuntimeEngineIdentity("r", "i"), lambda _: True)
        self.addCleanup(self.engine.close)
        self.sid = self.engine.create_session("ws", "test")["session_id"]
        self.rid = self.engine.create_run(self.sid, "opendrsai@1", "key", "opendrsai")[0]["run_id"]
        self.journal = self.engine.conversation_journal
        with _oaep._checkpoint_cache_lock:
            _oaep._checkpoint_cache.clear()
        self.authority = patch.object(_oaep, "_authority_id", return_value="authority-a").start()
        self.addCleanup(patch.stopall)
        patch.dict("os.environ", {P1_READER_ENV: "1"}).start()
        for i in range(7):
            self.record(i)

    def record(self, i, revision=1):
        self.engine.record_conversation_item(
            self.sid, item_id=f"item-{i}", kind="message", role="assistant",
            revision=revision, source_client="runtime", run_id=self.rid,
            payload={"text": f"中文 {i} revision {revision}"},
        )

    def page(self, cursor=None, limit=2):
        with patch.object(sessions._state, "runtime_engine", return_value=self.engine):
            return asyncio.run(sessions.session_oaep_snapshot(self.sid, cursor=cursor, limit=limit))

    def expected(self, snapshot):
        items = self.journal.oaep_items(self.sid, through_sequence=snapshot["snapshot_sequence"])
        return oaep_items_digest(migrate_p1_snapshot(
            {"session": snapshot["session"], "items": items}, authority_id=self.authority.return_value,
        )["items"])

    def test_pages_share_full_digest_and_only_one_stream(self):
        with patch.object(self.journal, "iter_oaep_items", wraps=self.journal.iter_oaep_items) as stream, \
             patch.object(self.journal, "oaep_items", side_effect=AssertionError("full list read")), \
             patch.object(self.journal, "oaep_checkpoint", wraps=self.journal.oaep_checkpoint) as raw:
            page = self.page()
            first = page
            seen = list(page["items"])
            while page["window"]["has_more"]:
                page = self.page(page["window"]["next_cursor"])
                self.assertEqual(page["checkpoint"], first["checkpoint"])
                seen.extend(page["items"])
            self.assertEqual(stream.call_count, 1)
            self.assertEqual(raw.call_count, 1)
        self.assertEqual(len(seen), first["checkpoint"]["item_count"])
        self.assertEqual(oaep_items_digest(seen), first["checkpoint"]["snapshot_hash"])
        self.assertEqual(self.expected(first), first["checkpoint"]["snapshot_hash"])
        self.assertNotEqual(oaep_items_digest(first["items"]), first["checkpoint"]["snapshot_hash"])

    def test_update_invalidates_and_old_cursor_is_not_masked(self):
        with patch.object(self.journal, "iter_oaep_items", wraps=self.journal.iter_oaep_items) as stream:
            first = self.page()
            self.record(0, revision=2)
            with self.assertRaisesRegex(RuntimeError, "checkpoint Item count changed"):
                self.page(first["window"]["next_cursor"])
            updated = self.page()
            self.assertEqual(stream.call_count, 3)
        self.assertGreater(updated["snapshot_sequence"], first["snapshot_sequence"])
        self.assertNotEqual(updated["checkpoint"]["snapshot_hash"], first["checkpoint"]["snapshot_hash"])
        self.assertEqual(self.expected(updated), updated["checkpoint"]["snapshot_hash"])

    def test_authority_isolation(self):
        with patch.object(self.journal, "iter_oaep_items", wraps=self.journal.iter_oaep_items) as stream:
            first = self.page()
            self.authority.return_value = "authority-b"
            second = self.page(first["window"]["next_cursor"])
            self.assertEqual(stream.call_count, 2)
            self.page(second["window"]["next_cursor"])
            self.assertEqual(stream.call_count, 2)
        self.assertEqual(self.expected(second), second["checkpoint"]["snapshot_hash"])
        # Authority need not change digest (top-level associations are excluded).
        self.assertEqual({k[2] for k in _oaep._checkpoint_cache}, {"authority-a", "authority-b"})

    def test_checkpoint_validation_on_warm_cache(self):
        self.page()
        snapshot = self.engine.oaep_snapshot(self.sid, limit=2)
        for field, value, error in (("item_count", 999, "count"), ("snapshot_hash", "bad", "hash"), ("sequence", -1, "waterline")):
            broken = copy.deepcopy(snapshot)
            broken["checkpoint"][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, error):
                _oaep.migrate_snapshot(broken, journal=self.journal)

    def test_complete_page_avoids_stream(self):
        with patch.object(self.journal, "iter_oaep_items", side_effect=AssertionError("unexpected scan")):
            page = self.page(limit=100)
        self.assertFalse(page["window"]["has_more"])
        self.assertEqual(oaep_items_digest(page["items"]), page["checkpoint"]["snapshot_hash"])

    def test_bounded_cache_and_reader_policy_key(self):
        with patch.object(_oaep, "_CHECKPOINT_CACHE_LIMIT", 2), \
             patch.object(self.journal, "iter_oaep_items", wraps=self.journal.iter_oaep_items) as stream:
            self.page()
            with patch.dict("os.environ", {P1_READER_ENV: "0"}):
                self.page()
            self.authority.return_value = "authority-c"
            self.page()
            self.assertEqual(stream.call_count, 3)
            self.assertEqual(len(_oaep._checkpoint_cache), 2)
            for count, digest in _oaep._checkpoint_cache.values():
                self.assertIsInstance(count, int)
                self.assertEqual(len(digest), 64)

    def test_append_preserves_old_cursor_but_revalidates(self):
        with patch.object(self.journal, "iter_oaep_items", wraps=self.journal.iter_oaep_items) as stream:
            first = self.page()
            self.record(8)
            old_page = self.page(first["window"]["next_cursor"])
            self.assertEqual(old_page["checkpoint"], first["checkpoint"])
            self.assertEqual(stream.call_count, 2)
        self.assertEqual(self.expected(old_page), old_page["checkpoint"]["snapshot_hash"])

    def test_journal_identity_isolation(self):
        self.page()
        # Another journal object must revalidate even when it opens the same DB.
        from drsai.backend.runtime.journal import RuntimeConversationJournal
        other = RuntimeConversationJournal(self.journal.database, "r")
        snapshot = self.engine.oaep_snapshot(self.sid, limit=2)
        with patch.object(other, "iter_oaep_items", wraps=other.iter_oaep_items) as stream:
            result = _oaep.migrate_snapshot(snapshot, journal=other)
            self.assertEqual(stream.call_count, 1)
        self.assertEqual(self.expected(result), result["checkpoint"]["snapshot_hash"])

    def test_empty_stream_and_already_migrated_items(self):
        session = {"id": self.sid}
        count, raw, projected = _oaep._stream_checkpoint(iter([]), session=session, authority_id="a")
        self.assertEqual((count, raw, projected), (0, oaep_items_digest([]), oaep_items_digest([])))
        items = migrate_p1_snapshot(
            {"session": session, "items": self.journal.oaep_items(self.sid)}, authority_id="a",
        )["items"]
        for item in items:
            item["associations"] = []
        count, raw, projected = _oaep._stream_checkpoint(iter(items), session=session, authority_id="a")
        self.assertEqual(raw, oaep_items_digest(items))
        self.assertEqual(raw, projected)

    def test_stream_canonical_equivalence_with_resources_and_sorting(self):
        snapshot = self.engine.oaep_snapshot(self.sid, limit=100)
        items = copy.deepcopy(snapshot["items"])
        for i, item in enumerate(items):
            item["run_id"] = "z" if i % 2 else "a"
            item["sequence"] = 10 - i
            item["content"] = {"parts": [
                {"type": "text", "text": "中文\nquote\""},
                {"type": "resource", "resource_ref": {"workspace_id": "ws", "resource_type": "file", "resource_id": "f", "generation": 1}},
            ], "extra": {"number": 1.0, "null": None}}
        items.sort(key=lambda x: (str(x["run_id"]), int(x["sequence"]), str(x["id"])))
        count, raw, projected = _oaep._stream_checkpoint(iter(items), session=snapshot["session"], authority_id="authority-a")
        self.assertEqual(count, len(items))
        self.assertEqual(raw, oaep_items_digest(items))
        self.assertEqual(projected, oaep_items_digest(migrate_p1_snapshot(
            {"session": snapshot["session"], "items": list(reversed(items))}, authority_id="authority-a",
        )["items"]))
        self.assertNotEqual(raw, projected)
        with self.assertRaisesRegex(RuntimeError, "order"):
            _oaep._stream_checkpoint(reversed(items), session=snapshot["session"], authority_id="authority-a")


if __name__ == "__main__":
    unittest.main()

