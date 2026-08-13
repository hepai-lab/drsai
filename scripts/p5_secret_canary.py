"""Deterministic, content-free identity for one P5 cross-boundary canary run."""
from __future__ import annotations

import hashlib
import re


RUN_ID = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
DOMAIN = "opendrsai-p5-secret-canary/1"


def derive_canaries(canary_run_id: str) -> list[str]:
    if not isinstance(canary_run_id, str) or not RUN_ID.fullmatch(canary_run_id):
        raise RuntimeError("p5_secret_canary_run_id_invalid")
    return [
        "p5-canary-v1-" + hashlib.sha256(
            f"{DOMAIN}\0{canary_run_id}\0{index}".encode("utf-8")
        ).hexdigest()
        for index in range(4)
    ]


def canary_set_sha256(canaries: list[str]) -> str:
    if len(canaries) != 4 or len(set(canaries)) != 4:
        raise RuntimeError("p5_secret_canary_set_invalid")
    canonical = "\n".join(sorted(canaries)).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def expected_canary_set_sha256(canary_run_id: str) -> str:
    return canary_set_sha256(derive_canaries(canary_run_id))
