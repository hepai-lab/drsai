"""Fail-closed static boundaries for the P5 mobile remote workspace."""
from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file():
        raise AssertionError(f"p5_required_source_missing:{relative}")
    return path.read_text(encoding="utf-8")


def require(value: bool, code: str) -> None:
    if not value:
        raise AssertionError(code)


def main() -> int:
    oaep = read("apps/android/app/src/main/java/ai/drsai/remote/remote/data/OaepSessionRepository.kt")
    legacy = read("apps/android/app/src/main/java/ai/drsai/remote/remote/data/LegacyConversationAdapter.kt")
    session_vm = read("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt")
    container = read("apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteWorkspaceContainer.kt")
    stream = read("apps/desktop/shared/main/oaepSessionStream.ts")
    chat = read("apps/desktop/shared/main/chat.ts")
    runtime_gateway = read("cores/python/packages/drsai/src/drsai/backend/gateway.py")
    relay_api = read("cores/python/packages/drsai/src/drsai/relay/api.py")
    gateway_control = read(
        "cores/python/packages/drsai/src/drsai/relay/gateway_control.py"
    )
    runtime_domain = read(
        "cores/python/packages/drsai/src/drsai/relay/runtime_domain.py"
    )
    runtime_compat = read(
        "cores/python/packages/drsai/src/drsai/compatibility/runtime_legacy_conversation.py"
    )
    relay_compat = read(
        "cores/python/packages/drsai/src/drsai/compatibility/relay_legacy_conversation.py"
    )
    relay_models = read("cores/python/packages/drsai/src/drsai/relay/models.py")
    relay_registry = read("cores/python/packages/drsai/src/drsai/relay/registry.py")
    legacy_models = read(
        "cores/python/packages/drsai/src/drsai/compatibility/relay_legacy_models.py"
    )
    remote_home = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHomeViewModel.kt"
    )
    remote_screens = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt"
    )
    remote_session_screens = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionScreens.kt"
    )
    android_app_ui = read(
        "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    )
    app_view_model = read(
        "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    )
    remote_store = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteStore.kt"
    )
    android_sse = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelaySseClient.kt"
    )
    android_repository = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayRemoteRepository.kt"
    )
    android_session_view_model = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt"
    )
    android_codec = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/OaepJsonCodec.kt"
    )
    observability = read(
        "cores/python/packages/drsai/src/drsai/backend/runtime/observability.py"
    )
    runtime_connector = read(
        "cores/python/packages/drsai/src/drsai/relay/runtime_client.py"
    )
    relay_notifications = read(
        "cores/python/packages/drsai/src/drsai/relay/notifications.py"
    )
    android_notifications = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/device/RemoteWorkspaceNotifications.kt"
    )
    android_push = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/device/RemotePushMessaging.kt"
    )
    android_device_proof = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/security/RelayDeviceProof.kt"
    )
    android_build = read("apps/android/app/build.gradle.kts")
    instruction_versions = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteProjectInstructions.kt"
    )
    p5_secret_assembler = read("scripts/assemble_remote_workspace_secret_scan_p5.py")
    p5_evidence_assembler = read("scripts/assemble_remote_workspace_p5_evidence.py")
    p5_finalizer = read("scripts/finalize_remote_workspace_p5.py")
    device_audit = read("cores/python/packages/drsai/src/drsai/relay/device_audit.py")
    legacy_compatibility = read(
        "cores/python/packages/drsai/src/drsai/oaep/compatibility.py"
    )
    legacy_removal_gate = read("scripts/check-oaep-legacy-removal.py")
    protocol_usage = read("cores/python/packages/drsai/src/drsai/oaep/usage.py")

    require("GeneratedSessionEvent" not in oaep and "GeneratedConversationSnapshot" not in oaep,
            "p5_oaep_imports_legacy_dto")
    require("GeneratedSessionEvent" in legacy and "GeneratedConversationSnapshot" in legacy,
            "p5_legacy_adapter_not_explicit")
    require("container.oaepSessions" in session_vm and "container.legacyConversations" in session_vm,
            "p5_session_vm_protocol_boundary_missing")
    for forbidden in ("repository.oaepSnapshot(", "repository.oaepEvents(",
                      "repository.conversationSnapshot(", "repository.sessionEvents("):
        require(forbidden not in session_vm, f"p5_session_vm_bypasses_adapter:{forbidden}")

    ui_root = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/ui"
    ui_source = "\n".join(path.read_text(encoding="utf-8") for path in ui_root.glob("*.kt"))
    for forbidden in ("Room.databaseBuilder(", "AccessTokenCoordinator(", "OkHttpClient(", "RelaySseClient("):
        require(forbidden not in ui_source, f"p5_viewmodel_owns_process_resource:{forbidden}")
    require("Room.databaseBuilder(" in container and "AccessTokenCoordinator(" in container,
            "p5_process_container_incomplete")

    require("deltaShadows" in stream and "lastEventSequence" in stream,
            "p5_delta_shadow_missing")
    require("session-catalog-events/stream" in relay_api
            and "subscribe_workspace" in read("cores/python/packages/drsai/src/drsai/relay/oaep_replay.py")
            and "workspaceSessionCatalogStream" in android_sse
            and "observeCatalog()" in read("apps/android/app/src/main/java/ai/drsai/remote/remote/ui/WorkspaceSessionsViewModel.kt"),
            "p5_session_catalog_realtime_sync_missing")
    require("sequence: event.sequence" not in stream,
            "p5_event_sequence_reused_as_item_sequence")
    runtime_chat = chat[
        chat.index("async function runRuntimeBackendChat("):
        chat.index("function emitRuntimeOaepEvent(")
    ]
    require("getConversationSnapshot(" not in runtime_chat,
            "p5_oaep_outbox_uses_legacy_snapshot")
    require("sourceMessageObserved" in runtime_chat,
            "p5_oaep_outbox_missing_source_ack")

    legacy_paths = {
        "runtime": (
            '/v1/sessions/{session_id}/conversation")',
            '/v1/sessions/{session_id}/conversation-snapshot")',
            '/v1/sessions/{session_id}/events")',
            '/v1/sessions/{session_id}/events/stream")',
        ),
        "relay": (
            '/sessions/{session_id}/conversation")',
            '/sessions/{session_id}/conversation-snapshot")',
            '/sessions/{session_id}/events")',
            '/sessions/{session_id}/events/stream")',
        ),
    }
    for source_name, source in (("runtime", runtime_gateway), ("relay", relay_api)):
        for path in legacy_paths[source_name]:
            require(path not in source, f"p5_{source_name}_legacy_route_not_isolated:{path}")
    require("/conversation\"" in runtime_compat and "/events/stream\"" in runtime_compat,
            "p5_runtime_compatibility_routes_missing")
    require("/conversation\"" in relay_compat and "/events/stream\"" in relay_compat,
            "p5_relay_compatibility_routes_missing")
    for model in ("ConversationSnapshot", "SessionConversationItem", "SessionEvent"):
        require(f"class {model}" not in relay_models,
                f"p5_relay_legacy_dto_not_isolated:{model}")
        require(f"class {model}" in legacy_models,
                f"p5_compatibility_dto_missing:{model}")
    oaep_core_paths = [
        ROOT / "cores/python/packages/drsai/src/drsai/backend/runtime/oaep.py",
        ROOT / "cores/python/packages/drsai/src/drsai/oaep/protocol.py",
        ROOT / "cores/python/packages/drsai/src/drsai/oaep/generated.py",
    ]
    for path in oaep_core_paths:
        require("drsai.compatibility" not in path.read_text(encoding="utf-8"),
                f"p5_oaep_core_imports_compatibility:{path.name}")

    require("clearLocalCache: Boolean = false" in remote_home
            and "directory.removeCachedRuntime(subject, runtimeId)" in remote_home
            and "container.drafts.clearRuntime(subject, runtimeId.value)" in remote_home
            and "container.activity.clearRuntime(subject, runtimeId.value)" in remote_home,
            "p5_disconnect_optional_cache_cleanup_missing")
    require("访问已解除，但本机缓存未能完全清除" in remote_home,
            "p5_disconnect_cleanup_partial_failure_hidden")
    require("同时清除本机缓存、草稿和历史投影" in remote_screens,
            "p5_disconnect_cleanup_choice_missing")
    require("RemoteSubscriptionRegistry::cancelSubject" in app_view_model
            and "RemoteCacheRepository(database).clearSubject" in app_view_model
            and "remote.drafts.clearSubject(subject)" in app_view_model
            and "remote.activity.clearSubject(subject)" in app_view_model,
            "p5_logout_subject_isolation_incomplete")
    for table_cleanup in (
        "clearSubjectOaepEvents", "clearSubjectOaepItems", "clearSubjectOaepRuns",
        "clearSubjectConversationItems", "clearSubjectSessionEvents", "clearSubjectApprovals",
        "clearSubjectRuns", "clearSubjectSessions", "clearSubjectWorkspaces", "clearSubjectRuntimes",
    ):
        require(table_cleanup in remote_store, f"p5_logout_table_cleanup_missing:{table_cleanup}")

    for stage in (
        "journal_append", "runtime_wss_send", "relay_fanout",
        "client_receive", "client_render",
    ):
        require(f'"{stage}"' in observability, f"p5_latency_stage_missing:{stage}")
    require("telemetry.conversation_latency" in runtime_connector,
            "p5_runtime_latency_forwarding_missing")
    require("onReceived(event" in android_sse and "System.nanoTime()" in android_sse,
            "p5_android_receive_latency_missing")
    require("recordConversationLatency" in android_repository
            and "conversation-latency" in android_repository,
            "p5_android_latency_reporter_missing")
    require("snapshot.window?.nextCursor" in android_session_view_model
            and "loadOlderHistory" in android_session_view_model,
            "p5_android_snapshot_window_navigation_missing")
    require("oaep_snapshot_checkpoint_hash_invalid" in android_codec
            and "oaep_snapshot_window_cursor_invalid" in android_codec
            and "oaep_snapshot_window_checkpoint_missing" in android_codec,
            "p5_android_snapshot_window_validation_missing")
    require('event.type == "event.item.delta"' in android_session_view_model
            and "scheduleOaepProjectionReload(event, renderStarted)" in android_session_view_model
            and "delay(16L)" in android_session_view_model
            and "flushOaepProjectionReload()" in android_session_view_model,
            "p5_oaep_delta_render_backpressure_missing")
    require("trimAccountOaepEvents" in remote_store
            and "trimAccountTerminalOaepItems" in remote_store
            and "optimistic=0" in remote_store
            and "status IN ('completed','failed','cancelled')" in remote_store,
            "p5_oaep_local_capacity_governance_missing")
    require("if (!foreground || !connectivity.online.value) return" in android_session_view_model
            and "if (online && foreground) startSessionSync()" in android_session_view_model
            and "retryPolicy.delay(" in android_session_view_model,
            "p5_android_background_or_weak_network_policy_missing")
    require("RemoteNetworkPolicy().download" in android_session_view_model
            and "pendingArtifactConfirmation" in android_session_view_model
            and "REJECT_TOO_LARGE" in android_session_view_model,
            "p5_android_metered_artifact_policy_missing")
    require("reconcileApprovalDecision" in android_session_view_model
            and '"approval.resolved"' in android_session_view_model
            and "可能由另一台已授权设备处理" in android_session_view_model
            and "approvalDecisionState(entry.action)" in android_session_view_model,
            "p5_cross_device_approval_reconciliation_missing")
    require("saveOptimisticOaepMessage" in android_session_view_model
            and "RemoteDeliveryState.SENDING" in android_session_view_model
            and "sideEffectRequestStarted = true" in android_session_view_model
            and "deliveryFailureState(" in android_session_view_model,
            "p5_message_delivery_state_not_connected_to_send_path")
    require('put("delivery_state", "optimistic")' in remote_store,
            "p5_optimistic_delivery_state_missing")
    require("uncertainOaepSourceMessageIds" in remote_store
            and "recoverUncertainRuns()" in android_session_view_model
            and "repository.recoverRun(" in android_session_view_model
            and "/idempotency/run.create/" in android_repository,
            "p5_uncertain_result_query_recovery_missing")
    require('val retryKey = "retry:${prior.identity.runId.value}"' in android_session_view_model
            and "reconcileCancelOutcome" in android_session_view_model
            and "runControlState = RemoteRunControlState.IDLE" in android_session_view_model,
            "p5_run_control_convergence_missing")
    require('idempotency_key = f"retry:{retry_of}" if retry_of else idempotency_key' in gateway_control
            and 'idempotency_key = f"retry:{retry_of}" if retry_of else idempotency_key' in runtime_domain,
            "p5_retry_idempotency_missing")
    for forbidden in ("message", "command", "path", "reasoning"):
        require(f'"{forbidden}"' not in relay_notifications,
                f"p5_notification_payload_leaks_content_key:{forbidden}")
    require("NotificationOutbox" in relay_notifications
            and "NotificationDeliveryQueue" in relay_notifications
            and "NotificationFanoutSink" in relay_notifications
            and "notification_outbox.accept" in relay_api
            and "notification_fanout.accept" in relay_api,
            "p5_relay_notification_outbox_missing")
    require("RemoteNotificationPayload" in android_notifications
            and "打开 OpenDrSai 查看详情" in android_notifications
            and "android:exported=\"false\"" in read("apps/android/app/src/main/AndroidManifest.xml"),
            "p5_android_opaque_notification_boundary_missing")
    require("RemotePushProviderStatus.NOT_CONFIGURED" in android_push
            and "RemotePushProviderStatus.PLAY_SERVICES_UNAVAILABLE" in android_push
            and '"notification.push.registration" in it.capabilities' in android_push
            and "BackoffPolicy.EXPONENTIAL" in android_push
            and "runAttemptCount + 1 >= MAX_ATTEMPTS" in android_push,
            "p5_android_push_provider_fail_closed_missing")
    require("RemoteNotificationReadiness.PERMISSION_REQUIRED" in remote_home
            and "NotificationManagerCompat" in remote_home
            and "允许系统通知后" in remote_screens
            and "启用通知" in remote_screens,
            "p5_android_notification_readiness_ui_missing")
    require("DEFAULT_KEY_MAX_AGE_SECONDS" in android_device_proof
            and "key_created_at_epoch_seconds" in android_device_proof
            and "pending_private_seed" in android_device_proof
            and "authorizeWithPendingKey" in android_device_proof
            and "scheduleDeviceKeyRotation(result.entries)" in remote_home
            and "keyRotationInFlight.compareAndSet(false, true)" in remote_home,
            "p5_android_device_key_lifecycle_missing")
    require('"mvp" -> developmentVersion' in android_build,
            "p5_mvp_version_not_bound_to_development_protocol")
    require("remote-notification-navigation" in app_view_model
            and "requestedRemoteItemId" in app_view_model
            and "deepLinkStore.edit().clear()" in app_view_model,
            "p5_notification_deep_link_not_durable_across_login")
    for table in (
        "workbench_approval_grants", "workbench_approvals", "workbench_audit",
        "workbench_events", "workbench_runs", "workbench_sessions", "workbench_workspaces",
    ):
        require(f'DELETE FROM {table} WHERE subject=:subject' in remote_store,
                f"p5_logout_workbench_cleanup_missing:{table}")
    require("WorkspaceInstructionVersionStore(getApplication()).clearSubject(subject)" in app_view_model
            and "deepLinkStore.edit().clear().apply()" in app_view_model
            and "cancelAll()" in app_view_model
            and "fun clearSubject(subject: String)" in instruction_versions
            and "fun clearRuntime(subject: String, runtimeId: RuntimeId)" in instruction_versions
            and "instructionVersions.clearRuntime(subject, runtimeId)" in remote_home,
            "p5_logout_auxiliary_cleanup_incomplete")
    require("state.destination == AppDestination.Chat" in android_app_ui
            and "remoteFocusItemId = state.requestedRemoteItemId" in android_app_ui
            and "focusItemId" in remote_session_screens
            and "transcriptListState.scrollToItem(index)" in remote_session_screens,
            "p5_notification_item_focus_missing")
    for source in (
        "android_apk", "android_logs", "android_room", "android_backup",
        "windows_database", "windows_dpapi", "windows_logs", "windows_dump",
        "relay_postgres", "relay_redis", "relay_logs",
    ):
        require(f'"{source}"' in p5_secret_assembler and f'"{source}"' in p5_finalizer,
                f"p5_secret_source_gate_missing:{source}")
    require("p5_secret_mixed_environment" in p5_secret_assembler
            and "p5_secret_mixed_canary_run" in p5_secret_assembler
            and "raw_artifacts_crossed_trust_boundary" in p5_secret_assembler
            and "p5_secret_source_set_incomplete" in p5_finalizer,
            "p5_secret_fail_closed_boundary_missing")
    require("另一台已授权设备" in device_audit and "此设备" in device_audit
            and "DeviceActionKey" in relay_api and "device_action_audit.label" in relay_api,
            "p5_user_readable_device_audit_missing")
    key_rotation = relay_registry.split("def rotate_association_device_key(", 1)[1].split(
        "def revoke_association(", 1
    )[0]
    require("for candidate_runtime in self._runtimes.values()" in key_rotation
            and "if len(current_keys) != 1" in key_rotation
            and "for candidate in active:" in key_rotation,
            "p5_device_key_rotation_not_atomic_across_runtimes")
    require("idempotent success" in key_rotation,
            "p5_device_key_rotation_crash_recovery_missing")
    audit_screen = remote_session_screens.split("fun RemoteAuditScreen(", 1)[1].split(
        "data class RemoteMessageUi", 1
    )[0]
    require("correlationId" not in audit_screen and "工作区：$workspaceName" in audit_screen,
            "p5_audit_ui_exposes_internal_trace")
    require("oaep_client_ratio >= 0.999" in legacy_compatibility
            and "legacy_request_ratio < 0.001" in legacy_compatibility
            and "transcript_hash_preserved" in legacy_compatibility
            and "database_migration_verified" in legacy_compatibility,
            "p5_legacy_removal_threshold_too_weak")
    require("two_release_cycles" not in legacy_compatibility
            and "fourteen_observation_days" not in legacy_compatibility
            and '_at_least(decision.get("observation_days"), 14)' not in p5_finalizer
            and '_at_least(decision.get("release_cycles"), 2)' not in p5_finalizer,
            "p5_legacy_removal_observation_window_not_removed")
    require("--rollback-artifact" in legacy_removal_gate
            and "--migration-evidence" in legacy_removal_gate
            and "rollback_artifact_digest_mismatch" in legacy_removal_gate,
            "p5_legacy_physical_rollback_gate_missing")
    require("_validate_legacy_removal" in p5_finalizer
            and "p5_legacy_deletion_not_eligible" in p5_finalizer
            and "p5_legacy_migration_evidence_invalid" in p5_finalizer
            and 'f"p5_legacy_{label}_artifact_content_mismatch"' in p5_finalizer,
            "p5_finalizer_legacy_removal_semantic_gate_missing")
    require("p5_feature_evidence_unbound" in p5_finalizer
            and "p5_evidence_feature_coverage_incomplete" in p5_finalizer
            and "p5_evidence_artifact_missing" in p5_finalizer
            and "p5_evidence_artifact_size_mismatch" in p5_finalizer
            and "p5_evidence_artifact_digest_mismatch" in p5_finalizer
            and "args.ledger.parent" in p5_finalizer,
            "p5_physical_feature_evidence_binding_missing")
    for prefix in ("p5_build", "p5_contract_report", "p5_contract_openapi", "p5_device_proof", "p5_stability", "p5_secret_scan"):
        require(f'"{prefix}"' in p5_finalizer,
                f"p5_top_level_physical_attestation_missing:{prefix}")
    require("p5_contract_report_artifact_content_mismatch" in p5_finalizer
            and "p5_stability_artifact_content_mismatch" in p5_finalizer
            and "p5_secret_scan_artifact_content_mismatch" in p5_finalizer,
            "p5_structured_report_physical_content_binding_missing")
    require("p5-manifest/1" in p5_evidence_assembler
            and "p5_manifest_feature_mapped_twice" in p5_evidence_assembler
            and "experience_report_artifact" in p5_evidence_assembler
            and "finalize(ledger, root)" in p5_evidence_assembler,
            "p5_evidence_assembler_not_fail_closed")
    require("p5_experience_device_proofs_mismatch" in p5_finalizer
            and "p5_experience_checks_incomplete" in p5_finalizer
            and "p5_experience_scenarios_incomplete" in p5_finalizer
            and "p5_experience_artifact_content_mismatch" in p5_finalizer,
            "p5_experience_accessibility_gate_missing")
    require("Draft202012Validator" in p5_finalizer
            and "p5_schema_validation_failed" in p5_finalizer
            and "p5_schema_unavailable_or_invalid" in p5_finalizer,
            "p5_runtime_schema_gate_missing")
    require("protocol_usage_daily" in protocol_usage
            and "protocol_migration_daily" in protocol_usage
            and "protocol_release_cycle" in protocol_usage
            and '"observation_days": 0' in protocol_usage
            and '"release_cycles": 0' in protocol_usage
            and "record_protocol_usage_safely" in relay_api
            and "class ProtocolDeletionDecision" in relay_api
            and "response_model=ProtocolDeletionDecision" in relay_api
            and "x-p5-platform-contract-sha256" in relay_api,
            "p5_protocol_usage_daily_evidence_missing")

    print("P5 remote workspace architecture verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
