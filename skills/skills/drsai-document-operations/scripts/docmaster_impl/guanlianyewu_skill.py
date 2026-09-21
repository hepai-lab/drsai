"""
关联业务 (related-party business) workflow skill.

Provides three capabilities used by DocMaster's 3-step right-panel flow:

  1. 申请资料审查  — already handled via existing extract/audit tools (no code here).
  2. 综合材料撰写  — recommend experts from 04 专家清单/ and pre-fill 附件3
                     评审论证专家个人意见表.docx for each selected expert.
  3. 公示信息生成  — render the 公示 .docx from extracted project fields.

This module currently exposes only the expert-roster index. The fill/render
helpers live in this same file so the whole 关联业务 workflow stays in one
place rather than scattering across document_skills/.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Iterable

try:
    from docx import Document
    from docx.oxml.ns import qn
    from docx.shared import Pt
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "python-docx is required for guanlianyewu_skill. "
        "Install with: pip install python-docx"
    ) from exc


# The skill carries its own related-business resources.  Resolve them from the
# skill root rather than from an adjacent DocMaster checkout, so expert
# recommendation and opinion-form generation remain portable after migration.
_SCRIPTS_DIR = Path(__file__).resolve().parent.parent
_SKILL_ROOT = _SCRIPTS_DIR.parent
_BUNDLED_RESOURCE_ROOT = _SKILL_ROOT / "assets" / "guanlianyewu"
# Support an earlier package layout without falling back to the source project.
_LEGACY_PACKAGED_RESOURCE_ROOT = _SCRIPTS_DIR / "shared_resources" / "guanlianyewu"
_LEGACY_WORKSPACE_ROOT = _SCRIPTS_DIR / "workspace" / "关联业务"


def _resolve_resource_root() -> Path:
    env = os.environ.get("DOCMASTER_GUANLIANYEWU_RESOURCES")
    if env:
        return Path(env).expanduser().resolve()
    if _BUNDLED_RESOURCE_ROOT.is_dir():
        return _BUNDLED_RESOURCE_ROOT
    return _LEGACY_PACKAGED_RESOURCE_ROOT


_DEFAULT_WORKSPACE = _resolve_resource_root()


def _candidate_roster_dirs(root: Path) -> list[Path]:
    return [
        root / "expert_rosters",
        root / "04 专家清单",
        root,
    ]


def _resolve_roster_dir(workspace_root: Path | str | None = None) -> Path | None:
    roots = [Path(workspace_root)] if workspace_root else [_DEFAULT_WORKSPACE]
    if not workspace_root:
        roots.append(_LEGACY_WORKSPACE_ROOT)

    seen: set[Path] = set()
    for root in roots:
        root = root.expanduser().resolve()
        if root in seen:
            continue
        seen.add(root)
        for candidate in _candidate_roster_dirs(root):
            if candidate.is_dir():
                return candidate
    return None


# ────────────────────────────────────────────────────────────────────────────
# Expert roster
# ────────────────────────────────────────────────────────────────────────────


@dataclass
class Expert:
    """One row from an expert-recommendation table."""

    name: str             # 专家姓名 (parenthetical qualifiers stripped)
    title: str            # 职称职级
    field: str            # 专业领域 (raw text, may contain newlines / parens)
    department: str       # 推荐单位
    office_phone: str
    mobile: str
    email: str
    note: str = ""        # 备注 (only 多学科 has this)
    source_file: str = ""  # filename the expert came from
    # ── Derived fields (populated by parser) ──
    name_qualifier: str = ""  # text inside () attached to name, e.g. "硬件 电子学 ASIC"
    keywords: tuple[str, ...] = ()  # tokenized search corpus from field+qualifier+note

    def to_dict(self) -> dict:
        d = asdict(self)
        # tuples don't survive JSON well — coerce to list
        d["keywords"] = list(self.keywords)
        return d


# Punctuation we tokenize the search corpus on (CJK + ASCII)
_TOKEN_SPLIT = re.compile(r"[\s,，、;；。.()（）/／\\|]+")


def _split_name_qualifier(name_cell: str) -> tuple[str, str]:
    """Pull out a trailing `(...)` or `（...）` qualifier from a name cell.

    `魏微 （硬件 电子学 ASIC）` → ("魏微", "硬件 电子学 ASIC")
    `潘卫民 （光源）`           → ("潘卫民", "光源")
    `葛锐`                    → ("葛锐", "")
    """
    m = re.search(r"^(.+?)\s*[（(]([^（()）]*)[)）]\s*$", name_cell)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return name_cell.strip(), ""


def _build_keywords(*texts: str) -> tuple[str, ...]:
    """Tokenize a stack of text columns into a deduped keyword tuple."""
    tokens: list[str] = []
    seen: set[str] = set()
    for text in texts:
        if not text:
            continue
        for tok in _TOKEN_SPLIT.split(text):
            tok = tok.strip()
            if not tok or tok in seen:
                continue
            seen.add(tok)
            tokens.append(tok)
    return tuple(tokens)


def _clean_cell(text: str) -> str:
    """Normalize a cell's text: collapse newlines + multiple spaces."""
    return re.sub(r"\s+", " ", text.replace("\n", " ").strip())


