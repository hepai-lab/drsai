#!/usr/bin/env python3
"""
SWE-bench 数据预下载脚本

下载内容：
1. HuggingFace 数据集 (princeton-nlp/SWE-bench_Lite, Verified)
2. Git 仓库缓存 (12个repo, clone到 /data/xiongdb/swebench_repos/)
3. (可选) 预构建 Docker 镜像

用法:
    conda run -n swebench python eval/swebench/download_data.py              # 下载全部
    conda run -n swebench python eval/swebench/download_data.py --datasets   # 仅下载数据集
    conda run -n swebench python eval/swebench/download_data.py --repos      # 仅克隆仓库
    conda run -n swebench python eval/swebench/download_data.py --docker     # 仅预构建Docker镜像
    conda run -n swebench python eval/swebench/download_data.py --repos --shallow  # 浅克隆节省空间
"""

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

# ─── 配置 ──────────────────────────────────────────────────────
DATASETS_TO_DOWNLOAD = [
    "princeton-nlp/SWE-bench_Lite",       # 300 instances (主评测集)
    "princeton-nlp/SWE-bench_Verified",   # 500 instances (可选)
]

REPO_CACHE_DIR = Path("/data/xiongdb/swebench_repos")

# SWE-bench Lite 包含的 12 个仓库
REPOS_TO_CLONE = [
    "astropy/astropy",
    "django/django",
    "matplotlib/matplotlib",
    "mwaskom/seaborn",
    "pallets/flask",
    "psf/requests",
    "pydata/xarray",
    "pylint-dev/pylint",
    "pytest-dev/pytest",
    "scikit-learn/scikit-learn",
    "sphinx-doc/sphinx",
    "sympy/sympy",
]

SPLITS = ["test", "dev"]


def download_datasets():
    """下载 HuggingFace 数据集到本地缓存"""
    print("=" * 60)
    print("📦 1. 下载 HuggingFace 数据集")
    print("=" * 60)

    try:
        from datasets import load_dataset
    except ImportError:
        print("❌ 需要 datasets 库: pip install datasets")
        return False

    for dataset_name in DATASETS_TO_DOWNLOAD:
        for split in SPLITS:
            try:
                print(f"\n  ⬇️  {dataset_name} [{split}]...")
                ds = load_dataset(dataset_name, split=split)
                print(f"     ✅ {len(ds)} instances")

                # 打印 repo 分布
                repos = sorted(set(ds["repo"]))
                print(f"     📂 {len(repos)} repos: {', '.join(repos)}")
            except Exception as e:
                print(f"     ❌ Failed: {e}")
                # 对于没有 dev split 的数据集，跳过
                if "split" in str(e).lower():
                    print(f"        (split '{split}' not available, skipping)")
                    continue

    print(f"\n  💾 HF缓存位置: ~/.cache/huggingface/hub/")
    return True


