"""从 Apple 10-K 表格中抽取产品线、地区与毛利结构数据。

SEC companyfacts 覆盖核心三表指标，但产品线、地区与 Products/Services 毛利拆分更适合直接来自
10-K HTML 表格。本脚本读取已下载的 FY2022 与 FY2025 10-K 原文，抽取 2021-2025 年度的业务结构
数据，并输出给图表与 PPT 使用的标准 CSV。
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Any

import pandas as pd


WORKSPACE = Path(__file__).resolve().parents[1]
REPORT_DIR = WORKSPACE / "data" / "reports"
PROCESSED_DIR = WORKSPACE / "data" / "processed"

FY2022_REPORT = REPORT_DIR / "FY2022_2022-10-28_0000320193-22-000108_aapl-20220924.htm"
FY2025_REPORT = REPORT_DIR / "FY2025_2025-10-31_0000320193-25-000079_aapl-20250927.htm"


def clean_label(value: Any) -> str:
    """清洗 10-K 表格中的行标签。"""

    text = str(value).replace("\xa0", " ").strip()
    for marker in [" (1)(2)", " (1)", " (2)", " (3)", " (4)"]:
        text = text.replace(marker, "")
    return " ".join(text.split())


def first_numeric(row: pd.Series, start: int, end: int) -> float | None:
    """在指定列范围内读取第一个数值。"""

    for idx in range(start, end):
        try:
            value = float(row.iloc[idx])
        except (TypeError, ValueError):
            continue
        if pd.notna(value):
            return value
    return None


def extract_three_year_table(
    table: pd.DataFrame,
    years: tuple[int, int, int],
    value_windows: tuple[tuple[int, int], tuple[int, int], tuple[int, int]],
    drop_prefix_rows: set[str],
) -> list[dict[str, Any]]:
    """抽取 Apple 10-K 中三年并列表。"""

    rows: list[dict[str, Any]] = []
    for _, source_row in table.iterrows():
        label = clean_label(source_row.iloc[0])
        if not label or label == "nan" or label in drop_prefix_rows:
            continue
        for year, window in zip(years, value_windows, strict=True):
            value = first_numeric(source_row, *window)
            if value is None:
                continue
            rows.append({"fiscal_year": year, "category": label, "value_usd_mn": value})
    return rows


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    """写出 CSV。"""

    if not rows:
        raise ValueError(f"没有可写入的数据: {path}")
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def combine_annual_rows(
    older_rows: list[dict[str, Any]], newer_rows: list[dict[str, Any]], years: set[int]
) -> list[dict[str, Any]]:
    """合并 FY2022 与 FY2025 报告中的三年并列表，只保留目标年份。"""

    combined = [row for row in older_rows + newer_rows if int(row["fiscal_year"]) in years]
    combined.sort(key=lambda row: (int(row["fiscal_year"]), row["category"]))
    return combined


def main() -> None:
    """执行表格抽取。"""

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    fy2022_tables = pd.read_html(FY2022_REPORT)
    fy2025_tables = pd.read_html(FY2025_REPORT)

    product_old = extract_three_year_table(
        table=fy2022_tables[6],
        years=(2022, 2021, 2020),
        value_windows=((3, 6), (15, 18), (27, 30)),
        drop_prefix_rows={"Net sales by category:"},
    )
    product_new = extract_three_year_table(
        table=fy2025_tables[7],
        years=(2025, 2024, 2023),
        value_windows=((3, 6), (15, 18), (27, 30)),
        drop_prefix_rows=set(),
    )
    product_rows = combine_annual_rows(product_old, product_new, years={2021, 2022, 2023, 2024, 2025})
    write_csv(PROCESSED_DIR / "apple_product_net_sales_fy2021_fy2025.csv", product_rows)

    region_old = extract_three_year_table(
        table=fy2022_tables[7],
        years=(2022, 2021, 2020),
        value_windows=((3, 6), (15, 18), (27, 30)),
        drop_prefix_rows={"Net sales by reportable segment:"},
    )
    region_new = extract_three_year_table(
        table=fy2025_tables[6],
        years=(2025, 2024, 2023),
        value_windows=((3, 6), (15, 18), (27, 30)),
        drop_prefix_rows=set(),
    )
    region_rows = combine_annual_rows(region_old, region_new, years={2021, 2022, 2023, 2024, 2025})
    write_csv(PROCESSED_DIR / "apple_region_net_sales_fy2021_fy2025.csv", region_rows)

    gm_old = extract_three_year_table(
        table=fy2022_tables[9],
        years=(2022, 2021, 2020),
        value_windows=((3, 6), (9, 12), (15, 18)),
        drop_prefix_rows={"Gross margin percentage:"},
    )
    gm_new = extract_three_year_table(
        table=fy2025_tables[9],
        years=(2025, 2024, 2023),
        value_windows=((3, 6), (9, 12), (15, 18)),
        drop_prefix_rows={"Gross margin percentage:"},
    )
    gm_rows = combine_annual_rows(gm_old, gm_new, years={2021, 2022, 2023, 2024, 2025})
    write_csv(PROCESSED_DIR / "apple_gross_margin_by_type_fy2021_fy2025.csv", gm_rows)


if __name__ == "__main__":
    main()
