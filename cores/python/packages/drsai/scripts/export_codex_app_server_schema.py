"""Export and verify the installed Codex app-server schema fail-closed."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
MANIFEST = ROOT / "cores/protocol/codex-app-server-stable-contract.json"


def find_codex(explicit: str | None) -> Path:
    if explicit:
        candidate = Path(explicit).resolve()
        if candidate.is_file():
            return candidate
        raise SystemExit(f"Codex executable does not exist: {candidate}")
    candidates = sorted((ROOT / "apps/desktop/windows/node_modules").glob("**/codex.exe"))
    if not candidates:
        raise SystemExit("Installed Desktop Codex executable was not found.")
    return candidates[0]


def version_of(executable: Path) -> str:
    result = subprocess.run(
        [str(executable), "--version"], check=True, capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    match = re.search(r"\b(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)\b", result.stdout)
    if not match:
        raise SystemExit("Codex version output could not be parsed.")
    return match.group(1)


def export(executable: Path, destination: Path) -> None:
    subprocess.run(
        [str(executable), "app-server", "generate-json-schema", "--out", str(destination)],
        check=True,
    )


def canonical_digest(path: Path) -> str:
    value = json.loads(path.read_text(encoding="utf-8"))
    encoded = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--codex-exe")
    parser.add_argument("--out")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    executable = find_codex(args.codex_exe)
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    baseline = manifest["generatedBaseline"]
    version = version_of(executable)
    if args.verify and version != baseline["codexVersion"]:
        raise SystemExit(f"Installed Codex {version} differs from reviewed baseline {baseline['codexVersion']}.")

    with tempfile.TemporaryDirectory(prefix="opendrsai-codex-schema-") as temporary:
        exported = Path(temporary) / version
        export(executable, exported)
        bundle = exported / "codex_app_server_protocol.v2.schemas.json"
        digest = canonical_digest(bundle)
        if args.verify and digest != baseline["v2BundleCanonicalSha256"]:
            raise SystemExit("Installed Codex schema differs from the reviewed contract baseline.")
        if args.out:
            target = Path(args.out).resolve()
            if target.exists():
                raise SystemExit(f"Refusing to overwrite schema output: {target}")
            shutil.copytree(exported, target)
    print(json.dumps({
        "passed": True,
        "codexVersion": version,
        "bundleSha256": digest,
        "binarySha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
