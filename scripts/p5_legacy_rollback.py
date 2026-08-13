from __future__ import annotations

import hashlib
import json
import re
import stat
from pathlib import Path, PurePosixPath
from typing import Any
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile, ZipInfo


SCHEMA_VERSION = "p5-legacy-rollback/1"
MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024
MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
REQUIRED_MEMBERS = (
    "apps/android/app/src/main/java/ai/drsai/remote/data/LocalStore.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/LegacyConversationAdapter.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/AndroidDevicePresence.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/DevicePresenceController.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/OaepSessionRepository.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteCommandState.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/OaepJsonCodec.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/OaepProjectionIntegrity.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelaySseClient.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayRemoteRepository.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteStore.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteWorkspaceContainer.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteWorkspaceBoundaries.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemotePushRegistration.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteNotificationNavigation.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/AndroidRemoteConnectivity.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteReliability.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/device/RemoteBackgroundSync.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteSessionStateMachines.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteSessionUiAuthority.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteLatencyTracker.kt",
    "apps/android/app/src/androidTest/java/ai/drsai/remote/P6CapacityRecoveryPhysicalTest.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemotePairingJourney.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteResourceLeaseRegistry.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteSingleFlight.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteTimeScheduler.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteTimelineNavigation.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/security/RelayDeviceProof.kt",
    "apps/android/app/src/main/AndroidManifest.xml",
    "apps/android/app/src/main/res/xml/backup_rules.xml",
    "apps/android/app/src/main/res/xml/data_extraction_rules.xml",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/data/WorkspaceSessionCatalog.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/generated/RelayContractGenerated.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/model/SessionConversationDigest.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/model/OaepDigest.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionScreens.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHomeViewModel.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteConnectionDiagnostic.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteActionablePresentation.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHostStatusPresentation.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteUiLanguage.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemotePushReadinessPolicy.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/WorkspaceSessionsViewModel.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt",
    "apps/desktop/shared/renderer/src/components/MobilePairingDialog.tsx",
    "apps/desktop/shared/renderer/src/components/mobilePairingWizard.ts",
    "apps/desktop/shared/renderer/src/components/mobilePairingGrantLifecycle.ts",
    "apps/desktop/shared/renderer/src/styles.css",
    "apps/desktop/shared/renderer/src/App.tsx",
    "apps/desktop/shared/renderer/src/mockDesktopApi.ts",
    "apps/desktop/shared/renderer/src/components/mobileAssociationScopeEditor.ts",
    "apps/desktop/shared/api/desktopApi.ts",
    "apps/desktop/shared/main/preload.ts",
    "apps/desktop/shared/main/mobilePairingController.ts",
    "apps/desktop/shared/main/mobileRemoteDiagnostics.ts",
    "apps/desktop/shared/main/workspaceSessionCatalog.ts",
    "apps/desktop/shared/main/chat.ts",
    "apps/desktop/shared/main/messageDelivery.ts",
    "apps/desktop/shared/main/sessionSyncState.ts",
    "apps/desktop/shared/main/oaepDigest.ts",
    "apps/desktop/shared/main/oaepIntegrity.ts",
    "apps/desktop/shared/main/oaepSessionStream.ts",
    "apps/desktop/windows/src/main/index.ts",
    "apps/desktop/macos/src/main/ipc/registerCatalogIpc.ts",
    "apps/android/app/src/main/java/ai/drsai/remote/runtime/oaep/LegacyOaepBackfill.kt",
    "apps/android/app/src/main/java/ai/drsai/remote/runtime/oaep/LegacyOaepShadowAuditor.kt",
    "apps/desktop/shared/api/structuredConversation.ts",
    "apps/desktop/shared/main/legacyConversationAdapter.ts",
    "apps/desktop/shared/main/legacyProtocolTelemetry.ts",
    "apps/desktop/shared/main/remoteWorkspaceController.ts",
    "apps/desktop/shared/main/runtimeClient.ts",
    "apps/desktop/shared/main/runtimeProtocolSelection.ts",
    "apps/desktop/shared/main/threadRuntimeSubscription.ts",
    "apps/desktop/shared/main/threadRuntimeProjection.ts",
    "cores/python/packages/drsai/src/drsai/backend/gateway.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/journal.py",
    "cores/python/packages/drsai/src/drsai/oaep/digest.py",
    "cores/python/packages/drsai/src/drsai/backend/runtime/migrations.py",
    "cores/python/packages/drsai/src/drsai/compatibility/__init__.py",
    "cores/python/packages/drsai/src/drsai/compatibility/relay_legacy_conversation.py",
    "cores/python/packages/drsai/src/drsai/compatibility/relay_legacy_models.py",
    "cores/python/packages/drsai/src/drsai/compatibility/runtime_legacy_conversation.py",
    "cores/python/packages/drsai/src/drsai/relay/api.py",
    "cores/python/packages/drsai/src/drsai/relay/registry.py",
    "cores/python/packages/drsai/src/drsai/relay/notifications.py",
    "cores/python/packages/drsai/src/drsai/relay/gateway_control.py",
    "cores/python/packages/drsai/src/drsai/relay/generated_contract.py",
    "cores/python/packages/drsai/src/drsai/relay/models.py",
    "cores/python/packages/drsai/src/drsai/relay/mobile_pairing.py",
    "cores/python/packages/drsai/src/drsai/relay/runtime_client.py",
    "cores/protocol/relay/p5-platform-adapter.contract.json",
    "cores/protocol/relay/remote-workspace-legacy-inventory.json",
    "cores/protocol/relay/runtime-relay.openapi.json",
    "cores/protocol/relay/runtime-relay.schema.json",
    "cores/protocol/relay/session-conversation-fixtures.json",
    "cores/protocol/oaep/snapshot-window.examples.json",
    "scripts/verify_p6_android_host_status.py",
    "scripts/verify_p6_mobile_device_scope.mjs",
    "scripts/verify_p6_mobile_remote_diagnostics.mjs",
    "scripts/verify_p6_session_catalog_realtime.mjs",
    "scripts/verify_p6_conversation_realtime.mjs",
    "scripts/verify_p6_long_session_navigation.mjs",
    "scripts/verify_p6_push_readiness.py",
    "scripts/verify_p6_safe_notification_navigation.py",
    "scripts/verify_p6_android_background_policy.py",
    "scripts/verify_p6_android_network_recovery.py",
    "scripts/verify_p6_android_time_scheduler.py",
    "scripts/verify_p6_device_proof_lifecycle.py",
    "scripts/verify_p6_minimum_authorization.py",
    "scripts/verify_p6_sensitive_storage.py",
    "scripts/scan_remote_workspace_secret_canary.py",
    "scripts/assemble_remote_workspace_secret_scan_p5.py",
    "scripts/collect_android_secret_scan_p5.py",
    "scripts/collect_windows_secret_scan_v3.py",
    "scripts/verify_p6_full_boundary_secret_scan.py",
    "scripts/verify_p6_revocation_audit.py",
    "scripts/verify_p6_multi_worker_latency.py",
    "scripts/verify_p6_user_slo.py",
    "scripts/verify_p6_large_scale_performance.py",
    "scripts/verify_p6_capacity_backpressure.py",
    "scripts/test_verify_p6_capacity_backpressure.py",
    "scripts/accept_p6_capacity_recovery_physical.py",
    "scripts/test_accept_p6_capacity_recovery_physical.py",
    "cores/protocol/relay/remote-workspace-p5-to-p6-migration.json",
    "scripts/verify_p6_p5_legacy_transition.py",
    "scripts/test_verify_p6_p5_legacy_transition.py",
    "scripts/verify_p6_accessibility_localization.py",
    "scripts/test_verify_p6_accessibility_localization.py",
    "scripts/verify_p6_legacy_conditional_removal.py",
    "scripts/test_verify_p6_legacy_conditional_removal.py",
    "cores/protocol/relay/remote-workspace-p6-evidence.schema.json",
    "cores/protocol/relay/remote-workspace-p6-feature-evidence.json",
    "scripts/assemble_remote_workspace_p6_evidence.py",
    "scripts/finalize_remote_workspace_p6.py",
    "scripts/test_finalize_remote_workspace_p6.py",
    "scripts/verify_p6_evidence_finalizer.py",
    "scripts/test_verify_p6_evidence_finalizer.py",
    "cores/protocol/relay/remote-workspace-p6-product-acceptance.schema.json",
    "scripts/finalize_remote_workspace_p6_product_acceptance.py",
    "scripts/test_finalize_remote_workspace_p6_product_acceptance.py",
    "scripts/verify_p6_product_acceptance.py",
    "scripts/test_verify_p6_product_acceptance.py",
    "cores/protocol/relay/remote-workspace-p6-stability.schema.json",
    "scripts/assemble_remote_workspace_stability_p6.py",
    "scripts/finalize_remote_workspace_stability_p6.py",
    "scripts/test_finalize_remote_workspace_stability_p6.py",
    "scripts/verify_p6_two_device_stability.py",
    "scripts/test_verify_p6_two_device_stability.py",
    "scripts/smoke_runtime_relay_p6_retirement.py",
    "scripts/test_smoke_runtime_relay_p6_retirement.py",
    "scripts/smoke_runtime_relay_p6_authorization.py",
    "scripts/test_smoke_runtime_relay_p6_authorization.py",
    "scripts/preflight_remote_workspace_p6_devices.py",
    "scripts/test_preflight_remote_workspace_p6_devices.py",
    "scripts/smoke_runtime_relay_p6_session_catalog.py",
    "scripts/test_smoke_runtime_relay_p6_session_catalog.py",
    "scripts/smoke_runtime_relay_public_v4.py",
    "scripts/test_smoke_runtime_relay_public_v4.py",
    "cores/protocol/relay/remote-workspace-p6-progress.schema.json",
    "cores/protocol/relay/remote-workspace-p6-progress.json",
    "scripts/verify_p6_progress.py",
    "scripts/test_verify_p6_progress.py",
    "apps/desktop/shared/test-kit/verify-mobile-association-authorization.mts",
    "apps/desktop/windows/scripts/verify-p6-message-delivery.mts",
    "apps/desktop/windows/scripts/verify-p6-run-approval-races.mts",
    "apps/desktop/windows/scripts/export-remote-gateway-openapi.mjs",
    "apps/desktop/windows/resources/remote-gateway-openapi.json",
    "apps/desktop/windows/src/main/remoteGatewayClient.generated.ts",
    "scripts/verify_remote_workspace_p5_architecture.py",
)