def _is_header_row(cells: list[str]) -> bool:
    """Cheap detection of header rows so we skip them."""
    joined = "".join(cells)
    return "推荐单位" in joined and "专家姓名" in joined and "邮箱" in joined


def _parse_roster_docx(path: Path) -> list[Expert]:
    """Parse one 04 专家清单/*.docx file into a list of Expert rows.

    Handles two table layouts seen in the corpus:
      - 7 cols: 推荐单位 / 专家姓名 / 职称职级 / 专业领域 / 办公室电话 / 手机 / 邮箱
      - 8 cols: 备注 / [above]   (多学科 file)
    """
    doc = Document(str(path))
    experts: list[Expert] = []
    source = path.name

    if doc.tables:
        for table in doc.tables:
            last_dept = ""  # python-docx returns "" for merged-cell continuations
            for row in table.rows:
                cells = [_clean_cell(c.text) for c in row.cells]
                if not cells or _is_header_row(cells):
                    continue
                if all(not c for c in cells):
                    continue

                # Detect layout by column count
                if len(cells) >= 8:
                    note, dept, name, title, field, ophone, mobile, email = (
                        cells[0], cells[1], cells[2], cells[3],
                        cells[4], cells[5], cells[6], cells[7],
                    )
                elif len(cells) >= 7:
                    note = ""
                    dept, name, title, field, ophone, mobile, email = (
                        cells[0], cells[1], cells[2], cells[3],
                        cells[4], cells[5], cells[6],
                    )
                else:
                    continue

                # Carry forward the department for merged cells
                if dept:
                    last_dept = dept
                else:
                    dept = last_dept

                # Skip rows that don't look like a real expert (no name)
                if not name or name in {"推荐单位", "备注"}:
                    continue

                clean_name, qualifier = _split_name_qualifier(name)
                experts.append(
                    Expert(
                        name=clean_name,
                        title=title,
                        field=field,
                        department=dept,
                        office_phone=ophone,
                        mobile=mobile,
                        email=email,
                        note=note,
                        source_file=source,
                        name_qualifier=qualifier,
                        keywords=_build_keywords(field, qualifier, note),
                    )
                )
    else:
        # Paragraph-based file (科研处 采购办). Format observed:
        #   "科研处: 徐鹤"
        #   "财务资产处: 孙桂霞 徐乐乐 刘洋 蒲秀娟 (按采购申请单审批分工)"
        for para in doc.paragraphs:
            text = para.text.strip()
            if ":" not in text and "：" not in text:
                continue
            parts = re.split(r"[:：]", text, maxsplit=1)
            if len(parts) != 2:
                continue
            dept_part, names_part = parts
            dept = dept_part.strip()
            # Strip trailing parenthetical note
            note_match = re.search(r"[（(](.+?)[)）]\s*$", names_part)
            note = note_match.group(1).strip() if note_match else ""
            if note_match:
                names_part = names_part[: note_match.start()]
            for name in re.split(r"[\s,，、]+", names_part.strip()):
                if not name:
                    continue
                experts.append(
                    Expert(
                        name=name,
                        title="",
                        field=dept,  # use dept as field hint
                        department=dept,
                        office_phone="",
                        mobile="",
                        email="",
                        note=note,
                        source_file=source,
                        name_qualifier="",
                        keywords=_build_keywords(dept, note),
                    )
                )

    return experts


