"""Fail-closed compatibility profiles for changing Harness SDK runtimes."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from importlib.resources import files
from typing import Any, Literal, Mapping

from .contracts import NATIVE_SERVER_NAME, canonical_json_sha256


_SHA256 = re.compile(r"^[0-9a-f]{64}$")
SupportState = Literal["production", "probe_only", "unsupported"]


class ProtocolProfileError(ValueError):
    """Raised when a checked-in compatibility profile is malformed."""


@dataclass(frozen=True)
class ProtocolProfile:
    schema_version: int
    profile_id: str
    server_name: str
    supported_versions: tuple[str, ...]
    source_commits: tuple[str, ...]
    native_contract_sha256: str
    required_methods: frozenset[str]
    required_notifications: frozenset[str]
    required_capabilities: frozenset[str]
    mapping_version: str
    event_disposition_sha256: str
    production_ready: bool
    blockers: tuple[str, ...]
    profile_sha256: str

    @classmethod
    def from_mapping(cls, value: Mapping[str, Any]) -> "ProtocolProfile":
        expected = {
            "schema_version",
            "profile_id",
            "server_name",
            "supported_versions",
            "source_commits",
            "native_contract_sha256",
            "required_methods",
            "required_notifications",
            "required_capabilities",
            "mapping_version",
            "event_disposition_sha256",
            "production_ready",
            "blockers",
        }
        if set(value) != expected:
            raise ProtocolProfileError("Profile fields do not match the supported schema")
        if value["schema_version"] != 1:
            raise ProtocolProfileError("Unsupported profile schema version")

        def strings(name: str, *, nonempty: bool = False) -> tuple[str, ...]:
            raw = value[name]
            if not isinstance(raw, list) or not all(isinstance(item, str) and item for item in raw):
                raise ProtocolProfileError(f"{name} must contain non-empty strings")
            result = tuple(raw)
            if nonempty and not result:
                raise ProtocolProfileError(f"{name} cannot be empty")
            if len(set(result)) != len(result):
                raise ProtocolProfileError(f"{name} contains duplicates")
            return result

        for name in ("profile_id", "server_name", "mapping_version"):
            if not isinstance(value[name], str) or not value[name]:
                raise ProtocolProfileError(f"{name} must be a non-empty string")
        for name in ("native_contract_sha256", "event_disposition_sha256"):
            if not isinstance(value[name], str) or not _SHA256.fullmatch(value[name]):
                raise ProtocolProfileError(f"{name} must be a lowercase SHA-256")
        if not isinstance(value["production_ready"], bool):
            raise ProtocolProfileError("production_ready must be boolean")

        supported_versions = strings("supported_versions", nonempty=True)
        source_commits = strings("source_commits", nonempty=True)
        required_methods = strings("required_methods", nonempty=True)
        required_notifications = strings("required_notifications", nonempty=True)
        required_capabilities = strings("required_capabilities", nonempty=True)
        blockers = strings("blockers")
        if value["production_ready"] and blockers:
            raise ProtocolProfileError("A production-ready profile cannot have blockers")
        if not value["production_ready"] and not blockers:
            raise ProtocolProfileError("A probe-only profile must explain its blockers")

        normalized = dict(value)
        return cls(
            schema_version=1,
            profile_id=value["profile_id"],
            server_name=value["server_name"],
            supported_versions=supported_versions,
            source_commits=source_commits,
            native_contract_sha256=value["native_contract_sha256"],
            required_methods=frozenset(required_methods),
            required_notifications=frozenset(required_notifications),
            required_capabilities=frozenset(required_capabilities),
            mapping_version=value["mapping_version"],
            event_disposition_sha256=value["event_disposition_sha256"],
            production_ready=value["production_ready"],
            blockers=blockers,
            profile_sha256=canonical_json_sha256(normalized),
        )


@dataclass(frozen=True)
class CompatibilityDecision:
    state: SupportState
    reason: str
    profile: ProtocolProfile | None
    missing_methods: tuple[str, ...] = ()
    missing_notifications: tuple[str, ...] = ()
    missing_capabilities: tuple[str, ...] = ()

    @property
    def available(self) -> bool:
        return self.state == "production"


class ProtocolProfileRegistry:
    """Loads immutable profiles and selects one without broad SemVer guesses."""

    def __init__(self, profiles: tuple[ProtocolProfile, ...]):
        if not profiles:
            raise ProtocolProfileError("At least one protocol profile is required")
        ids = [profile.profile_id for profile in profiles]
        if len(ids) != len(set(ids)):
            raise ProtocolProfileError("Protocol profile ids must be unique")
        self._profiles = profiles

    @classmethod
    def bundled(cls) -> "ProtocolProfileRegistry":
        root = files("opendrsai_dsh_runtime").joinpath("profile_data")
        profiles: list[ProtocolProfile] = []
        for entry in sorted(root.iterdir(), key=lambda item: item.name):
            if entry.name.endswith(".json"):
                raw = json.loads(entry.read_text(encoding="utf-8"))
                if not isinstance(raw, dict):
                    raise ProtocolProfileError(f"Profile {entry.name} must contain an object")
                profiles.append(ProtocolProfile.from_mapping(raw))
        return cls(tuple(profiles))

    @property
    def profiles(self) -> tuple[ProtocolProfile, ...]:
        return self._profiles

    def decide(
        self,
        *,
        server_name: str,
        version: str,
        native_contract_sha256: str,
        methods: frozenset[str],
        notifications: frozenset[str],
        capabilities: frozenset[str],
    ) -> CompatibilityDecision:
        if server_name != NATIVE_SERVER_NAME:
            return CompatibilityDecision("unsupported", "native_server_identity_mismatch", None)
        candidates = [profile for profile in self._profiles if version in profile.supported_versions]
        if not candidates:
            return CompatibilityDecision("unsupported", "native_version_unrecognized", None)
        profile = next(
            (candidate for candidate in candidates if candidate.native_contract_sha256 == native_contract_sha256),
            None,
        )
        if profile is None:
            return CompatibilityDecision("unsupported", "native_contract_digest_mismatch", None)

        missing_methods = tuple(sorted(profile.required_methods - methods))
        missing_notifications = tuple(sorted(profile.required_notifications - notifications))
        missing_capabilities = tuple(sorted(profile.required_capabilities - capabilities))
        if missing_methods or missing_notifications:
            return CompatibilityDecision(
                "unsupported",
                "native_contract_incomplete",
                profile,
                missing_methods,
                missing_notifications,
                missing_capabilities,
            )
        if missing_capabilities and not profile.production_ready:
            return CompatibilityDecision(
                "probe_only",
                "profile_requires_runtime_extension",
                profile,
                missing_methods,
                missing_notifications,
                missing_capabilities,
            )
        if missing_capabilities:
            return CompatibilityDecision(
                "unsupported",
                "native_capabilities_incomplete",
                profile,
                missing_methods,
                missing_notifications,
                missing_capabilities,
            )
        if not profile.production_ready:
            return CompatibilityDecision("probe_only", "profile_has_release_blockers", profile)
        return CompatibilityDecision("production", "compatible", profile)
