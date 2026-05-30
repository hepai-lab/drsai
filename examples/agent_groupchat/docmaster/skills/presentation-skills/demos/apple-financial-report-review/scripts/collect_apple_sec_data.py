"""下载 Apple 财报底稿并整理核心财务数据。

本脚本服务于 `apple_financial_report_review` PPT 工作区，流程为：
1. 从 SEC submissions API 获取 Apple Inc. 的 10-K 列表；
2. 下载近五个 fiscal year 的 10-K 原文到 `data/reports/`；
3. 从 SEC companyfacts API 提取年度财务指标；
4. 生成后续图表和 PPT 构建所需的 CSV 与数据来源清单。
"""

from __future__ import annotations

import csv
import gzip
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


WORKSPACE = Path(__file__).resolve().parents[1]
DATA_DIR = WORKSPACE / "data"
RAW_DIR = DATA_DIR / "raw"
REPORT_DIR = DATA_DIR / "reports"
PROCESSED_DIR = DATA_DIR / "processed"

CIK = "0000320193"
CIK_INT = "320193"
USER_AGENT = "AutoCausePanel academic research contact@example.com"
SUBMISSIONS_URL = f"https://data.sec.gov/submissions/CIK{CIK}.json"
COMPANYFACTS_URL = f"https://data.sec.gov/api/xbrl/companyfacts/CIK{CIK}.json"


@dataclass(frozen=True)
class Filing:
    """SEC 申报文件的最小下载信息。"""

    fiscal_year: int
    accession: str
    filing_date: str
    report_date: str
    primary_document: str

    @property
    def document_url(self) -> str:
        accn_no_dash = self.accession.replace("-", "")
        return (
            f"https://www.sec.gov/Archives/edgar/data/{CIK_INT}/"
            f"{accn_no_dash}/{self.primary_document}"
        )

    @property
    def local_name(self) -> str:
        safe_doc = self.primary_document.replace("/", "_")
        return f"FY{self.fiscal_year}_{self.filing_date}_{self.accession}_{safe_doc}"


def fetch_json(url: str) -> dict[str, Any]:
    """从 SEC API 下载 JSON。"""

    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip, deflate"})
    with urlopen(request, timeout=60) as response:
        payload = response.read()
        if response.headers.get("Content-Encoding") == "gzip" or payload.startswith(b"\x1f\x8b"):
            payload = gzip.decompress(payload)
        return json.loads(payload.decode("utf-8"))


def fetch_bytes(url: str) -> bytes:
    """下载二进制内容。"""

    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=90) as response:
        return response.read()


def latest_10k_filings(submissions: dict[str, Any], count: int = 5) -> list[Filing]:
    """从 submissions recent 字段筛选最近若干份 10-K。"""

    recent = submissions["filings"]["recent"]
    fields = {
        key: recent[key]
        for key in ["accessionNumber", "form", "filingDate", "reportDate", "primaryDocument"]
    }
    filings: list[Filing] = []
    for idx, form in enumerate(fields["form"]):
        if form != "10-K":
            continue
        report_date = fields["reportDate"][idx]
        fiscal_year = int(report_date[:4])
        filings.append(
            Filing(
                fiscal_year=fiscal_year,
                accession=fields["accessionNumber"][idx],
                filing_date=fields["filingDate"][idx],
                report_date=report_date,
                primary_document=fields["primaryDocument"][idx],
            )
        )
        if len(filings) >= count:
            break
    return filings


def fact_values(
    companyfacts: dict[str, Any], tag: str, unit: str = "USD", period_key: str = "fy"
) -> list[dict[str, Any]]:
    """读取单个 us-gaap fact tag 的年度 10-K 数据。"""

    facts = companyfacts["facts"]["us-gaap"].get(tag, {})
    rows = facts.get("units", {}).get(unit, [])
    annual_rows = []
    for row in rows:
        if row.get("form") != "10-K" or row.get("fp") != "FY":
            continue
        if not row.get("fy") or row.get("val") is None:
            continue
        annual_rows.append(row)
    annual_rows.sort(key=lambda x: (x["fy"], x.get("filed", "")))
    latest_by_period: dict[int, dict[str, Any]] = {}
    for row in annual_rows:
        if period_key == "end_year":
            key = int(str(row.get("end", ""))[:4])
        elif period_key == "fy":
            key = int(row["fy"])
        else:
            raise ValueError(f"未知 period_key: {period_key}")
        latest_by_period[key] = row | {"_period_key": key}
    return [latest_by_period[key] for key in sorted(latest_by_period)]


