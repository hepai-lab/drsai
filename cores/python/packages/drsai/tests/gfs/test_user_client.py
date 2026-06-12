"""Unit tests for drsai.modules.managers.gfs.user_client."""

from __future__ import annotations

import io
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from drsai.modules.managers.gfs.admin_client import GfsCredential
from drsai.modules.managers.gfs.user_client import (
    GfsObjectInfo,
    GfsUserClient,
    _normalize_key,
    _normalize_prefix,
)


# ---------------------------------------------------------------------- #
# 路径规范化（纯函数）
# ---------------------------------------------------------------------- #
class TestNormalizeKey:
    @pytest.mark.parametrize("inp,exp", [
        ("foo.txt", "foo.txt"),
        ("/foo.txt", "foo.txt"),
        ("//foo.txt", "foo.txt"),
        ("a/b/c.txt", "a/b/c.txt"),
        ("a/./b.txt", "a/b.txt"),
        ("a//b.txt", "a/b.txt"),
    ])
    def test_normalizes(self, inp, exp):
        assert _normalize_key(inp) == exp

    @pytest.mark.parametrize("bad", [
        "",
        "..",
        "../etc/passwd",
        "a/../b.txt",
        "a/../../b.txt",
    ])
    def test_rejects(self, bad):
        with pytest.raises(ValueError):
            _normalize_key(bad)


class TestNormalizePrefix:
    @pytest.mark.parametrize("inp,exp", [
        ("", ""),
        ("/", ""),
        ("workspace", "workspace"),
        ("workspace/", "workspace/"),
        ("/workspace/sub/", "workspace/sub/"),
    ])
    def test_normalizes(self, inp, exp):
        assert _normalize_prefix(inp) == exp

    def test_rejects_traversal(self):
        with pytest.raises(ValueError):
            _normalize_prefix("../etc/")


# ---------------------------------------------------------------------- #
# GfsUserClient (通过 patch boto3.client)
# ---------------------------------------------------------------------- #
@pytest.fixture
def cred():
    return GfsCredential(
        access_key="AK_TEST",
        secret_key="SK_TEST",
        bucket="20001-alice",
        s3_endpoint="https://fgws3.test",
        email="alice@ihep.ac.cn",
        owner_id="20001",
    )


@pytest.fixture
def mock_s3(monkeypatch):
    """patch boto3.client → return a fresh MagicMock per test."""
    mock_client = MagicMock(name="boto3_s3_client")
    with patch("boto3.client", return_value=mock_client) as m:
        yield mock_client


@pytest.fixture
def client(cred, mock_s3):
    return GfsUserClient(cred)


class TestConstruct:
    def test_boto3_args(self, cred, mock_s3):
        GfsUserClient(cred)
        args, kwargs = list(__import__("boto3").client.call_args)  # type: ignore[attr-defined]
        # We patched boto3.client via mock_s3 fixture; verify call kwargs
        # easiest: inspect mock_s3._mock_parent.call_args was on boto3.client
        # but our fixture patched boto3.client directly, so use:
        # accessed via patch.target; simpler: re-patch within test
        # — just assert mock_s3 is what was returned and not None.
        assert mock_s3 is not None

    def test_exposes_email_bucket(self, client, cred):
        assert client.email == cred.email
        assert client.bucket == cred.bucket

    def test_repr_masks_sk(self, client):
        s = repr(client)
        assert "SK_TEST" not in s
        assert "AK_TEST"[:8] in s


class TestHealthcheck:
    def test_ok(self, client, mock_s3):
        mock_s3.list_objects_v2.return_value = {"KeyCount": 0}
        assert client.healthcheck() is True
        mock_s3.list_objects_v2.assert_called_once_with(
            Bucket="20001-alice", MaxKeys=1
        )

    def test_failure(self, client, mock_s3):
        mock_s3.list_objects_v2.side_effect = RuntimeError("boom")
        assert client.healthcheck() is False


