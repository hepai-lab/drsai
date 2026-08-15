from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from zipfile import ZIP_DEFLATED, ZipFile

from drsai.backend.runtime.artifacts import RuntimeArtifactStore
from drsai.backend.runtime.conversation import StructuredConversationProjector


def _context():
    return SimpleNamespace(workspace_id="workspace-default", session_id="session-docx", run_id="run-docx")


def _write_simsun_poem_docx(path: Path) -> None:
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>"""
    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    document_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""
    styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="宋体"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="宋体"/></w:rPr></w:style>
</w:styles>"""
    lines = ("静夜", "月出东山小，", "风来竹影斜。", "闲将一壶酒，", "独坐看春花。")
    paragraphs = "".join(
        f'<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="SimSun" w:hAnsi="SimSun" w:eastAsia="宋体"/></w:rPr><w:t>{line}</w:t></w:r></w:p>'
        for line in lines
    )
    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{paragraphs}<w:sectPr/></w:body></w:document>"""
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", root_rels)
        archive.writestr("word/_rels/document.xml.rels", document_rels)
        archive.writestr("word/styles.xml", styles)
        archive.writestr("word/document.xml", document)


def test_chinese_default_workspace_docx_delivery_projects_one_shared_artifact(tmp_path: Path) -> None:
    workspace = tmp_path / "OpenDrSai 默认 工作区"
    internal_tmp = tmp_path / ".drsai-dev" / "workspace" / "runs" / "user" / "tmp"
    workspace.mkdir()
    internal_tmp.mkdir(parents=True)
    source = workspace / "tmp" / "poem.docx"
    _write_simsun_poem_docx(source)

    store = RuntimeArtifactStore(tmp_path / "runtime" / "artifacts.sqlite3", lambda _: workspace)
    request = {
        "source_path": "tmp/poem.docx", "destination_name": "短诗_静夜.docx",
        "display_name": "短诗《静夜》",
        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "idempotency_key": "create-short-poem-docx",
    }
    descriptor = store.deliver(_context(), request)
    retried = store.deliver(_context(), request)

    delivered = workspace / "artifacts" / "短诗_静夜.docx"
    assert delivered.is_file()
    assert not list(internal_tmp.glob("*.docx"))
    assert descriptor["artifact_id"] == retried["artifact_id"]
    assert descriptor["path"] == "artifacts/短诗_静夜.docx"
    assert descriptor["downloadable"] is True
    assert descriptor["previewable"] is False
    assert len(store.list_for_run("workspace-default", "run-docx")) == 1

    with ZipFile(delivered) as archive:
        names = set(archive.namelist())
        document = archive.read("word/document.xml").decode("utf-8")
        styles = archive.read("word/styles.xml").decode("utf-8")
    assert {"[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"} <= names
    assert all(line in document for line in ("静夜", "月出东山小，", "独坐看春花。"))
    assert 'w:eastAsia="宋体"' in document
    assert 'w:ascii="SimSun"' in styles

    projector = StructuredConversationProjector("turn-docx", now=lambda: "2026-08-15T00:00:00Z")
    events = projector.project("artifact.created", descriptor)
    completed = [event for event in events if event["type"] == "part.completed"]
    assert len(completed) == 1
    part = completed[0]["part"]
    assert part["kind"] == "artifact"
    assert part["artifactId"] == descriptor["artifact_id"]
    assert part["path"] == "artifacts/短诗_静夜.docx"
    assert part["mime"] == "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    assert part["downloadable"] is True
    assert ".drsai" not in repr(part)
    assert str(workspace) not in repr(part)
