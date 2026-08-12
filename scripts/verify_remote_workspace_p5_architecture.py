"""Fail-closed static boundaries for the P5 mobile remote workspace."""
from __future__ import annotations

import json
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
    mobile_pairing = read(
        "cores/python/packages/drsai/src/drsai/relay/mobile_pairing.py"
    )
    python_relay_url = read(
        "cores/python/packages/drsai/src/drsai/relay/url_path.py"
    )
    runtime_domain = read(
        "cores/python/packages/drsai/src/drsai/relay/runtime_domain.py"
    )
    relay_schema = read("cores/protocol/relay/runtime-relay.schema.json")
    generated_relay_python = read(
        "cores/python/packages/drsai/src/drsai/relay/generated_contract.py"
    )
    generated_relay_android = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/generated/RelayContractGenerated.kt"
    )
    generated_relay_desktop = read(
        "apps/desktop/shared/api/runtimeRelayErrorActions.generated.ts"
    )
    android_actionable_state = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteActionableState.kt"
    )
    desktop_relay_api = read("apps/desktop/shared/api/runtimeRelay.ts")
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
    legacy_inventory_generator = read(
        "scripts/generate_remote_workspace_legacy_inventory_p6.py"
    )
    legacy_inventory = json.loads(read(
        "cores/protocol/relay/remote-workspace-legacy-inventory.json"
    ))
    legacy_rollback = read("scripts/p5_legacy_rollback.py")
    desktop_legacy_telemetry = read(
        "apps/desktop/shared/main/legacyProtocolTelemetry.ts"
    )
    remote_home = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHomeViewModel.kt"
    )
    remote_screens = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteWorkspaceScreens.kt"
    )
    remote_host_status = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHostStatusPresentation.kt"
    )
    remote_push_readiness = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemotePushReadinessPolicy.kt"
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
    remote_reliability = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteReliability.kt"
    )
    run_control_ledger = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteRunControlLedger.kt"
    )
    approval_decision_ledger = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteApprovalDecisionLedger.kt"
    )
    android_sse = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelaySseClient.kt"
    )
    android_repository = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayRemoteRepository.kt"
    )
    android_discovery = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayDiscoveryClient.kt"
    )
    android_owop_transport = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/HttpOwopRelayTransport.kt"
    )
    android_relay_url = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RelayUrl.kt"
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
    platform_auth = read("cores/python/packages/drsai/src/drsai/platform_auth.py")
    desktop_dev = read("apps/desktop/windows/scripts/dev.ps1")
    gateway_watcher = read("apps/desktop/windows/scripts/watch-gateway.ps1")
    desktop_dev_entry = read("apps/desktop/windows-desktop-dev.cmd")
    bridge_startup_probe = read("scripts/probe_runtime_relay_bridge_startup.py")
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
    android_proguard = read("apps/android/app/proguard-rules.pro")
    android_test_proguard = read("apps/android/app/proguard-android-test.pro")
    instruction_versions = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteProjectInstructions.kt"
    )
    p5_secret_assembler = read("scripts/assemble_remote_workspace_secret_scan_p5.py")
    p5_evidence_assembler = read("scripts/assemble_remote_workspace_p5_evidence.py")
    p5_finalizer = read("scripts/finalize_remote_workspace_p5.py")
    p5_cli = read("scripts/remote_workspace.py")
    p5_local_gate = read("scripts/accept_remote_workspace_local_p5.py")
    p5_long_session_driver = read("scripts/accept_mobile_remote_workspace_long_session_p5.py")
    p5_session_catalog_driver = read(
        "scripts/accept_mobile_remote_workspace_session_catalog_p5.py"
    )
    p5_interaction_driver = read(
        "scripts/accept_mobile_remote_workspace_interaction_p5.py"
    )
    p5_android_apk = read("scripts/p5_android_apk.py")
    p5_android_signer_policy = json.loads(read(
        "cores/protocol/relay/p5-android-release-signers.json"
    ))
    p5_long_session_test = read(
        "apps/android/app/src/androidTest/java/ai/drsai/remote/P5LongSessionPerformanceTest.kt"
    )
    p5_session_catalog_test = read(
        "apps/android/app/src/androidTest/java/ai/drsai/remote/P5SessionCatalogRealtimeTest.kt"
    )
    p5_ledger_process_death_test = read(
        "apps/android/app/src/androidTest/java/ai/drsai/remote/P5LedgerProcessDeathTest.kt"
    )
    p5_android_secret_test = read(
        "apps/android/app/src/androidTest/java/ai/drsai/remote/P5ReleaseSecretScanTest.kt"
    )
    p5_android_streaming_scanner = read(
        "apps/android/app/src/main/java/ai/drsai/remote/remote/security/StreamingBytePatternScanner.kt"
    )
    device_audit = read("cores/python/packages/drsai/src/drsai/relay/device_audit.py")
    legacy_compatibility = read(
        "cores/python/packages/drsai/src/drsai/oaep/compatibility.py"
    )
    legacy_removal_gate = read("scripts/check-oaep-legacy-removal.py")
    legacy_rollback = read("scripts/p5_legacy_rollback.py")
    legacy_rollback_builder = read("scripts/build_oaep_legacy_rollback.py")
    legacy_migration_collector = read("scripts/collect_oaep_legacy_migration_evidence.py")
    public_oaep_smoke = read("scripts/smoke_runtime_relay_public_v4.py")
    protocol_usage = read("cores/python/packages/drsai/src/drsai/oaep/usage.py")

    require('"x-relay-error-actions"' in relay_schema
            and all(f'"{action}"' in relay_schema for action in (
                "retry", "login", "re-pair", "update", "contact-admin",
            ))
            and "RELAY_ERROR_ACTIONS" in generated_relay_python
            and "ERROR_ACTIONS" in generated_relay_android
            and "RELAY_ERROR_ACTIONS" in generated_relay_desktop
            and "RelayContractGenerated.errorAction" in android_actionable_state
            and "remoteActionableFailure(failure)" in remote_home
            and "actionableError" in remote_screens
            and '"登录" in it' not in remote_screens
            and '"版本" in it' not in remote_screens
            and "relayActionableError" in desktop_relay_api
            and "verify_p6_relay_error_actions.py" in p5_local_gate,
            "p6_generated_error_action_contract_missing")
    require("GeneratedSessionEvent" not in oaep and "GeneratedConversationSnapshot" not in oaep,
            "p5_oaep_imports_legacy_dto")
    require("GeneratedSessionEvent" in legacy and "GeneratedConversationSnapshot" in legacy,
            "p5_legacy_adapter_not_explicit")
    require("container.boundaries.session.oaep" in session_vm
            and "container.boundaries.session.legacy" in session_vm,
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
    require("retrying_startup" in runtime_gateway
            and "await connector.run_forever(stop)" in runtime_gateway
            and '"waiting_configuration"' in runtime_gateway
            and 'connector.diagnostic_state()' in runtime_gateway
            and 'transport["connection"] == "connected"' in runtime_gateway,
            "p5_runtime_relay_bridge_not_supervised_or_observable")
    require("def diagnostic_state(" in runtime_connector
            and 'payload.get("type") == "heartbeat_ack"' in runtime_connector
            and 'self._connection_state = "retrying"' in runtime_connector,
            "p5_runtime_relay_transport_diagnostics_missing")
    require("def resolve_gateway_instance_token(" in platform_auth
            and "os.path.lexists(token_path)" in platform_auth
            and "os.path.islink(token_path)" in platform_auth
            and "gateway_instance_token_file_invalid" in platform_auth
            and "except RuntimeError:\n        return False" in platform_auth,
            "p5_gateway_instance_token_file_not_fail_closed")
    require('"-InstanceTokenPath"' in desktop_dev
            and "Set-GatewayChildToken" in gateway_watcher
            and "$env:OPENDRSAI_GATEWAY_INSTANCE_TOKEN = $token" in gateway_watcher
            and "^[A-Za-z0-9_-]{32,128}$" in gateway_watcher
            and "[string]$InstanceToken," not in gateway_watcher
            and "[switch]$NoGateway" in desktop_dev
            and "-NoGateway" not in desktop_dev_entry,
            "p5_desktop_source_watcher_drops_runtime_identity")
    require('"stage": stage' in bridge_startup_probe
            and '"error_type": type(exc).__name__' in bridge_startup_probe
            and "str(exc)" not in bridge_startup_probe,
            "p5_runtime_relay_startup_probe_leaks_detail")

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
    require(relay_api.count("relay_latency_correlation(") >= 4
            and 'hashlib.sha256("\\0".join(values)' in relay_api,
            "p5_relay_latency_tenant_scope_missing")
    require('stage: Literal["client_receive", "client_render"]' in relay_api
            and "allow_inf_nan=False" in relay_api
            and "max_length=500" in relay_api,
            "p5_client_latency_observation_not_bounded")
    require("CONVERSATION_LATENCY_RETENTION_SECONDS" in observability
            and "DEFAULT_CONVERSATION_LATENCY_CAPACITY" in observability
            and "DEFAULT_CONVERSATION_LATENCY_TRIM_INTERVAL" in observability
            and "self._trim_conversation_latency(db, now, cursor.lastrowid)" in observability
            and "WHERE observed_at>=?" in observability
            and 'db.execute("PRAGMA journal_mode=WAL")' in observability
            and 'connection.execute("PRAGMA busy_timeout=30000")' in observability,
            "p5_latency_retention_or_capacity_gate_missing")
    require("OPENDRSAI_CONVERSATION_LATENCY_DATABASE" in relay_api
            and '"aggregation_scope": "shared" if conversation_latency_shared' in relay_api
            and '"multi_worker_ready"' in relay_api
            and "configured_latency_database.is_absolute()" in relay_api,
            "p5_latency_multi_worker_aggregation_missing")
    require("onReceived(event" in android_sse
            and "time.monotonicNanos()" in android_sse
            and "time.monotonicElapsedMillis(decodeStarted)" in android_sse
            and "System.nanoTime()" not in android_sse,
            "p5_android_receive_latency_missing")
    relay_http_clients = android_sse + android_repository + android_discovery + android_owop_transport
    require("fun HttpUrl.withRelayPath" in android_relay_url
            and "segments.forEach(::addPathSegment)" in android_relay_url
            and "withRelayPath" in android_sse
            and "withRelayPath" in android_repository
            and "withRelayPath" in android_discovery
            and "withRelayPath" in android_owop_transport
            and 'addPathSegments("v1/runtimes/${' not in relay_http_clients
            and '"v1/runtimes/${' not in relay_http_clients
            and 'addPathSegments("v1/associations/${' not in relay_http_clients,
            "p6_android_relay_opaque_path_not_segment_safe")
    require("def encoded_path(" in python_relay_url
            and 'quote(value, safe="")' in python_relay_url
            and "encoded_path" in gateway_control
            and "encoded_path" in mobile_pairing
            and 'f"/v1/sessions/{' not in gateway_control
            and 'f"/v1/runs/{' not in gateway_control
            and 'f"/v1/approvals/{' not in gateway_control
            and 'f"/v1/runtimes/{' not in mobile_pairing,
            "p6_python_relay_opaque_path_not_segment_safe")
    require("recordConversationLatency" in android_repository
            and "latency-observation" in android_repository
            and "GeneratedLatencyObservationRequest" in android_repository
            and "client_receive_at_ms" in generated_relay_android
            and "render_at_ms" in generated_relay_android
            and '"/v1/metrics/relay-latency"' in relay_api,
            "p5_android_latency_reporter_missing")
    require("snapshot.window?.nextCursor" in android_session_view_model
            and "loadOlderHistory" in android_session_view_model,
            "p5_android_snapshot_window_navigation_missing")
    require("if (snapshot.window == null)" in remote_store
            and "insertOlderOaepItems" in remote_store
            and "oaep_snapshot_window_waterline_mismatch" in remote_store
            and android_session_view_model.count("cachedOaepProjection()") >= 3
            and "projectOaepMessages(snapshot)" not in android_session_view_model,
            "p5_android_loaded_history_discarded_on_window_refresh")
    require("oaep_snapshot_checkpoint_hash_invalid" in android_codec
            and "oaep_snapshot_window_cursor_invalid" in android_codec
            and "oaep_snapshot_window_checkpoint_missing" in android_codec,
            "p5_android_snapshot_window_validation_missing")
    require('event.type == "event.item.delta"' in android_session_view_model
            and "scheduleOaepProjectionReload(event)" in android_session_view_model
            and android_session_view_model.count("time.awaitFrame()") == 2
            and "delay(16L)" not in android_session_view_model
            and "flushOaepProjectionReload()" in android_session_view_model
            and "LatestFrameMailbox<OaepEvent>" in android_session_view_model
            and "oaepRenderMailbox.finishCycle()" in android_session_view_model
            and "class LatestFrameMailbox" in remote_reliability
            and "if (pending != null) return false" in remote_reliability,
            "p5_oaep_delta_render_backpressure_missing")
    require('"long-session"' in p5_cli
            and "accept_mobile_remote_workspace_long_session_p5.py" in p5_cli
            and "runP5LongSessionPerformance" in p5_long_session_test
            and "p5_long_session_physical_device_required" in p5_long_session_test
            and "TOTAL_ITEMS = 100_000" in p5_long_session_test
            and "DELTA_COUNT = 10_000" in p5_long_session_test
            and "cold_pss_delta_kb" in p5_long_session_test
            and "main_ticks" in p5_long_session_test
            and "terminal_barrier_complete" in p5_long_session_test
            and "physical_environment" in p5_long_session_driver
            and "validate_device_report" in p5_long_session_driver
            and "p5_long_session_physical_device_required" in p5_long_session_driver
            and "scripts/test_accept_mobile_remote_workspace_long_session_p5.py" in p5_local_gate,
            "p5_long_session_physical_performance_gate_missing")
    require('"session-catalog"' in p5_cli
            and "accept_mobile_remote_workspace_session_catalog_p5.py" in p5_cli
            and "workspaceSessionCatalogStream" in p5_session_catalog_test
            and 'observed += "rename"' in p5_session_catalog_test
            and 'observed += "archive"' in p5_session_catalog_test
            and 'observed += "unarchive"' in p5_session_catalog_test
            and 'observed += "rollback"' in p5_session_catalog_test
            and 'put("manual_refresh_count", 0)' in p5_session_catalog_test
            and "physical_environment" in p5_session_catalog_driver
            and "runtime_authority_restored" in p5_session_catalog_driver
            and "validate_monitor_report" in p5_session_catalog_driver
            and "scripts/test_accept_mobile_remote_workspace_session_catalog_p5.py" in p5_local_gate,
            "p5_session_catalog_authoritative_realtime_gate_missing")
    require('"interaction"' in p5_cli
            and "accept_mobile_remote_workspace_interaction_p5.py" in p5_cli
            and "p5_interaction_physical_device_required" in p5_interaction_driver
            and '"P5-M04-F03"' in p5_interaction_driver
            and '"P5-M04-F05"' in p5_interaction_driver
            and "run_response_dropped_after_commit" in p5_interaction_driver
            and "approval_response_dropped_after_commit" in p5_interaction_driver
            and "denied_side_effect_count" in p5_interaction_driver
            and "run_encrypted_ledger_gate" in p5_interaction_driver
            and "run_process_death_ledger_gate" in p5_interaction_driver
            and '"am", "force-stop"' in p5_interaction_driver
            and '"application_data_cleared": False' in p5_interaction_driver
            and "RemoteApprovalDecisionLedgerTest" in p5_interaction_driver
            and '"test_count": ledger_test_count' in p5_interaction_driver
            and '"write"' in p5_ledger_process_death_test
            and '"recover"' in p5_ledger_process_death_test
            and '"verify-cleared"' in p5_ledger_process_death_test
            and "RemoteRunControlLedger(context)" in p5_ledger_process_death_test
            and "RemoteApprovalDecisionLedger(context)" in p5_ledger_process_death_test
            and "raw_content_retained" in p5_interaction_driver
            and "scripts/test_accept_mobile_remote_workspace_interaction_p5.py" in p5_local_gate,
            "p5_physical_interaction_response_loss_gate_missing")
    require("trimAccountOaepEvents" in remote_store
            and "trimAccountTerminalOaepItems" in remote_store
            and "optimistic=0" in remote_store
            and "status IN ('completed','failed','cancelled')" in remote_store
            and "maintainAccountIfDue" in remote_store
            and "cache.maintainAccountIfDue(subject, organization)" in android_session_view_model
            and "MAINTENANCE_INTERVAL_MS" in read(
                "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteCachePolicy.kt"
            ),
            "p5_oaep_local_capacity_governance_missing")
    require("if (!syncStateMachine.state.shouldSubscribe || !foreground || !connectivity.online.value) return" in android_session_view_model
            and "if (online && foreground) startSessionSync()" in android_session_view_model
            and "retryPolicy.delay(" in android_session_view_model,
            "p5_android_background_or_weak_network_policy_missing")
    require("EncryptedSharedPreferences.create" in run_control_ledger
            and "PendingRemoteRunControl" in run_control_ledger
            and "RemoteRunControlOperation.CANCEL" in run_control_ledger
            and "RemoteRunControlOperation.RETRY" in run_control_ledger
            and "idempotency_key" in run_control_ledger
            and "synchronized(LEDGER_LOCK)" in run_control_ledger
            and "remote_run_control_conflict" in run_control_ledger
            and "sameOperation" in run_control_ledger
            and "if (!current.sameOperation(value))" in run_control_ledger
            and "runControls.begin" in android_session_view_model
            and "reconcilePendingRunControl" in android_session_view_model
            and "runs.recoverRun" in android_session_view_model
            and "boundaries.run.controls.clearSubject" in read(
                "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
            )
            and "boundaries.run.controls.clearRuntime" in read(
                "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteHomeViewModel.kt"
            ),
            "p5_run_control_process_death_recovery_missing")
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
            and "runs.recoverRun(" in android_session_view_model
            and '"idempotency", "run.create"' in android_repository,
            "p5_uncertain_result_query_recovery_missing")
    require("canTransitionDelivery(current, delivery)" in remote_store
            and "remote_delivery_state_invalid" in remote_store,
            "p5_delivery_state_transaction_monotonicity_missing")
    require("val retryKey = acquired.idempotencyKey" in android_session_view_model
            and '"retry:${prior.identity.runId.value}"' in android_session_view_model
            and "reconcileCancelOutcome" in android_session_view_model
            and "reconcilePendingRunControl" in android_session_view_model
            and "runControlState = RemoteRunControlState.IDLE" in android_session_view_model,
            "p5_run_control_convergence_missing")
    require("convergeApprovalProjection" in android_session_view_model
            and "pendingApprovalId == currentApprovalId" in read(
                "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteCommandState.kt"
            ),
            "p5_approval_refresh_identity_convergence_missing")
    require('"approval.decide"' in runtime_domain
            and "return result[2]" in runtime_domain
            and 'if operation == "approval.decide"' in relay_api
            and 'authorize_runtime_permission(x_subject, runtime_id, "approve")' in relay_api
            and "SELECT result_json FROM relay_approval_decisions" in gateway_control
            and "recoverApprovalDecision" in android_repository
            and '"idempotency", "approval.decide"' in android_repository
            and "approvals.recoverApprovalDecision" in android_session_view_model
            and "EncryptedSharedPreferences.create" in approval_decision_ledger
            and "remote_approval_decision_conflict" in approval_decision_ledger
            and "sameDecision" in approval_decision_ledger
            and "if (!current.sameDecision(value))" in approval_decision_ledger
            and "reconcilePendingApprovalDecision" in android_session_view_model
            and "boundaries.approval.decisions.clearSubject" in app_view_model
            and "boundaries.approval.decisions.clearRuntime" in remote_home
            and '"approval_decision_recovery"' in relay_schema
            and "approval_decision_recovery" in generated_relay_python
            and "approval_decision_recovery" in generated_relay_android
            and "test_relay_contract_codegen.py" in p5_local_gate,
            "p5_approval_idempotency_recovery_missing")
    require('idempotency_key = f"retry:{retry_of}" if retry_of else idempotency_key' in gateway_control
            and 'idempotency_key = f"retry:{retry_of}" if retry_of else idempotency_key' in runtime_domain,
            "p5_retry_idempotency_missing")
    require("def _serialized_mutation" in runtime_domain
            and runtime_domain.count("@_serialized_mutation") >= 6,
            "p5_runtime_side_effect_serialization_missing")
    for forbidden in ("message", "command", "path", "reasoning"):
        require(f'"{forbidden}"' not in relay_notifications,
                f"p5_notification_payload_leaks_content_key:{forbidden}")
    require("NotificationOutbox" in relay_notifications
            and "NotificationDeliveryQueue" in relay_notifications
            and "NotificationFanoutSink" in relay_notifications
            and "PushDeliveryError" in relay_notifications
            and "permanent=not failure.retryable" in relay_notifications
            and "notification_outbox.accept" in relay_api
            and "notification_fanout.accept" in relay_api,
            "p5_relay_notification_outbox_missing")
    require("RemoteNotificationPayload" in android_notifications
            and "打开 OpenDrSai 查看详情" in android_notifications
            and "android:exported=\"false\"" in read("apps/android/app/src/main/AndroidManifest.xml"),
            "p5_android_opaque_notification_boundary_missing")
    require("remote_notification_envelope_invalid" in android_notifications
            and "data.keys.all { it in ALLOWED_KEYS }" in android_notifications,
            "p5_android_notification_envelope_fail_closed_missing")
    require("RemotePushProviderStatus.NOT_CONFIGURED" in android_push
            and "RemotePushProviderStatus.PLAY_SERVICES_UNAVAILABLE" in android_push
            and '"notification.push.registration" in it.capabilities' in android_push
            and "BackoffPolicy.EXPONENTIAL" in android_push
            and "runAttemptCount + 1 >= MAX_ATTEMPTS" in android_push,
            "p5_android_push_provider_fail_closed_missing")
    require("verifyFirebasePushConfig" in android_build
            and 'it.name == "preReleaseBuild"' in android_build
            and 'it.name == "preMvpBuild"' in android_build,
            "p5_android_release_push_preflight_missing")
    require('"local": ("local contract and component acceptance", "oaep/1+owop/1", "accept_remote_workspace_local_p5.py")' in p5_cli
            and '"android_unit"' in p5_local_gate
            and '"android_test_compile"' in p5_local_gate
            and '"android_release_test_compile"' in p5_local_gate
            and ":app:compileReleaseAndroidTestKotlin" in p5_local_gate
            and "RELEASE_TEST_FIREBASE_PROPERTIES" in p5_local_gate
            and '"python"' in p5_local_gate
            and '"architecture"' in p5_local_gate
            and "test_runtime_observability.py" in p5_local_gate
            and "test_relay_runtime_client.py" in p5_local_gate
            and "test_relay_oaep_replay.py" in p5_local_gate
            and "test_relay_oaep_performance.py" in p5_local_gate
            and "test_oaep_snapshot_window.py" in p5_local_gate,
            "p5_local_acceptance_must_execute_components")
    require("RemoteNotificationReadiness.PERMISSION_REQUIRED" in remote_push_readiness
            and "NotificationManagerCompat" in remote_home
            and "pushReadiness()" in remote_home
            and "notificationReadinessGeneration" in remote_home
            and "RemoteNotificationReadiness.PLATFORM_UNAVAILABLE" in remote_push_readiness
            and "允许系统通知后" in remote_host_status
            and "打开 App 后会自动同步最新进度" in remote_host_status
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
            and "rollback_artifact_digest_mismatch" in legacy_removal_gate
            and "validate_rollback_artifact" in legacy_removal_gate,
            "p5_legacy_physical_rollback_gate_missing")
    require('SCHEMA_VERSION = "p5-legacy-rollback/1"' in legacy_rollback
            and "REQUIRED_MEMBERS" in legacy_rollback
            and "LocalStore.kt" in legacy_rollback
            and "LegacyOaepBackfill.kt" in legacy_rollback
            and "backend/gateway.py" in legacy_rollback
            and "backend/runtime/journal.py" in legacy_rollback
            and "runtime-relay.openapi.json" in legacy_rollback
            and "p5_legacy_rollback_member_set_invalid" in legacy_rollback
            and "p5_legacy_rollback_archive_size_exceeded" in legacy_rollback
            and "stat.S_IFLNK" in legacy_rollback
            and "p5_legacy_rollback_manifest_digest_mismatch" in legacy_rollback
            and "build_rollback_artifact" in legacy_rollback_builder
            and "validate_rollback_artifact" in p5_finalizer
            and "p5_legacy_rollback_content_invalid" in p5_finalizer,
            "p5_legacy_rollback_content_gate_missing")
    require("downgrade_empty_oaep_schema" in legacy_migration_collector
            and "migration_transcript_before_sha256" in legacy_migration_collector
            and "migration_transcript_after_sha256" in legacy_migration_collector
            and "rollback_artifact_sha256" in legacy_migration_collector
            and "p5_legacy_migration_evidence_invalid" in legacy_removal_gate,
            "p5_legacy_physical_migration_collector_missing")
    require("authoritative_schema_hash" in public_oaep_smoke
            and "x-oaep-schema-sha256" in public_oaep_smoke
            and "local OAEP and Relay schema hashes drift" in public_oaep_smoke
            and "c502943a3c0c582aba71d9495abe148738a9ff62aa119359e305f74d04950277"
            not in public_oaep_smoke,
            "p5_public_oaep_smoke_hash_is_stale")
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
    require("LONG_SESSION_FEATURE_IDS" in p5_long_session_driver
            and '"P5-M06-F02"' in p5_long_session_driver
            and "validate_acceptance_report" in p5_long_session_driver
            and "EXPECTED_BUDGETS" in p5_long_session_driver
            and "BUILD_VARIANTS" in p5_long_session_driver
            and '"release"' in p5_long_session_driver
            and "report_from_instrumentation" in p5_long_session_driver
            and "p5LongSessionReportBase64" in p5_long_session_test
            and "LONG_SESSION_FEATURE_SET" in p5_finalizer
            and "validate_long_session_acceptance" in p5_finalizer
            and "p5_long_session_feature_mapping_invalid" in p5_finalizer
            and "expected_build_sha256" in p5_finalizer
            and 'required_build_type="release"' in p5_finalizer
            and "test_finalize_remote_workspace_p5.py" in p5_local_gate
            and "test_assemble_remote_workspace_p5_evidence.py" in p5_local_gate,
            "p5_long_session_semantic_evidence_gate_missing")
    require("inspect_android_apk" in p5_android_apk
            and '"apksigner.bat"' in p5_android_apk
            and '"aapt.exe"' in p5_android_apk
            and "p5_android_apk_package_mismatch" in p5_android_apk
            and "p5_android_test_target_mismatch" in p5_android_apk
            and "signing_cert_sha256" in p5_android_apk
            and "inspect_android_apk" in p5_evidence_assembler
            and "p5_manifest_build_version_mismatch" in p5_evidence_assembler
            and "p5_build_apk_identity_mismatch" in p5_finalizer
            and "p5_long_session_test_apk_signer_mismatch" in p5_finalizer
            and "scripts/test_p5_android_apk.py" in p5_local_gate,
            "p5_android_apk_physical_identity_gate_missing")
    require("-keep class kotlin.** { *; }" in android_proguard
            and "-keep class androidx.tracing.** { *; }" in android_proguard,
            "p5_release_instrumentation_kotlin_abi_gate_missing")
    require('androidTestImplementation("androidx.tracing:tracing:1.2.0")' in android_build
            and "-keep class androidx.test.** { *; }" in android_test_proguard
            and "-keep class androidx.tracing.** { *; }" in android_test_proguard,
            "p5_release_android_test_runner_abi_gate_missing")
    require('KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")'
            in p5_android_secret_test
            and 'Cipher.getInstance("AES/GCM/NoPadding")' in p5_android_secret_test
            and "EncryptedSharedPreferences" not in p5_android_secret_test
            and "MasterKey" not in p5_android_secret_test,
            "p5_android_secret_probe_not_platform_keystore_bound")
    require("StreamingBytePatternScanner" in p5_android_secret_test
            and "readBytes()" not in p5_android_secret_test
            and "64 * 1024" in p5_android_streaming_scanner
            and "state = nodes[state].transitions" in p5_android_streaming_scanner,
            "p5_android_secret_scan_not_streaming")
    signer_values = p5_android_signer_policy.get("allowed_cert_sha256") \
        if isinstance(p5_android_signer_policy, dict) else None
    require(isinstance(p5_android_signer_policy, dict)
            and set(p5_android_signer_policy) == {
                "schema_version", "status", "allowed_cert_sha256",
            }
            and p5_android_signer_policy.get("schema_version")
            == "p5-android-release-signers/1"
            and p5_android_signer_policy.get("status") in {"not_configured", "active"}
            and isinstance(signer_values, list)
            and len(signer_values) == len(set(signer_values))
            and all(isinstance(item, str) and len(item) == 64
                    and all(character in "0123456789abcdef" for character in item)
                    for item in signer_values)
            and ((p5_android_signer_policy["status"] == "active" and bool(signer_values))
                 or (p5_android_signer_policy["status"] == "not_configured" and not signer_values))
            and "release_signer_is_trusted" in p5_android_apk
            and "CN=Android Debug" in p5_android_apk
            and "android_signer_policy_sha256" in p5_evidence_assembler
            and "p5_android_signer_policy_drift" in p5_finalizer
            and "p5_release_signer_untrusted" in p5_finalizer,
            "p5_android_release_signer_trust_policy_invalid")
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
    require(legacy_inventory.get("schema_version")
            == "opendrsai.remote-workspace-legacy-inventory/1"
            and legacy_inventory.get("policy", {}).get(
                "long_observation_window_required") is False
            and len(legacy_inventory.get("items", [])) == 11
            and all(item.get("rollback_owner_included") is True
                    for item in legacy_inventory.get("items", []))
            and "p6_oaep_core_depends_on_legacy" in legacy_inventory_generator
            and "remote-workspace-legacy-inventory.json" in legacy_rollback
            and "two_release_cycles" not in desktop_legacy_telemetry
            and "fourteen_observation_days" not in desktop_legacy_telemetry,
            "p6_legacy_inventory_or_retirement_boundary_invalid")

    print("P5 remote workspace architecture verification passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