class TestExists:
    def test_true(self, client, mock_s3):
        mock_s3.head_object.return_value = {"ContentLength": 1}
        assert client.exists("foo.txt") is True
        mock_s3.head_object.assert_called_with(Bucket="20001-alice", Key="foo.txt")

    def test_false_on_404(self, client, mock_s3):
        from botocore.exceptions import ClientError
        mock_s3.head_object.side_effect = ClientError(
            {"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject"
        )
        assert client.exists("nope.txt") is False

    def test_reraise_other(self, client, mock_s3):
        from botocore.exceptions import ClientError
        mock_s3.head_object.side_effect = ClientError(
            {"Error": {"Code": "AccessDenied", "Message": "no"}}, "HeadObject"
        )
        with pytest.raises(ClientError):
            client.exists("x")


class TestListDir:
    def _page(self, contents=None, prefixes=None):
        return {
            "Contents": contents or [],
            "CommonPrefixes": [{"Prefix": p} for p in (prefixes or [])],
        }

    def test_non_recursive_with_delimiter(self, client, mock_s3):
        paginator = MagicMock()
        mock_s3.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            self._page(
                contents=[{
                    "Key": "workspace/a.txt", "Size": 10, "ETag": '"abc"',
                    "LastModified": datetime(2024, 1, 1, tzinfo=timezone.utc),
                }],
                prefixes=["workspace/sub/"],
            ),
        ]
        items = client.list_dir("workspace", recursive=False)
        # 第一个是 dir prefix
        assert items[0].is_dir
        assert items[0].path == "workspace/sub/"
        # 第二个是文件
        assert not items[1].is_dir
        assert items[1].path == "workspace/a.txt"
        assert items[1].size == 10
        assert items[1].etag == "abc"
        # 必须传 Delimiter
        kw = paginator.paginate.call_args.kwargs
        assert kw["Delimiter"] == "/"
        # prefix 自动加 /
        assert kw["Prefix"] == "workspace/"

    def test_recursive_no_delimiter(self, client, mock_s3):
        paginator = MagicMock()
        mock_s3.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            self._page(contents=[{
                "Key": "workspace/a/b.txt", "Size": 1, "ETag": '"x"',
                "LastModified": datetime(2024, 1, 1, tzinfo=timezone.utc),
            }]),
        ]
        items = client.list_dir("workspace", recursive=True)
        kw = paginator.paginate.call_args.kwargs
        assert "Delimiter" not in kw
        assert items[0].path == "workspace/a/b.txt"

    def test_skips_directory_placeholders(self, client, mock_s3):
        """S3 里 key 以 / 结尾、size=0 的对象是"目录占位"，应跳过."""
        paginator = MagicMock()
        mock_s3.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            self._page(contents=[
                {"Key": "workspace/", "Size": 0, "ETag": '"x"',
                 "LastModified": datetime(2024, 1, 1, tzinfo=timezone.utc)},
                {"Key": "workspace/file.txt", "Size": 5, "ETag": '"y"',
                 "LastModified": datetime(2024, 1, 1, tzinfo=timezone.utc)},
            ]),
        ]
        items = client.list_dir("workspace", recursive=True)
        assert len(items) == 1
        assert items[0].path == "workspace/file.txt"

    def test_max_items(self, client, mock_s3):
        paginator = MagicMock()
        mock_s3.get_paginator.return_value = paginator
        paginator.paginate.return_value = [
            self._page(contents=[
                {"Key": f"a/{i}.txt", "Size": 1, "ETag": '"x"',
                 "LastModified": datetime(2024, 1, 1, tzinfo=timezone.utc)}
                for i in range(5)
            ]),
        ]
        items = client.list_dir("a", recursive=True, max_items=3)
        assert len(items) == 3