def build_expert_index(
    workspace_root: Path | str | None = None,
) -> list[Expert]:
    """Walk the shared expert roster directory and return all experts.

    Defaults to shared_resources/guanlianyewu/expert_rosters, honors
    DOCMASTER_GUANLIANYEWU_RESOURCES, and falls back to the old
    workspace/关联业务/04 专家清单 layout. Skips Word lock files (~$prefix)
    and non-.docx files.
    """
    roster_dir = _resolve_roster_dir(workspace_root)
    if roster_dir is None:
        return []

    all_experts: list[Expert] = []
    for entry in sorted(roster_dir.iterdir()):
        if entry.name.startswith("~$") or not entry.name.endswith(".docx"):
            continue
        try:
            all_experts.extend(_parse_roster_docx(entry))
        except Exception as exc:  # noqa: BLE001
            # Skip a single corrupt file rather than failing the whole load.
            print(f"⚠️ guanlianyewu_skill: failed to parse {entry.name}: {exc}")
            continue

    return all_experts


# ────────────────────────────────────────────────────────────────────────────
# Domain synonym map for matching
# ────────────────────────────────────────────────────────────────────────────
#
# Maps a project-domain query term to the related-expert keywords that should
# also score as a hit. Built from the actual roster vocabulary, not invented.
# Bidirectional: matching is done by expanding *both* sides.

_SYNONYMS: dict[str, tuple[str, ...]] = {
    "超导腔":   ("射频超导技术", "低温", "超导", "高频", "真空"),
    "超导":     ("射频超导技术", "低温", "超导腔"),
    "低温":     ("超导", "射频超导技术", "超导腔"),
    "高频":     ("射频", "射频超导技术"),
    "射频":     ("高频", "射频超导技术"),
    "真空":     ("真空系统",),
    "磁铁":     ("磁体",),
    "电源":     ("电源技术", "电气工程", "电气"),
    "电气":     ("电源", "电气工程"),
    "机械":     ("机械工程", "机械-设备安装", "精密仪器及机械"),
    "探测器":   ("核探测", "气体", "闪烁体", "半导体探测器", "PMT", "光电倍增管"),
    "PMT":      ("光电倍增管", "探测器", "核探测"),
    "电子学":   ("核电子学", "前端电子学", "ASIC", "硬件"),
    "ASIC":     ("核电子学", "电子学", "硬件"),
    "软件":     ("计算机应用技术", "AI", "算法", "数据获取", "数据分析"),
    "AI":       ("人工智能", "机器学习", "数据分析", "算法", "软件"),
    "机器学习": ("AI", "人工智能", "数据分析", "算法"),
    "计算":     ("计算机应用技术", "数据分析", "数据获取"),
    "中子":     ("中子物理", "中子散射", "中子极化技术"),
    "同步辐射": ("同步辐射应用", "同步辐射光刻技术", "同步辐射应用光学"),
    "X射线":    ("X射线成像", "X射线散射", "X射线光学"),
    "中微子":   ("中微子物理学",),
    "宇宙线":   ("宇宙线与高能天体物理", "高能天体物理"),
    "粒子物理": ("粒子物理与原子核物理", "粒子物理理论"),
    "QCD":      ("量子色动力学", "强子物理", "格点QCD"),
    "化学":     ("无机化学", "应用化学", "物理化学"),
    "暖通":     ("供暖", "给排水", "空调", "暖通、给排水"),
    "给排水":   ("供水", "暖通", "建筑给排水"),
    "建筑":     ("建筑给排水", "供水", "供暖", "电气"),
    "供暖":     ("暖通", "给排水"),
    "自动控制": ("控制", "自动化"),
    "知识产权": ("公司管理", "知识产权管理"),
    "管理":     ("大装置管理", "公司管理", "知识产权管理"),
}


