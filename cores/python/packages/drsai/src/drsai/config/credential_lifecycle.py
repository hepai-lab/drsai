"""Conservative local credential orphan scanning and cleanup."""

from __future__ import annotations

from pathlib import Path

from .credentials import default_credentials_dir, delete_credential
from .loader import ConfigError, default_config_path, load_user_config
from .service import last_known_good_path


def scan_orphaned_credentials(
    *, path: str | Path | None = None, root: Path | None = None
) -> dict[str, object]:
    target = Path(path) if path is not None else default_config_path()
    referenced: set[str] = set()
    for config_path in (target, last_known_good_path(target)):
        if not config_path.is_file():
            continue
        config = load_user_config(config_path)
        referenced.update(
            provider.api_key_credential
            for provider in config.providers.values()
            if provider.api_key_credential
        )
    credential_root = root or default_credentials_dir()
    local = {
        f"drsai-credential:{item.stem}"
        for item in credential_root.glob("*.bin")
        if item.is_file()
    } if credential_root.is_dir() else set()
    orphans = sorted(local - referenced)
    return {
        "supported": True,
        "referenced_count": len(referenced),
        "local_count": len(local),
        "orphan_count": len(orphans),
        "orphan_references": orphans,
    }


def cleanup_orphaned_credentials(
    *, path: str | Path | None = None, root: Path | None = None, dry_run: bool = True
) -> dict[str, object]:
    result = scan_orphaned_credentials(path=path, root=root)
    references = list(result["orphan_references"])
    deleted: list[str] = []
    failed: list[str] = []
    if not dry_run:
        for reference in references:
            try:
                (deleted if delete_credential(reference, root=root) else failed).append(reference)
            except ConfigError:
                failed.append(reference)
    return {**result, "dry_run": dry_run, "deleted_count": len(deleted), "failed_count": len(failed)}