class RollbackArtifactError(ValueError):
    pass


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _content_sha256(files: list[dict[str, Any]]) -> str:
    canonical = json.dumps(files, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return _sha256(canonical)


def _safe_member(name: str) -> bool:
    path = PurePosixPath(name)
    return bool(name) and not path.is_absolute() and "\\" not in name and ".." not in path.parts


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise RollbackArtifactError("p5_legacy_rollback_manifest_duplicate_key")
        result[key] = value
    return result


def _zip_info(name: str) -> ZipInfo:
    info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    info.create_system = 3
    return info


def build_rollback_artifact(repo_root: Path, output: Path, *, source_revision: str) -> dict[str, Any]:
    if not re.fullmatch(r"[0-9a-f]{40}", source_revision):
        raise RollbackArtifactError("p5_legacy_rollback_source_revision_invalid")
    root = repo_root.resolve()
    entries: list[tuple[str, bytes]] = []
    files: list[dict[str, Any]] = []
    total = 0
    for name in REQUIRED_MEMBERS:
        path = (root / Path(*PurePosixPath(name).parts)).resolve()
        if root not in path.parents or not path.is_file():
            raise RollbackArtifactError(f"p5_legacy_rollback_source_missing:{name}")
        raw = path.read_bytes()
        if not raw:
            raise RollbackArtifactError(f"p5_legacy_rollback_source_empty:{name}")
        total += len(raw)
        if total > MAX_UNCOMPRESSED_BYTES:
            raise RollbackArtifactError("p5_legacy_rollback_size_exceeded")
        entries.append((name, raw))
        files.append({"path": name, "bytes": len(raw), "sha256": _sha256(raw)})
    manifest = {
        "schema_version": SCHEMA_VERSION,
        "source_revision": source_revision,
        "content_sha256": _content_sha256(files),
        "files": files,
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    manifest_raw = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr(_zip_info("manifest.json"), manifest_raw)
        for name, raw in entries:
            archive.writestr(_zip_info(name), raw)
    validate_rollback_artifact(output)
    return manifest


def validate_rollback_artifact(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise RollbackArtifactError("p5_legacy_rollback_artifact_missing")
    archive_bytes = path.stat().st_size
    if archive_bytes <= 0:
        raise RollbackArtifactError("p5_legacy_rollback_artifact_missing")
    if archive_bytes > MAX_ARCHIVE_BYTES:
        raise RollbackArtifactError("p5_legacy_rollback_archive_size_exceeded")
    try:
        with ZipFile(path, "r") as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            if len(names) != len(set(names)):
                raise RollbackArtifactError("p5_legacy_rollback_duplicate_member")
            expected = {"manifest.json", *REQUIRED_MEMBERS}
            if set(names) != expected or any(not _safe_member(name) for name in names):
                raise RollbackArtifactError("p5_legacy_rollback_member_set_invalid")
            if any(
                item.is_dir()
                or stat.S_IFMT(item.external_attr >> 16) == stat.S_IFLNK
                or item.compress_type not in {ZIP_STORED, ZIP_DEFLATED}
                for item in infos
            ):
                raise RollbackArtifactError("p5_legacy_rollback_member_type_invalid")
            if sum(item.file_size for item in infos if item.filename != "manifest.json") > MAX_UNCOMPRESSED_BYTES:
                raise RollbackArtifactError("p5_legacy_rollback_size_exceeded")
            try:
                manifest = json.loads(
                    archive.read("manifest.json").decode("utf-8"), object_pairs_hook=_strict_object
                )
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise RollbackArtifactError("p5_legacy_rollback_manifest_invalid") from exc
            if not isinstance(manifest, dict) or set(manifest) != {
                "schema_version", "source_revision", "content_sha256", "files"
            }:
                raise RollbackArtifactError("p5_legacy_rollback_manifest_shape_invalid")
            if manifest.get("schema_version") != SCHEMA_VERSION or not re.fullmatch(
                r"[0-9a-f]{40}", str(manifest.get("source_revision", ""))
            ):
                raise RollbackArtifactError("p5_legacy_rollback_manifest_identity_invalid")
            files = manifest.get("files")
            if not isinstance(files, list) or len(files) != len(REQUIRED_MEMBERS):
                raise RollbackArtifactError("p5_legacy_rollback_manifest_files_invalid")
            expected_rows: list[dict[str, Any]] = []
            for name in REQUIRED_MEMBERS:
                raw = archive.read(name)
                if not raw:
                    raise RollbackArtifactError(f"p5_legacy_rollback_member_empty:{name}")
                expected_rows.append({"path": name, "bytes": len(raw), "sha256": _sha256(raw)})
            if files != expected_rows or manifest.get("content_sha256") != _content_sha256(expected_rows):
                raise RollbackArtifactError("p5_legacy_rollback_manifest_digest_mismatch")
            return manifest
    except (BadZipFile, OSError) as exc:
        raise RollbackArtifactError("p5_legacy_rollback_archive_invalid") from exc
