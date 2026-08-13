from __future__ import annotations

from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

import pytest

from p5_legacy_rollback import (
    MAX_ARCHIVE_BYTES,
    REQUIRED_MEMBERS,
    RollbackArtifactError,
    build_rollback_artifact,
    validate_rollback_artifact,
)


ROOT = Path(__file__).parents[1]


def test_bundle_is_deterministic_and_self_verifying(tmp_path: Path) -> None:
    first = tmp_path / "first.zip"
    second = tmp_path / "second.zip"
    manifest = build_rollback_artifact(ROOT, first, source_revision="1" * 40)
    build_rollback_artifact(ROOT, second, source_revision="1" * 40)
    assert first.read_bytes() == second.read_bytes()
    assert validate_rollback_artifact(first) == manifest
    assert [row["path"] for row in manifest["files"]] == list(REQUIRED_MEMBERS)


def test_symlink_member_and_oversized_outer_archive_fail_closed(tmp_path: Path) -> None:
    valid = tmp_path / "valid.zip"
    build_rollback_artifact(ROOT, valid, source_revision="1" * 40)
    with ZipFile(valid, "r") as source:
        entries = [(item, source.read(item.filename)) for item in source.infolist()]
    symlink = tmp_path / "symlink.zip"
    with ZipFile(symlink, "w", compression=ZIP_DEFLATED) as target:
        for original, raw in entries:
            info = ZipInfo(original.filename, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (0o120777 if original.filename == REQUIRED_MEMBERS[0] else 0o100644) << 16
            target.writestr(info, raw)
    with pytest.raises(RollbackArtifactError, match="member_type_invalid"):
        validate_rollback_artifact(symlink)

    oversized = tmp_path / "oversized.zip"
    with oversized.open("wb") as stream:
        stream.seek(MAX_ARCHIVE_BYTES)
        stream.write(b"x")
    with pytest.raises(RollbackArtifactError, match="archive_size_exceeded"):
        validate_rollback_artifact(oversized)
