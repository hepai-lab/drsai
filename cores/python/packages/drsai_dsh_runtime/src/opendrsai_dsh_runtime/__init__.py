"""Independent DeepSeek Harness OAEP Runtime bridge."""

from .contracts import (
    CONTROL_SCHEMA_SHA256,
    CONTROL_VERSION,
    OAEP_PROFILE,
    OAEP_SCHEMA_SHA256,
    OAEP_VERSION,
)
from .client import OaepRuntimeClient, RuntimeClientError, RuntimeEndpoint
from .discovery import DshInstallationStatus, discover_dsh_installation
from .profiles import CompatibilityDecision, ProtocolProfile, ProtocolProfileRegistry
from .pressure import run_pressure_matrix
from .release_gate import build_real_dsh_matrix, build_release_report, scan_release_artifacts

__all__ = [
    "CONTROL_SCHEMA_SHA256",
    "CONTROL_VERSION",
    "CompatibilityDecision",
    "DshInstallationStatus",
    "OAEP_PROFILE",
    "OAEP_SCHEMA_SHA256",
    "OAEP_VERSION",
    "OaepRuntimeClient",
    "ProtocolProfile",
    "ProtocolProfileRegistry",
    "RuntimeClientError",
    "RuntimeEndpoint",
    "build_real_dsh_matrix",
    "build_release_report",
    "discover_dsh_installation",
    "scan_release_artifacts",
    "run_pressure_matrix",
]

__version__ = "0.1.0.dev0"
