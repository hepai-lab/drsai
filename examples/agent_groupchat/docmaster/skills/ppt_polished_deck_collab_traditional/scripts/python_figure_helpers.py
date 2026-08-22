#!/usr/bin/env python3
"""`ppt-polished-deck-collab` 的 Python figure helper。

定位与作用
----------
本文件为高密度研究图和分析图提供统一的 Python 渲染入口，
当前基于 `matplotlib`、`seaborn` 和 `pandas` 生成高 DPI PNG，
供 deck build 脚本以图片卡片方式稳定插入 PPT。

大致流程
----------
1. 初始化统一图表主题；
2. 根据数据构造常用分析图；
3. 以 300 DPI 输出 PNG；
4. 由 deck build 脚本把图片插入 slide，并通过预览图复核比例与清晰度。
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_MPLCONFIGDIR = Path(tempfile.gettempdir()) / "presentation_skills_mplconfig"
_MPLCONFIGDIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_MPLCONFIGDIR))

FIGURE_TITLE_FONT_PT = 16
FIGURE_LABEL_FONT_PT = 12


def _load_plot_libs():
    """延迟导入图表依赖，避免无关场景被强行要求安装。"""
    import matplotlib.pyplot as plt
    import pandas as pd
    import seaborn as sns

    return plt, pd, sns


def rgb_to_hex(rgb: tuple[int, int, int]) -> str:
    """将 RGB 三元组转成 matplotlib 可用十六进制颜色。"""
    return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"


def prepare_figure_dir(workspace_dir: Path) -> Path:
    """确保 figure 输出目录存在。"""
    figure_dir = workspace_dir / "build" / "rendered" / "python_figures"
    figure_dir.mkdir(parents=True, exist_ok=True)
    return figure_dir


def set_chart_theme(accent_rgb: tuple[int, int, int]) -> None:
    """统一设置 matplotlib / seaborn 主题。"""
    _, _, sns = _load_plot_libs()
    accent = rgb_to_hex(accent_rgb)
    sns.set_theme(
        context="paper",
        style="whitegrid",
        font_scale=1.15,
        rc={
            "axes.edgecolor": "#CBD5E1",
            "axes.labelcolor": "#334155",
            "axes.titlesize": FIGURE_TITLE_FONT_PT,
            "axes.titleweight": "bold",
            "axes.facecolor": "#FFFFFF",
            "figure.facecolor": "#FFFFFF",
            "grid.color": "#E2E8F0",
            "grid.linewidth": 0.8,
            "xtick.color": "#475569",
            "ytick.color": "#475569",
            "text.color": "#1E293B",
        },
    )
    sns.set_palette([accent, "#94A3B8", "#CBD5E1", "#0F766E", "#B45309"])


def _save(fig, output_path: Path) -> Path:
    """以 300 DPI 保存图片并关闭 Figure。"""
    plt, _, _ = _load_plot_libs()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(output_path, dpi=300, facecolor="white")
    plt.close(fig)
    return output_path


def save_ranked_bar(
    output_path: Path,
    data,
    label_col: str,
    value_col: str,
    accent_rgb: tuple[int, int, int],
    title: str,
    x_label: str,
    figsize: tuple[float, float] = (6.2, 2.45),
) -> Path:
    """保存排序条形图。"""
    plt, _, sns = _load_plot_libs()
    set_chart_theme(accent_rgb)
    plot_data = data.sort_values(value_col, ascending=True)
    fig, ax = plt.subplots(figsize=figsize, constrained_layout=True)
    ax.barh(plot_data[label_col], plot_data[value_col], color=rgb_to_hex(accent_rgb), alpha=0.88)
    for index, value in enumerate(plot_data[value_col]):
        ax.text(
            value + max(plot_data[value_col]) * 0.02,
            index,
            f"{value:.0f}",
            va="center",
            fontsize=FIGURE_LABEL_FONT_PT,
            color="#334155",
        )
    ax.set_title(title, loc="left", pad=10)
    ax.set_xlabel(x_label)
    ax.set_ylabel("")
    sns.despine(left=True, bottom=True)
    return _save(fig, output_path)


def save_heatmap(
    output_path: Path,
    frame,
    accent_rgb: tuple[int, int, int],
    title: str,
    fmt: str = ".0f",
    vmin: float | None = None,
    vmax: float | None = None,
    figsize: tuple[float, float] = (6.2, 2.45),
) -> Path:
    """保存热力图。"""
    plt, _, sns = _load_plot_libs()
    set_chart_theme(accent_rgb)
    cmap = sns.light_palette(rgb_to_hex(accent_rgb), as_cmap=True)
    fig, ax = plt.subplots(figsize=figsize, constrained_layout=True)
    sns.heatmap(
        frame,
        annot=True,
        fmt=fmt,
        cmap=cmap,
        linewidths=0.6,
        linecolor="#FFFFFF",
        cbar=False,
        ax=ax,
        vmin=vmin,
        vmax=vmax,
        annot_kws={"fontsize": FIGURE_LABEL_FONT_PT, "color": "#0F172A"},
    )
    ax.set_title(title, loc="left", pad=10)
    ax.set_xlabel("")
    ax.set_ylabel("")
    return _save(fig, output_path)


def save_timeline_barh(
    output_path: Path,
    data,
    label_col: str,
    start_col: str,
    duration_col: str,
    accent_rgb: tuple[int, int, int],
    title: str,
    x_label: str,
    figsize: tuple[float, float] = (6.2, 2.0),
) -> Path:
    """保存横向时间条图。"""
    plt, _, sns = _load_plot_libs()
    set_chart_theme(accent_rgb)
    data = data.iloc[::-1].reset_index(drop=True)
    fig, ax = plt.subplots(figsize=figsize, constrained_layout=True)
    ax.barh(
        data[label_col],
        data[duration_col],
        left=data[start_col],
        color=rgb_to_hex(accent_rgb),
        alpha=0.82,
    )
    for _, row in data.iterrows():
        ax.text(
            row[start_col] + row[duration_col] / 2,
            row[label_col],
            f"{row[duration_col]:.0f}w",
            ha="center",
            va="center",
            fontsize=FIGURE_LABEL_FONT_PT,
            color="white",
        )
    ax.set_title(title, loc="left", pad=10)
    ax.set_xlabel(x_label)
    ax.set_ylabel("")
    sns.despine(left=True, bottom=True)
    return _save(fig, output_path)