def _expand_terms(terms: Iterable[str]) -> set[str]:
    """Expand a set of query terms with their roster-vocabulary synonyms.

    Two passes:
      1. Exact-key lookup — `"低温"` triggers its synonym set directly.
      2. Substring scan — for Chinese phrases that aren't whitespace-tokenized
         (`"超导腔检修服务"`, `"机械加工"`), any synonym key contained inside
         the term also fires its expansion. Without this, multi-character
         compounds in user queries miss the synonym map entirely.
    """
    expanded: set[str] = set()
    for t in terms:
        t = t.strip()
        if not t:
            continue
        expanded.add(t)
        if t in _SYNONYMS:
            expanded.update(_SYNONYMS[t])
        # Substring scan against synonym keys
        for key, vals in _SYNONYMS.items():
            if key != t and key in t:
                expanded.add(key)
                expanded.update(vals)
    return expanded


def _tokenize_query(query: str) -> list[str]:
    """Split a free-text query (or comma list) into search terms."""
    if not query:
        return []
    return [t for t in _TOKEN_SPLIT.split(query) if t.strip()]


# ────────────────────────────────────────────────────────────────────────────
# Recommender
# ────────────────────────────────────────────────────────────────────────────


# Departments that are treated as administrative reviewers, not technical.
# These get returned in a separate slot so they don't displace technical experts.
_ADMIN_DEPARTMENTS = frozenset({"科研处", "财务资产处", "技术发展与经营管理处"})


@dataclass
class ExpertMatch:
    """An expert with a relevance score and explanation."""

    expert: Expert
    score: float
    matched_terms: tuple[str, ...]
    rationale: str   # human-readable why-this-expert string

    def to_dict(self) -> dict:
        d = asdict(self.expert)
        d["keywords"] = list(self.expert.keywords)
        return {
            "score": round(self.score, 3),
            "matched_terms": list(self.matched_terms),
            "rationale": self.rationale,
            **d,
        }


def _score_expert(
    expert: Expert,
    query_terms: set[str],
    applicant_dept: str = "",
) -> tuple[float, list[str]]:
    """Score one expert against the expanded query terms.

    Scoring:
      +2.0  per term that matches expert.keywords (专业领域 + name qualifier + 备注)
      +1.0  per term whose substring appears in the field (loose match)
      +0.5  bonus if expert is from the applicant's recommending dept
      -0.3  penalty for admin-only department (kept low; they still get returned
            via _ADMIN_DEPARTMENTS slot, but we don't want them dominating)

    Returns (score, matched_terms_list).
    """
    score = 0.0
    matched: list[str] = []

    expert_kw = set(expert.keywords)
    field_lower = expert.field.lower()

    for term in query_terms:
        if term in expert_kw:
            score += 2.0
            matched.append(term)
            continue
        # Loose substring match against the original 专业领域 string
        if term and (term in expert.field or term.lower() in field_lower):
            score += 1.0
            matched.append(term)

    if applicant_dept and applicant_dept == expert.department:
        score += 0.5

    if expert.department in _ADMIN_DEPARTMENTS:
        score -= 0.3

    return score, matched


def _build_rationale(expert: Expert, matched: list[str]) -> str:
    """Compose a short Chinese rationale string for the UI."""
    if not matched:
        return f"{expert.department} · {expert.field or '专业领域未填写'}"
    head = "、".join(matched[:3])
    tail = f"（{expert.department} · {expert.title}）" if expert.title else f"（{expert.department}）"
    return f"匹配：{head} {tail}"


