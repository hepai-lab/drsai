"""Productized permission-mode contracts and effective-profile resolution."""

from .profiles import (
    BUILTIN_MODES,
    DEVELOPMENT_CAPABILITIES,
    MODE_SCHEMA_VERSION,
    READ_CAPABILITIES,
    ModeDefinition,
    get_mode,
    mode_descriptors,
)
from .resolver import (
    AdministratorPolicy,
    EffectivePermissionProfile,
    ModeSelection,
    PermissionModeError,
    PermissionProfileResolver,
    PlatformBoundary,
    WorkspaceContext,
)
from .service import ModeTransitionInterrupted, ModeTransitionResult, PermissionModeService
from .auto_reviewer import (
    AUTO_REVIEW_RULE_VERSION,
    AutoReviewDecision,
    AutoReviewerConfig,
    AutoReviewerModel,
    AutoReviewerService,
)
from .evaluation import (
    AutoReviewEvaluationCase,
    AutoReviewEvaluationResult,
    evaluate_auto_reviewer,
    load_evaluation_fixture,
)
from .auto_review_coordinator import (
    AutoReviewCoordinator,
    AutoReviewCoordinatorError,
    AutoReviewRouteResult,
)
from .config_migration import (
    LEGACY_CONFIG_MIGRATION_VERSION,
    LegacyPermissionConfigMigrationService,
    LegacyPermissionMigrationResult,
)
from .kill_switch import KillSwitchResult, PermissionKillSwitchService
from .inheritance import ChildPermissionInheritance, ChildPermissionResolver

__all__ = [
    "AdministratorPolicy", "BUILTIN_MODES", "DEVELOPMENT_CAPABILITIES",
    "EffectivePermissionProfile", "MODE_SCHEMA_VERSION", "ModeDefinition",
    "ModeSelection", "PermissionModeError", "PermissionProfileResolver",
    "ModeTransitionResult", "PermissionModeService",
    "ModeTransitionInterrupted",
    "PlatformBoundary", "READ_CAPABILITIES", "WorkspaceContext", "get_mode",
    "mode_descriptors",
    "AUTO_REVIEW_RULE_VERSION", "AutoReviewDecision", "AutoReviewEvaluationCase",
    "AutoReviewEvaluationResult", "AutoReviewerConfig", "AutoReviewerModel",
    "AutoReviewerService", "evaluate_auto_reviewer", "load_evaluation_fixture",
    "AutoReviewCoordinator", "AutoReviewCoordinatorError", "AutoReviewRouteResult",
    "LEGACY_CONFIG_MIGRATION_VERSION", "LegacyPermissionConfigMigrationService",
    "LegacyPermissionMigrationResult",
    "KillSwitchResult", "PermissionKillSwitchService",
    "ChildPermissionInheritance", "ChildPermissionResolver",
]