def build_financial_table(companyfacts: dict[str, Any], fiscal_years: list[int]) -> list[dict[str, Any]]:
    """整理年度核心利润表、现金流和资产负债表指标。"""

    tag_map = {
        "revenue": "RevenueFromContractWithCustomerExcludingAssessedTax",
        "gross_profit": "GrossProfit",
        "operating_income": "OperatingIncomeLoss",
        "net_income": "NetIncomeLoss",
        "rd_expense": "ResearchAndDevelopmentExpense",
        "sga_expense": "SellingGeneralAndAdministrativeExpense",
        "operating_cash_flow": "NetCashProvidedByUsedInOperatingActivities",
        "capex": "PaymentsToAcquirePropertyPlantAndEquipment",
        "cash_and_equivalents": "CashAndCashEquivalentsAtCarryingValue",
        "current_marketable_securities": "MarketableSecuritiesCurrent",
        "noncurrent_marketable_securities": "MarketableSecuritiesNoncurrent",
        "total_assets": "Assets",
        "commercial_paper": "CommercialPaper",
        "long_term_debt_current": "LongTermDebtCurrent",
        "long_term_debt": "LongTermDebtNoncurrent",
        "buybacks": "PaymentsForRepurchaseOfCommonStock",
        "dividends": "PaymentsOfDividends",
    }
    point_in_time_names = {
        "cash_and_equivalents",
        "current_marketable_securities",
        "noncurrent_marketable_securities",
        "total_assets",
        "commercial_paper",
        "long_term_debt_current",
        "long_term_debt",
    }
    data_by_tag = {
        name: fact_values(
            companyfacts,
            tag,
            period_key="end_year" if name in point_in_time_names else "fy",
        )
        for name, tag in tag_map.items()
    }
    value_lookup: dict[str, dict[int, float]] = {}
    source_lookup: dict[str, dict[int, str]] = {}
    for name, rows in data_by_tag.items():
        value_lookup[name] = {int(row["_period_key"]): float(row["val"]) for row in rows}
        source_lookup[name] = {int(row["_period_key"]): row.get("accn", "") for row in rows}

    records: list[dict[str, Any]] = []
    for fy in fiscal_years:
        row: dict[str, Any] = {"fiscal_year": fy}
        for name in tag_map:
            row[name] = value_lookup.get(name, {}).get(fy)
        revenue = row.get("revenue") or 0
        if revenue:
            row["gross_margin"] = row.get("gross_profit", 0) / revenue
            row["operating_margin"] = row.get("operating_income", 0) / revenue
            row["net_margin"] = row.get("net_income", 0) / revenue
            row["rd_ratio"] = row.get("rd_expense", 0) / revenue
            row["sga_ratio"] = row.get("sga_expense", 0) / revenue
            row["fcf"] = row.get("operating_cash_flow", 0) - row.get("capex", 0)
            row["fcf_margin"] = row["fcf"] / revenue
        row["cash_marketable_securities"] = sum(
            v or 0
            for v in [
                row.get("cash_and_equivalents"),
                row.get("current_marketable_securities"),
                row.get("noncurrent_marketable_securities"),
            ]
        )
        row["total_debt"] = sum(
            v or 0
            for v in [
                row.get("commercial_paper"),
                row.get("long_term_debt_current"),
                row.get("long_term_debt"),
            ]
        )
        row["net_cash"] = row["cash_marketable_securities"] - row["total_debt"]
        row["capital_return"] = (row.get("buybacks") or 0) + (row.get("dividends") or 0)
        records.append(row)
    return records


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    """写出 CSV。"""

    if not rows:
        raise ValueError(f"没有可写入的数据: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    """执行下载与处理流程。"""

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)

    submissions = fetch_json(SUBMISSIONS_URL)
    (RAW_DIR / "apple_sec_submissions.json").write_text(
        json.dumps(submissions, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    time.sleep(0.2)
    companyfacts = fetch_json(COMPANYFACTS_URL)
    (RAW_DIR / "apple_sec_companyfacts.json").write_text(
        json.dumps(companyfacts, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    filings = latest_10k_filings(submissions, count=5)
    if len(filings) < 5:
        raise RuntimeError(f"只找到 {len(filings)} 份 10-K，少于预期的 5 份。")
    for filing in filings:
        report_path = REPORT_DIR / filing.local_name
        if not report_path.exists():
            report_path.write_bytes(fetch_bytes(filing.document_url))
            time.sleep(0.2)

    fiscal_years = sorted(f.fiscal_year for f in filings)
    financial_rows = build_financial_table(companyfacts, fiscal_years=fiscal_years)
    write_csv(PROCESSED_DIR / "apple_financials_fy2021_fy2025.csv", financial_rows)

    filing_rows = [
        {
            "fiscal_year": filing.fiscal_year,
            "filing_date": filing.filing_date,
            "report_date": filing.report_date,
            "accession": filing.accession,
            "primary_document": filing.primary_document,
            "url": filing.document_url,
            "local_file": str((REPORT_DIR / filing.local_name).relative_to(WORKSPACE)),
        }
        for filing in filings
    ]
    write_csv(PROCESSED_DIR / "apple_10k_sources.csv", filing_rows)

    sources_md = [
        "# 数据来源",
        "",
        "- SEC submissions API: https://data.sec.gov/submissions/CIK0000320193.json",
        "- SEC companyfacts API: https://data.sec.gov/api/xbrl/companyfacts/CIK0000320193.json",
        "",
        "## 已下载 10-K",
        "",
    ]
    for filing in filings:
        sources_md.append(
            f"- FY{filing.fiscal_year}: {filing.document_url} "
            f"(filed {filing.filing_date}, accession {filing.accession})"
        )
    (PROCESSED_DIR / "sources.md").write_text("\n".join(sources_md) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