def recommend_experts(
    query: str,
    *,
    applicant_department: str = "",
    workspace_root: Path | str | None = None,
    top_n: int = 5,
    min_score: float = 1.0,
    include_admin: bool = True,
) -> dict:
    """Return ranked technical experts plus separate administrative reviewers.

    Args:
        query: free-text 专业领域 description, e.g. "超导腔检修，低温维护".
            Comma-separated keywords also work.
        applicant_department: the applicant's 推荐单位; same-dept matches get a
            small relevance boost.
        workspace_root: override the default 关联业务/ workspace location.
        top_n: maximum technical experts to return.
        min_score: drop technical matches below this score.
        include_admin: if True, also return one entry per admin reviewer (科研处
            / 财务资产处) under `administrative_reviewers`.

    Returns a dict with `query_terms`, `expanded_terms`, `recommended_experts`,
    `administrative_reviewers`, and `total_pool_size` for transparency.
    """
    raw_terms = _tokenize_query(query)
    expanded = _expand_terms(raw_terms)

    pool = build_expert_index(workspace_root)

    technical_matches: list[ExpertMatch] = []
    admin_matches: list[ExpertMatch] = []

    for expert in pool:
        if expert.department in _ADMIN_DEPARTMENTS:
            if include_admin:
                # Admin reviewers don't need to match by domain — they're
                # required by process, not expertise.
                admin_matches.append(
                    ExpertMatch(
                        expert=expert,
                        score=0.0,
                        matched_terms=(),
                        rationale=f"行政审核 · {expert.department}",
                    )
                )
            continue

        score, matched = _score_expert(expert, expanded, applicant_department)
        if score < min_score:
            continue
        technical_matches.append(
            ExpertMatch(
                expert=expert,
                score=score,
                matched_terms=tuple(matched),
                rationale=_build_rationale(expert, matched),
            )
        )

    technical_matches.sort(key=lambda m: -m.score)
    technical_matches = technical_matches[:top_n]

    return {
        "query_terms": raw_terms,
        "expanded_terms": sorted(expanded),
        "recommended_experts": [m.to_dict() for m in technical_matches],
        "administrative_reviewers": [m.to_dict() for m in admin_matches],
        "total_pool_size": len(pool),
    }


# ────────────────────────────────────────────────────────────────────────────
# 附件3 评审论证专家个人意见表 — fill helper
# ────────────────────────────────────────────────────────────────────────────
#
# Template layout (verified against 03 办理模板及提示要求/附件3 ...):
#   Row 0 — Cell[0]="拟委托关联业务基本情况"  Cell[1..2] merged, empty (8 paragraphs)
#   Rows 1–5 — evaluation prompts (DO NOT fill, expert writes here)
#   Row 6 — Cell[0]="专家签字及签署日期"      Cell[1..2] merged, empty
#
# We fill ONLY Row 0 Cell[1] (project info) and Row 6 Cell[1] (expert name +
# blank signature/date line). Evaluation cells stay untouched.

# Font + size for filled content — matches the template's existing prompt runs.
_TEMPLATE_FONT_EA = "华文仿宋"
_TEMPLATE_FONT_SZ = Pt(15)  # template uses w:sz=30 half-points

