"""Real macOS Keychain lifecycle gate for model Provider credentials."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path
from uuid import uuid4


if sys.platform != "darwin":
    raise SystemExit("Model Provider Keychain gate must run on macOS.")

repo_root = Path(__file__).resolve().parents[4]
package_src = repo_root / "cores" / "python" / "packages" / "drsai" / "src"
sys.path.insert(0, str(package_src))

from drsai.config.credentials import (  # noqa: E402
    credential_available,
    delete_credential,
    resolve_credential,
    store_credential,
)


secret_one = f"opendrsai-keychain-gate-{uuid4()}"
secret_two = f"opendrsai-keychain-replacement-{uuid4()}"
references: list[str] = []

try:
    first = store_credential(secret_one)
    references.append(first)
    assert first.startswith("drsai-credential:")
    assert credential_available(first)
    assert resolve_credential(first) == secret_one

    second = store_credential(secret_two)
    references.append(second)
    assert credential_available(second)
    assert resolve_credential(second) == secret_two
    assert delete_credential(first)
    references.remove(first)
    assert resolve_credential(first) is None
    assert resolve_credential(second) == secret_two

    process_table = subprocess.run(
        ["/bin/ps", "-axo", "command="],
        capture_output=True,
        text=True,
        timeout=5,
        check=True,
    ).stdout
    assert secret_one not in process_table
    assert secret_two not in process_table

    credentials_source = (package_src / "drsai" / "config" / "credentials.py").read_text(encoding="utf-8")
    assert '"-w", secret' not in credentials_source
    assert "'-w', secret" not in credentials_source
    print("macOS model Provider Keychain lifecycle passed: store, resolve, replace, delete, and process-argument secret scan.")
finally:
    for reference in references:
        delete_credential(reference)