def clone_repos(shallow: bool = False):
    """克隆 Git 仓库到缓存目录"""
    print("=" * 60)
    print("📦 2. 克隆 Git 仓库")
    print(f"   目标目录: {REPO_CACHE_DIR}")
    print(f"   浅克隆:   {shallow}")
    print("=" * 60)

    REPO_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    for repo in REPOS_TO_CLONE:
        cache_key = repo.replace("/", "_")
        cache_path = REPO_CACHE_DIR / cache_key

        if cache_path.exists():
            # 检查是否是有效的 git 仓库
            result = subprocess.run(
                ["git", "rev-parse", "--git-dir"],
                cwd=cache_path,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                print(f"\n  ✅ {repo} 已存在, 跳过 ({cache_path})")
                # 可选: fetch 最新
                print(f"     🔄 Fetching latest...")
                subprocess.run(
                    ["git", "fetch", "--all"],
                    cwd=cache_path,
                    capture_output=True, text=True, timeout=300
                )
                continue

        url = f"https://github.com/{repo}.git"
        print(f"\n  ⬇️  Cloning {repo}...")

        # 构建克隆命令
        clone_cmd = ["git", "clone"]
        if shallow:
            # 浅克隆: 只取最新提交 + 必要的历史
            # 注意: SWE-bench 需要特定 commit, 浅克隆可能缺少
            # 使用 --no-single-branch 保留所有分支
            clone_cmd.extend(["--depth", "1000", "--no-single-branch"])
        clone_cmd.extend([url, str(cache_path)])

        start = time.time()
        result = subprocess.run(
            clone_cmd,
            capture_output=True, text=True
        )
        elapsed = time.time() - start

        if result.returncode == 0:
            # 获取仓库大小
            size_result = subprocess.run(
                ["du", "-sh", str(cache_path)],
                capture_output=True, text=True
            )
            size_str = size_result.stdout.split()[0] if size_result.returncode == 0 else "?"
            print(f"     ✅ Done in {elapsed:.1f}s (size: {size_str})")
        else:
            print(f"     ❌ Failed: {result.stderr[:300]}")
            print(f"        尝试不带 shallow 重新克隆...")

            # 如果浅克隆失败, 尝试完整克隆
            if shallow:
                clone_cmd = ["git", "clone", url, str(cache_path)]
                # 清理可能残留的目录
                subprocess.run(["rm", "-rf", str(cache_path)], capture_output=True)
                result = subprocess.run(clone_cmd, capture_output=True, text=True)
                if result.returncode == 0:
                    print(f"     ✅ Full clone succeeded")
                else:
                    print(f"     ❌ Full clone also failed: {result.stderr[:300]}")

    # 打印总大小
    print(f"\n  📊 仓库缓存总大小:")
    size_result = subprocess.run(
        ["du", "-sh", str(REPO_CACHE_DIR)],
        capture_output=True, text=True
    )
    print(f"     {size_result.stdout.strip()}")
    return True


def build_docker_images():
    """预构建 SWE-bench Docker 镜像"""
    print("=" * 60)
    print("📦 3. 预构建 Docker 镜像")
    print("=" * 60)
    print()
    print("  ⚠️  这将下载和构建大量 Docker 镜像, 可能需要数小时和 ~50GB+ 磁盘空间")
    print("  建议在正式评测前运行, 避免评测时等待")
    print()

    # 检查 Docker 是否可用
    result = subprocess.run(
        ["docker", "info"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("  ❌ Docker 不可用, 请确保 Docker daemon 正在运行")
        return False

    print("  🔨 构建镜像命令:")
    print()
    print("  # 方式1: 构建所有 SWE-bench Lite 的 Docker 镜像")
    print("  conda run -n swebench python -m swebench.harness.prepare_images \\")
    print("      --dataset_name princeton-nlp/SWE-bench_Lite \\")
    print("      --split test \\")
    print("      --max_workers 4")
    print()
    print("  # 方式2: 在 run_evaluation 时自动构建 (首次运行会慢)")
    print("  conda run --no-capture-output -n swebench python -m swebench.harness.run_evaluation \\")
    print("      --dataset_name princeton-nlp/SWE-bench_Lite \\")
    print("      --split test \\")
    print("      --predictions_path <path_to_predictions.jsonl> \\")
    print("      --max_workers 4 \\")
    print("      --run_id <run_id> \\")
    print("      --force_rebuild=False \\")
    print("      --cache_level env")
    print()
    print("  💡 提示: Docker 镜像在第一次 run_evaluation 时会自动构建,")
    print("          如果想提前构建, 运行方式1的命令")
    print()

    # 询问是否立即构建
    try:
        answer = input("  是否立即构建? (y/N): ").strip().lower()
    except EOFError:
        answer = "n"

    if answer == "y":
        print("\n  🔨 开始构建...")
        cmd = [
            "conda", "run", "--no-capture-output", "-n", "swebench",
            "python", "-m", "swebench.harness.prepare_images",
            "--dataset_name", "princeton-nlp/SWE-bench_Lite",
            "--split", "test",
            "--max_workers", "4",
        ]
        print(f"  运行: {' '.join(cmd)}")
        result = subprocess.run(cmd)
        if result.returncode == 0:
            print("\n  ✅ Docker 镜像构建完成")
        else:
            print("\n  ❌ 构建失败, 请检查错误信息")
    else:
        print("\n  ⏭️  跳过 Docker 镜像构建 (评测时会自动构建)")

    return True


def verify_data():
    """验证已下载的数据"""
    print("\n" + "=" * 60)
    print("✅ 验证数据")
    print("=" * 60)

    # 验证数据集
    print("\n  📊 数据集:")
    try:
        from datasets import load_dataset
        for name in DATASETS_TO_DOWNLOAD:
            try:
                ds = load_dataset(name, split="test")
                print(f"     ✅ {name}: {len(ds)} instances")
            except Exception as e:
                if "split" not in str(e).lower():
                    print(f"     ❌ {name}: {e}")
    except ImportError:
        print("     ⚠️  datasets 库未安装, 跳过数据集验证")

    # 验证仓库
    print("\n  📂 Git 仓库:")
    for repo in REPOS_TO_CLONE:
        cache_key = repo.replace("/", "_")
        cache_path = REPO_CACHE_DIR / cache_key
        if cache_path.exists():
            result = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=cache_path,
                capture_output=True, text=True
            )
            if result.returncode == 0:
                commit = result.stdout.strip()[:12]
                size_result = subprocess.run(
                    ["du", "-sh", str(cache_path)],
                    capture_output=True, text=True
                )
                size_str = size_result.stdout.split()[0] if size_result.returncode == 0 else "?"
                print(f"     ✅ {repo:40s} HEAD={commit} size={size_str}")
            else:
                print(f"     ⚠️  {repo}: 目录存在但不是有效git仓库")
        else:
            print(f"     ❌ {repo:40s} 未克隆")

    # 验证 Docker
    print("\n  🐳 Docker 镜像:")
    result = subprocess.run(
        ["docker", "images", "--filter", "reference=sweb.*", "--format", "{{.Repository}}:{{.Tag}}\t{{.Size}}"],
        capture_output=True, text=True
    )
    if result.returncode == 0 and result.stdout.strip():
        images = result.stdout.strip().split("\n")
        print(f"     找到 {len(images)} 个 sweb 镜像:")
        for img in images[:10]:
            print(f"       {img}")
        if len(images) > 10:
            print(f"       ... 还有 {len(images)-10} 个")
    else:
        print("     (尚无 sweb 镜像, 评测时会自动构建)")

    print("\n" + "=" * 60)
    print("✅ 数据预下载完成!")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description="SWE-bench 数据预下载")
    parser.add_argument("--datasets", action="store_true", help="仅下载 HuggingFace 数据集")
    parser.add_argument("--repos", action="store_true", help="仅克隆 Git 仓库")
    parser.add_argument("--docker", action="store_true", help="仅预构建 Docker 镜像")
    parser.add_argument("--shallow", action="store_true", help="浅克隆仓库 (节省空间, 但可能缺少旧commit)")
    parser.add_argument("--verify", action="store_true", help="仅验证已下载的数据")
    args = parser.parse_args()

    # 如果没有指定任何选项, 则全部执行
    do_all = not any([args.datasets, args.repos, args.docker, args.verify])

    if args.verify:
        verify_data()
        return

    if do_all or args.datasets:
        download_datasets()

    if do_all or args.repos:
        clone_repos(shallow=args.shallow)

    if do_all or args.docker:
        build_docker_images()

    verify_data()


if __name__ == "__main__":
    main()