def _resolve_template_path() -> Path:
    candidates = [
        _DEFAULT_WORKSPACE / "templates" / "附件3 评审论证专家个人意见表.docx",
        _DEFAULT_WORKSPACE / "03 办理模板及提示要求" / "附件3 评审论证专家个人意见表.docx",
        _LEGACY_WORKSPACE_ROOT / "03 办理模板及提示要求" / "附件3 评审论证专家个人意见表.docx",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    return candidates[0]


_DEFAULT_TEMPLATE = _resolve_template_path()


@dataclass
class ProjectInfo:
    """Project fields used to fill 附件3 Row 0.

    All fields are optional; missing values render as blank space so the
    expert can still sign without a malformed sentence.
    """

    课题名称: str = ""
    课题编号: str = ""
    课题负责人: str = ""
    经办人: str = ""
    关联单位: str = ""
    关联类型: str = ""    # e.g. "高能所投资企业，申报人无股权"
    业务内容: str = ""
    合同金额: str = ""    # already-formatted string, e.g. "19,862元"

    def to_dict(self) -> dict:
        return asdict(self)


def _set_cjk_run(run, text: str) -> None:
    """Apply 华文仿宋 / 15pt to a freshly-added run, including CJK fonts."""
    run.text = text
    run.font.name = _TEMPLATE_FONT_EA
    run.font.size = _TEMPLATE_FONT_SZ
    rPr = run._element.get_or_add_rPr()
    rfonts = rPr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = rPr.makeelement(qn("w:rFonts"), {})
        rPr.append(rfonts)
    rfonts.set(qn("w:ascii"), _TEMPLATE_FONT_EA)
    rfonts.set(qn("w:hAnsi"), _TEMPLATE_FONT_EA)
    rfonts.set(qn("w:eastAsia"), _TEMPLATE_FONT_EA)


def _clear_cell_paragraphs(cell) -> None:
    """Remove all paragraphs in a cell, leaving one empty paragraph."""
    paragraphs = list(cell.paragraphs)
    for p in paragraphs[1:]:
        p._element.getparent().remove(p._element)
    # Wipe runs from the surviving paragraph.
    first = paragraphs[0]
    for run in list(first.runs):
        run._element.getparent().remove(run._element)


def _write_lines_to_cell(cell, lines: list[str]) -> None:
    """Write each string in `lines` as its own paragraph in `cell`.

    The first line reuses the cell's first paragraph; subsequent lines append
    new paragraphs. CJK font / size are applied per run.
    """
    _clear_cell_paragraphs(cell)
    first_para = cell.paragraphs[0]
    if lines:
        run = first_para.add_run()
        _set_cjk_run(run, lines[0])
        for extra in lines[1:]:
            p = cell.add_paragraph()
            run = p.add_run()
            _set_cjk_run(run, extra)


def _format_basic_info_lines(info: ProjectInfo) -> list[str]:
    """Compose the 6 lines that go into the 拟委托关联业务基本情况 cell."""
    课题 = info.课题名称 or "（未填写）"
    if info.课题编号:
        课题 = f"{课题}（编号：{info.课题编号}）"

    负责人 = info.课题负责人 or "（未填写）"
    if info.经办人 and info.经办人 != info.课题负责人:
        负责人 = f"{负责人} / 经办人：{info.经办人}"

    关联 = info.关联单位 or "（未填写）"
    if info.关联类型:
        关联 = f"{关联}（{info.关联类型}）"

    return [
        f"课题名称：{课题}",
        f"课题负责人：{负责人}",
        f"关联单位：{关联}",
        f"业务内容：{info.业务内容 or '（未填写）'}",
        f"合同金额：{info.合同金额 or '（未填写）'}",
    ]


def _safe_filename(text: str) -> str:
    """Strip characters Word/Windows dislike from a filename component."""
    return re.sub(r'[\\/:*?"<>|]+', "_", text).strip() or "未命名"


def fill_expert_opinion_form(
    project_info: ProjectInfo,
    expert_name: str,
    output_path: Path | str,
    template_path: Path | str | None = None,
) -> Path:
    """Fill 附件3 for one expert and save it to `output_path`.

    Args:
        project_info: project-level fields written into Row 0.
        expert_name: pre-filled into Row 6 next to the signature line.
        output_path: where to write the filled .docx (parent dirs must exist
            unless `output_path` is absolute and the parent already exists).
        template_path: override the default 附件3 template location.

    Returns the absolute path of the generated file.
    """
    tpl = Path(template_path) if template_path else _DEFAULT_TEMPLATE
    if not tpl.is_file():
        raise FileNotFoundError(f"附件3 template not found: {tpl}")

    out = Path(output_path).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)

    doc = Document(str(tpl))
    if not doc.tables:
        raise RuntimeError(f"Template has no tables: {tpl}")
    table = doc.tables[0]

    # Row 0: project info (Cell[1] is merged with Cell[2])
    info_cell = table.rows[0].cells[1]
    _write_lines_to_cell(info_cell, _format_basic_info_lines(project_info))

    # Row 6: expert name + blank signature/date stub
    sig_cell = table.rows[6].cells[1]
    sig_lines = [
        f"专家姓名：{expert_name}",
        "签字：__________   日期：____ 年 ____ 月 ____ 日",
    ]
    _write_lines_to_cell(sig_cell, sig_lines)

    doc.save(str(out))
    return out


