import sys
import types
from pathlib import Path

package = types.ModuleType("drsai_ui")
package.__path__ = [str(Path(__file__).parents[1] / "src" / "drsai_ui")]
sys.modules.setdefault("drsai_ui", package)

from drsai_ui.ui_backend.backend.web.routes.files import (
    _HEPAI_FILE_ID_RE,
    _is_file_payload,
    _owner_usernames_from_agent_dicts,
    _sniff_media_type,
)


def test_sniff_png_and_jpeg():
    png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 8
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 8
    assert _sniff_media_type(png) == "image/png"
    assert _sniff_media_type(jpeg) == "image/jpeg"


def test_sniff_webp_and_unknown():
    webp = b"RIFF" + b"\x10\x00\x00\x00" + b"WEBP" + b"\x00" * 4
    assert _sniff_media_type(webp) == "image/webp"
    assert _sniff_media_type(b"not-an-image") == "application/octet-stream"


def test_hepai_file_id_pattern():
    assert _HEPAI_FILE_ID_RE.fullmatch("file-449fd55bca464848b8a6aecfa6b7180c")
    assert _HEPAI_FILE_ID_RE.fullmatch("file-8572b27d093f4e15913bebfac3645e20")
    assert not _HEPAI_FILE_ID_RE.fullmatch("../etc/passwd")
    assert not _HEPAI_FILE_ID_RE.fullmatch("file-449/preview")
    assert not _HEPAI_FILE_ID_RE.fullmatch("")


def test_is_file_payload_rejects_json_errors():
    assert _is_file_payload(b'{"detail":"not found"}', "application/json") is False
    assert _is_file_payload(b"\x89PNG\r\n\x1a\nxxxx", "image/png") is True
    assert _is_file_payload(b"\x89PNG\r\n\x1a\nxxxx", "") is True


def test_owner_usernames_prefers_matching_agent_and_skips_junk():
    agents = [
        {"id": "a1", "owner": "xiongdb@ihep.ac.cn"},
        {"id": "a2", "author": "liqm@ihep.ac.cn"},
        {"id": "a2", "owner": "liqm@ihep.ac.cn"},
        {"id": "a3", "owner": "not-an-email"},
        {"id": "a4", "owner": "YuanYuan_Agent"},
        "skip-me",
    ]
    owners = _owner_usernames_from_agent_dicts(agents, preferred_agent_id="a2")
    assert owners[0] == "liqm@ihep.ac.cn"
    assert "xiongdb@ihep.ac.cn" in owners
    assert "not-an-email" not in owners
    assert "yuanyuan_agent" not in owners
    assert owners.count("liqm@ihep.ac.cn") == 1