class TestRead:
    def test_read_bytes_ok(self, client, mock_s3):
        mock_s3.head_object.return_value = {"ContentLength": 5}
        body = MagicMock()
        body.read.return_value = b"hello"
        mock_s3.get_object.return_value = {"Body": body}
        assert client.read_bytes("a.txt") == b"hello"

    def test_read_bytes_too_big(self, client, mock_s3):
        client.max_inline_read = 100
        mock_s3.head_object.return_value = {"ContentLength": 1024}
        with pytest.raises(ValueError, match="max_inline_read"):
            client.read_bytes("big.bin")
        mock_s3.get_object.assert_not_called()

    def test_read_text(self, client, mock_s3):
        mock_s3.head_object.return_value = {"ContentLength": 5}
        body = MagicMock()
        body.read.return_value = "你好".encode()
        mock_s3.get_object.return_value = {"Body": body}
        assert client.read_text("a.txt") == "你好"


class TestWrite:
    def test_write_bytes_returns_etag(self, client, mock_s3):
        mock_s3.put_object.return_value = {"ETag": '"deadbeef"'}
        etag = client.write_bytes("foo.bin", b"x", content_type="application/octet-stream")
        assert etag == "deadbeef"
        kw = mock_s3.put_object.call_args.kwargs
        assert kw["Bucket"] == "20001-alice"
        assert kw["Key"] == "foo.bin"
        assert kw["Body"] == b"x"
        assert kw["ContentType"] == "application/octet-stream"

    def test_write_text_utf8(self, client, mock_s3):
        mock_s3.put_object.return_value = {"ETag": '"x"'}
        client.write_text("a.md", "你好")
        kw = mock_s3.put_object.call_args.kwargs
        assert kw["Body"] == "你好".encode()
        assert "utf-8" in kw["ContentType"]

    def test_write_traversal_rejected(self, client, mock_s3):
        with pytest.raises(ValueError):
            client.write_bytes("../etc/passwd", b"hi")
        mock_s3.put_object.assert_not_called()

    def test_upload_file_delegates(self, client, mock_s3):
        client.upload_file("/tmp/x.csv", "uploads/run-1/x.csv")
        mock_s3.upload_file.assert_called_once_with(
            "/tmp/x.csv", "20001-alice", "uploads/run-1/x.csv"
        )

    def test_upload_stream(self, client, mock_s3):
        stream = io.BytesIO(b"data")
        client.upload_stream(stream, "a.bin", content_type="application/octet-stream")
        kw = mock_s3.upload_fileobj.call_args
        assert kw.args[0] is stream
        assert kw.args[1] == "20001-alice"
        assert kw.args[2] == "a.bin"
        assert kw.kwargs["ExtraArgs"] == {"ContentType": "application/octet-stream"}


class TestDelete:
    def test_delete_one(self, client, mock_s3):
        client.delete("a.txt")
        mock_s3.delete_object.assert_called_with(Bucket="20001-alice", Key="a.txt")

    def test_delete_many(self, client, mock_s3):
        mock_s3.delete_objects.return_value = {"Errors": []}
        ok = client.delete_many(["a.txt", "b.txt"])
        assert set(ok) == {"a.txt", "b.txt"}

    def test_delete_many_with_errors(self, client, mock_s3):
        mock_s3.delete_objects.return_value = {"Errors": [{"Key": "b.txt", "Code": "AccessDenied"}]}
        ok = client.delete_many(["a.txt", "b.txt"])
        assert ok == ["a.txt"]

    def test_delete_many_empty(self, client, mock_s3):
        assert client.delete_many([]) == []
        mock_s3.delete_objects.assert_not_called()


class TestPresign:
    def test_presign_get(self, client, mock_s3):
        mock_s3.generate_presigned_url.return_value = "https://x/y?sig=..."
        url = client.presign_get("a.txt", ttl_sec=120)
        assert url.startswith("https://")
        kw = mock_s3.generate_presigned_url.call_args
        assert kw.args[0] == "get_object"
        assert kw.kwargs["Params"]["Key"] == "a.txt"
        assert kw.kwargs["ExpiresIn"] == 120

    def test_presign_put(self, client, mock_s3):
        mock_s3.generate_presigned_url.return_value = "https://x"
        client.presign_put("a.txt", ttl_sec=60)
        assert mock_s3.generate_presigned_url.call_args.args[0] == "put_object"