def generate_expert_opinion_forms(
    project_info: ProjectInfo,
    experts: list[str | dict],
    output_dir: Path | str,
    template_path: Path | str | None = None,
) -> dict:
    """Generate one filled 附件3 per expert.

    Args:
        project_info: shared project fields.
        experts: list of expert names (str) OR dicts with at least a 'name'
            key (so the caller can pass the full Expert dict from the
            recommender).
        output_dir: directory to write filled forms into; created if missing.
        template_path: override the default 附件3 location.

    Returns a dict with `success`, `output_dir`, `generated_files` (list of
    {expert_name, file_path}), `skipped` (list of {expert, reason}), and
    `count`.
    """
    out_dir = Path(output_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    project_id = (
        project_info.课题编号 or project_info.课题名称 or "项目"
    ).strip()
    project_id_safe = _safe_filename(project_id)

    generated: list[dict] = []
    skipped: list[dict] = []

    for entry in experts:
        if isinstance(entry, dict):
            name = (entry.get("name") or "").strip()
        else:
            name = str(entry).strip()
        if not name:
            skipped.append({"expert": entry, "reason": "empty name"})
            continue

        safe_name = _safe_filename(name)
        filename = f"评审论证专家个人意见表-{safe_name}-{project_id_safe}.docx"
        out_path = out_dir / filename
        try:
            fill_expert_opinion_form(
                project_info=project_info,
                expert_name=name,
                output_path=out_path,
                template_path=template_path,
            )
        except Exception as exc:  # noqa: BLE001
            skipped.append({"expert": name, "reason": str(exc)})
            continue
        generated.append({"expert_name": name, "file_path": str(out_path)})

    return {
        "success": len(generated) > 0,
        "output_dir": str(out_dir),
        "count": len(generated),
        "generated_files": generated,
        "skipped": skipped,
    }


# ────────────────────────────────────────────────────────────────────────────
# Debug entry point
# ────────────────────────────────────────────────────────────────────────────


def _main() -> None:
    experts = build_expert_index()
    print(f"Loaded {len(experts)} experts from rosters\n")
    by_dept: dict[str, int] = {}
    for e in experts:
        by_dept[e.department] = by_dept.get(e.department, 0) + 1
    print("By department:")
    for dept, count in sorted(by_dept.items(), key=lambda kv: -kv[1]):
        print(f"  {count:3d}  {dept}")

    # Demo recommendation queries
    print("\n" + "=" * 70)
    for q, dept in [
        ("超导腔检修服务", "加速器中心"),
        ("软件 AI 数据分析", ""),
        ("机械加工 真空设备", "加速器中心"),
    ]:
        print(f"\nQuery: {q!r}  applicant_dept={dept!r}")
        result = recommend_experts(q, applicant_department=dept, top_n=5)
        print(f"  expanded → {result['expanded_terms']}")
        for r in result["recommended_experts"]:
            print(f"  • {r['name']:<8} score={r['score']:<5}  {r['rationale']}")

    # Demo: fill 附件3 for the top 3 superconducting-cavity experts
    print("\n" + "=" * 70)
    print("Demo: generate_expert_opinion_forms")
    sample_info = ProjectInfo(
        课题名称="超导腔故障自动诊断的预先研究",
        课题编号="E3113F5C10",
        课题负责人="戴建枰",
        经办人="戴建枰",
        关联单位="北京高能新技术有限公司",
        关联类型="高能所投资企业，申报人无股权",
        业务内容="超导腔检修服务，包括功率源、耦合器及调谐器的检修",
        合同金额="19,862元（壹万玖仟捌佰陆拾贰元整）",
    )
    rec = recommend_experts("超导腔检修服务", applicant_department="加速器中心", top_n=3)
    selected = [r["name"] for r in rec["recommended_experts"]]
    print(f"Selected experts: {selected}")

    import tempfile
    out = generate_expert_opinion_forms(
        project_info=sample_info,
        experts=selected,
        output_dir=Path(tempfile.gettempdir()) / "guanlianyewu_demo",
    )
    print(f"  success={out['success']}  count={out['count']}")
    for g in out["generated_files"]:
        print(f"    → {g['file_path']}")


if __name__ == "__main__":
    _main()
