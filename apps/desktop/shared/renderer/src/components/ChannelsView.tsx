import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Database,
  FileSearch,
  FileText,
  FolderOpen,
  GitBranch,
  KeyRound,
  MessageSquare,
  Mic,
  RefreshCw,
  Send,
  Smartphone,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  DesktopChannelAdapter,
  DesktopChannelAdapterAuthStartResult,
  DesktopChannelAdapterConfigureResult,
  DesktopChannelAdapterListResult,
  DesktopChannelAdapterProvider,
  DesktopChannelContextImportResult,
  DesktopChannelInboundEvent,
  DesktopChannelOutboundDelivery,
  DesktopChannelOutboundDraftResult,
  DesktopChannelSnapshotSyncResult,
  DesktopExternalConnectionReadiness,
  DesktopExternalConnectionReadinessResult,
} from "@shared/desktopApi";
import type { AppLanguage } from "../navigation";
import { desktopApi } from "../desktopApi";

const providerIcons: Record<DesktopChannelAdapterProvider, LucideIcon> = {
  mobile: Smartphone,
  slack: MessageSquare,
  github: GitBranch,
  docs: FileText,
  calendar: CalendarDays,
  database: Database,
  telegram: MessageSquare,
  discord: MessageSquare,
  voice: Mic,
  file_upload: FileText,
};

export function ChannelsView({
  language,
  onAttachImportedContext,
  workspacePath,
}: {
  language: AppLanguage;
  onAttachImportedContext?: (result: DesktopChannelContextImportResult) => void;
  workspacePath: string;
}): React.JSX.Element {
  const zh = language === "zh";
  const [result, setResult] = useState<DesktopChannelAdapterListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<DesktopChannelContextImportResult | null>(null);
  const [outboundResult, setOutboundResult] =
    useState<DesktopChannelOutboundDraftResult | null>(null);
  const [snapshotSyncResult, setSnapshotSyncResult] =
    useState<DesktopChannelSnapshotSyncResult | null>(null);
  const [externalReadiness, setExternalReadiness] =
    useState<DesktopExternalConnectionReadinessResult | null>(null);
  const [outboundDeliveries, setOutboundDeliveries] = useState<
    DesktopChannelOutboundDelivery[]
  >([]);
  const [inboundEvents, setInboundEvents] = useState<DesktopChannelInboundEvent[]>([]);
  const [configureResult, setConfigureResult] =
    useState<DesktopChannelAdapterConfigureResult | null>(null);
  const [authResult, setAuthResult] =
    useState<DesktopChannelAdapterAuthStartResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [importingAdapterId, setImportingAdapterId] = useState<string | null>(null);
  const [syncingSnapshots, setSyncingSnapshots] = useState(false);
  const [configuringAdapterId, setConfiguringAdapterId] = useState<string | null>(null);
  const [authStartingAdapterId, setAuthStartingAdapterId] = useState<string | null>(null);
  const [liveRepository, setLiveRepository] = useState("");
  const [slackToken, setSlackToken] = useState("");
  const [slackChannel, setSlackChannel] = useState("");
  const [outboundTarget, setOutboundTarget] = useState("");
  const [docsToken, setDocsToken] = useState("");
  const [docsDocumentId, setDocsDocumentId] = useState("");
  const [calendarToken, setCalendarToken] = useState("");
  const [calendarId, setCalendarId] = useState("primary");
  const [draftingAdapterId, setDraftingAdapterId] = useState<string | null>(null);
  const [routingEventId, setRoutingEventId] = useState<string | null>(null);

  async function loadAdapters(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [adapters, deliveries, inbound, readiness] = await Promise.all([
        desktopApi.listChannelAdapters(workspacePath),
        desktopApi.listChannelOutboundDeliveries({ workspacePath, limit: 6 }),
        desktopApi.listChannelInboundEvents({ workspacePath, limit: 6 }),
        desktopApi.listExternalConnectionReadiness(workspacePath),
      ]);
      setResult(adapters);
      setOutboundDeliveries(deliveries);
      setInboundEvents(inbound);
      setExternalReadiness(readiness);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load channel adapters.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAdapters();
  }, [workspacePath]);

  async function configureAdapter(adapter: DesktopChannelAdapter): Promise<void> {
    setConfiguringAdapterId(adapter.id);
    setImportError(null);
    setConfigureResult(null);
    try {
      const configured = await desktopApi.configureChannelAdapter({
        adapterId: adapter.id,
        workspacePath,
        mode: "local_git_remote",
      });
      setConfigureResult(configured);
      await loadAdapters();
    } catch (loadError) {
      setImportError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to configure channel adapter.",
      );
    } finally {
      setConfiguringAdapterId(null);
    }
  }

  async function startAdapterAuth(adapter: DesktopChannelAdapter): Promise<void> {
    setAuthStartingAdapterId(adapter.id);
    setImportError(null);
    setAuthResult(null);
    try {
      const started = await desktopApi.startChannelAdapterAuth({
        adapterId: adapter.id,
        workspacePath,
      });
      setAuthResult(started);
      await loadAdapters();
    } catch (loadError) {
      setImportError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to prepare connector authorization.",
      );
    } finally {
      setAuthStartingAdapterId(null);
    }
  }

  async function pollAdapterAuth(adapter: DesktopChannelAdapter): Promise<void> {
    const operationId = authResult?.adapterId === adapter.id ? authResult.operationId : adapter.authOperationId;
    if (!operationId) return;
    setAuthStartingAdapterId(adapter.id); setImportError(null);
    try {
      const polled = await desktopApi.pollChannelAdapterAuth({ adapterId: adapter.id, workspacePath, operationId });
      if (polled.status === "complete") { setAuthResult(null); await loadAdapters(); }
      else setImportError(polled.message);
    } catch (loadError) { setImportError(loadError instanceof Error ? loadError.message : "Unable to check connector authorization."); }
    finally { setAuthStartingAdapterId(null); }
  }

  async function revokeAdapterAuth(adapter: DesktopChannelAdapter): Promise<void> {
    setAuthStartingAdapterId(adapter.id); setImportError(null);
    try { const result = await desktopApi.revokeChannelAdapterAuth({ adapterId: adapter.id, workspacePath }); setConfigureResult(null); setImportError(result.message); await loadAdapters(); }
    catch (loadError) { setImportError(loadError instanceof Error ? loadError.message : "Unable to revoke connector authorization."); }
    finally { setAuthStartingAdapterId(null); }
  }

  async function syncLiveProvider(adapter: DesktopChannelAdapter): Promise<void> {
    setImportingAdapterId(adapter.id); setImportError(null);
    try { const imported = await desktopApi.syncLiveChannelContext({ adapterId: adapter.id, workspacePath, ...(adapter.id === "slack-chat" ? { channelId: slackChannel } : adapter.id === "docs-connector" ? { documentId: docsDocumentId } : adapter.id === "calendar-connector" ? { calendarId } : { repository: liveRepository }), limit: 10 }); setImportResult(imported); setInboundEvents(await desktopApi.listChannelInboundEvents({ workspacePath, limit: 6 })); }
    catch (loadError) { setImportError(loadError instanceof Error ? loadError.message : "Unable to sync live provider context."); }
    finally { setImportingAdapterId(null); }
  }

  async function configureSlackToken(): Promise<void> {
    setAuthStartingAdapterId("slack-chat"); setImportError(null);
    try { const result = await desktopApi.configureChannelProviderToken({ adapterId: "slack-chat", workspacePath, token: slackToken }); setSlackToken(""); setImportError(result.message); await loadAdapters(); }
    catch (loadError) { setImportError(loadError instanceof Error ? loadError.message : "Unable to authorize Slack connector."); }
    finally { setAuthStartingAdapterId(null); }
  }

  async function configureDocsToken(): Promise<void> {
    setAuthStartingAdapterId("docs-connector"); setImportError(null);
    try { const result = await desktopApi.configureChannelProviderToken({ adapterId: "docs-connector", workspacePath, token: docsToken }); setDocsToken(""); setImportError(result.message); await loadAdapters(); }
    catch (loadError) { setImportError(loadError instanceof Error ? loadError.message : "Unable to authorize Google Docs connector."); }
    finally { setAuthStartingAdapterId(null); }
  }

  async function configureCalendarToken(): Promise<void> {
    setAuthStartingAdapterId("calendar-connector"); setImportError(null);
    try { const result = await desktopApi.configureChannelProviderToken({ adapterId: "calendar-connector", workspacePath, token: calendarToken }); setCalendarToken(""); setImportError(result.message); await loadAdapters(); }
    catch (loadError) { setImportError(loadError instanceof Error ? loadError.message : "Unable to authorize Google Calendar connector."); }
    finally { setAuthStartingAdapterId(null); }
  }

  async function importContext(adapter: DesktopChannelAdapter): Promise<void> {
    setImportingAdapterId(adapter.id);
    setImportError(null);
    try {
      const imported = await desktopApi.importChannelContext({
          adapterId: adapter.id,
          workspacePath,
          limit: 6,
      });
      setImportResult(imported);
      setInboundEvents(await desktopApi.listChannelInboundEvents({ workspacePath, limit: 6 }));
    } catch (loadError) {
      setImportError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to import channel context.",
      );
    } finally {
      setImportingAdapterId(null);
    }
  }

  async function pickFileContext(adapter: DesktopChannelAdapter): Promise<void> {
    setImportingAdapterId(adapter.id);
    setImportError(null);
    try {
      const picked = await desktopApi.pickFiles();
      if (picked.canceled || picked.paths.length === 0) return;
      const imported = await desktopApi.importChannelContext({
        adapterId: adapter.id,
        workspacePath,
        paths: picked.paths,
        limit: 6,
      });
      setImportResult(imported);
      setInboundEvents(await desktopApi.listChannelInboundEvents({ workspacePath, limit: 6 }));
    } catch (loadError) {
      setImportError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to import selected file context.",
      );
    } finally {
      setImportingAdapterId(null);
    }
  }

  async function syncSnapshots(): Promise<void> {
    setSyncingSnapshots(true);
    setImportError(null);
    setSnapshotSyncResult(null);
    try {
      const synced = await desktopApi.syncChannelSnapshots({
        workspacePath,
        adapterIds: ["mobile-chat", "slack-chat", "github-connector", "docs-connector", "calendar-connector", "database-connector", "logs-monitor"],
        limit: 6,
      });
      setSnapshotSyncResult(synced);
      setInboundEvents(await desktopApi.listChannelInboundEvents({ workspacePath, limit: 6 }));
      await loadAdapters();
    } catch (syncError) {
      setImportError(
        syncError instanceof Error
          ? syncError.message
          : "Unable to sync connector snapshots.",
      );
    } finally {
      setSyncingSnapshots(false);
    }
  }

  async function queueOutboundDraft(adapter: DesktopChannelAdapter): Promise<void> {
    setDraftingAdapterId(adapter.id);
    setImportError(null);
    setOutboundResult(null);
    try {
      setOutboundResult(
        await desktopApi.proposeChannelOutboundDraft({
          adapterId: adapter.id,
          workspacePath,
          target: outboundTarget.trim() || `${adapter.provider}:review-target`,
          subject: "OpenDrSai channel draft",
          body: `Draft prepared from the ${adapter.name} adapter. Approval Center must approve before a live connector runtime can send it.`,
          idempotencyKey: `channels-view:${adapter.id}:demo-draft`,
        }),
      );
      setOutboundDeliveries(
        await desktopApi.listChannelOutboundDeliveries({ workspacePath, limit: 6 }),
      );
    } catch (loadError) {
      setImportError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to queue outbound channel draft.",
      );
    } finally {
      setDraftingAdapterId(null);
    }
  }

  async function routeInboundEvent(event: DesktopChannelInboundEvent): Promise<void> {
    setRoutingEventId(event.id);
    setImportError(null);
    try {
      const routed = await desktopApi.routeChannelInboundEvent({
        eventId: event.id,
        workspacePath,
        action: "route_to_chat",
      });
      setImportResult(routed.importResult);
      onAttachImportedContext?.(routed.importResult);
      setInboundEvents(await desktopApi.listChannelInboundEvents({ workspacePath, limit: 6 }));
    } catch (routeError) {
      setImportError(
        routeError instanceof Error
          ? routeError.message
          : "Unable to route inbound channel event.",
      );
    } finally {
      setRoutingEventId(null);
    }
  }

  async function dismissInboundEvent(event: DesktopChannelInboundEvent): Promise<void> {
    setRoutingEventId(event.id);
    setImportError(null);
    try {
      await desktopApi.routeChannelInboundEvent({
        eventId: event.id,
        workspacePath,
        action: "dismiss",
      });
      setInboundEvents(await desktopApi.listChannelInboundEvents({ workspacePath, limit: 6 }));
    } catch (routeError) {
      setImportError(
        routeError instanceof Error
          ? routeError.message
          : "Unable to dismiss inbound channel event.",
      );
    } finally {
      setRoutingEventId(null);
    }
  }

  const groupedAdapters = useMemo(() => {
    const groups: Record<DesktopChannelAdapter["kind"], DesktopChannelAdapter[]> = {
      chat: [],
      connector: [],
      input: [],
    };
    for (const adapter of result?.adapters ?? []) {
      groups[adapter.kind].push(adapter);
    }
    return groups;
  }, [result]);

  return (
    <div className="channels-view">
      <header className="channels-header">
        <div>
          <span>{zh ? "跨渠道适配器" : "Cross-channel adapters"}</span>
          <h2>{zh ? "渠道入口" : "Channels"}</h2>
        </div>
        <div className="channels-header-actions">
          <button
            type="button"
            onClick={() => void syncSnapshots()}
            disabled={syncingSnapshots}
          >
            <FileSearch size={15} />
            {syncingSnapshots ? "Syncing" : "Sync snapshots"}
          </button>
          <button type="button" onClick={() => void loadAdapters()} disabled={loading}>
            <RefreshCw size={15} />
            {loading ? (zh ? "刷新中" : "Refreshing") : zh ? "刷新" : "Refresh"}
          </button>
        </div>
      </header>

      {result && (
        <dl className="channels-summary-grid" aria-label="Channel adapter summary">
          <div>
            <dt>{zh ? "适配器" : "Adapters"}</dt>
            <dd>{result.adapters.length}</dd>
          </div>
          <div>
            <dt>{zh ? "可用" : "Available"}</dt>
            <dd>{result.availableCount}</dd>
          </div>
          <div>
            <dt>{zh ? "已配置" : "Configured"}</dt>
            <dd>{result.configuredCount}</dd>
          </div>
        </dl>
      )}

      {externalReadiness && (
        <section
          className="external-readiness-panel"
          aria-label="External connection readiness"
        >
          <div className="external-readiness-header">
            <div>
              <span>External readiness</span>
              <h3>Connection matrix</h3>
            </div>
            <dl>
              <div>
                <dt>Ready</dt>
                <dd>{externalReadiness.readyCount}</dd>
              </div>
              <div>
                <dt>Partial</dt>
                <dd>{externalReadiness.partialCount}</dd>
              </div>
              <div>
                <dt>Planned</dt>
                <dd>{externalReadiness.plannedCount}</dd>
              </div>
            </dl>
          </div>
          <div className="external-readiness-grid">
            {externalReadiness.connections.map((connection) => (
              <ExternalReadinessCard key={connection.id} connection={connection} />
            ))}
          </div>
          <small>{externalReadiness.verification}</small>
        </section>
      )}

      {error && <div className="channels-error">{error}</div>}
      {importError && <div className="channels-error">{importError}</div>}
      {snapshotSyncResult && (
        <section className="channels-sync-result" aria-label="Connector snapshot sync">
          <span>Snapshot sync</span>
          <h3>{snapshotSyncResult.message}</h3>
          <small>{snapshotSyncResult.verification}</small>
          <p>
            {snapshotSyncResult.queuedEventCount} event(s) queued from{" "}
            {snapshotSyncResult.results.length} connector snapshot(s).
          </p>
        </section>
      )}
      {outboundResult && (
        <section className="channels-outbound-result" aria-label="Outbound channel approval">
          <span>Outbound approval</span>
          <h3>{outboundResult.reason}</h3>
          <small>{outboundResult.verification}</small>
          {outboundResult.approval && (
            <p>
              {outboundResult.approval.title} · {outboundResult.approval.id}
            </p>
          )}
          {outboundResult.delivery && (
            <p>
              {outboundResult.delivery.status}: {outboundResult.delivery.message}
            </p>
          )}
        </section>
      )}
      {outboundDeliveries.length > 0 && (
        <section className="channels-delivery-ledger" aria-label="Recent outbound delivery results">
          <div>
            <span>Connector delivery results</span>
            <h3>Recent outbound runtime outcomes</h3>
          </div>
          <ul>
            {outboundDeliveries.map((delivery) => (
              <li key={delivery.id}>
                <b>{delivery.status}</b>
                <span>
                  {delivery.adapterId} 路 {delivery.target}
                </span>
                <p>{delivery.message}</p>
                {delivery.runtime && <small>Runtime: {delivery.runtime}</small>}
                {delivery.outboxPath && <small>Outbox: {delivery.outboxPath}</small>}
                <small>{delivery.verification}</small>
              </li>
            ))}
          </ul>
        </section>
      )}
      {configureResult && (
        <section className="channels-config-result" aria-label="Channel connector configuration">
          <span>Connector configuration</span>
          <h3>{configureResult.message}</h3>
          <small>{configureResult.verification}</small>
        </section>
      )}
      {authResult && (
        <section className="channels-auth-result" aria-label="Channel connector authorization">
          <span>Connector authorization</span>
          <h3>{authResult.message}</h3>
          <small>{authResult.verification}</small>
          <p>
            Code {authResult.userCode} expires {new Date(authResult.expiresAt).toLocaleString()}.
          </p>
          <p>{authResult.verificationUri}</p>
          {authResult.adapterId === "github-connector" && (
            <button type="button" className="channel-import-button" onClick={() => void desktopApi.openExternal(authResult.verificationUri)}>
              Open GitHub authorization
            </button>
          )}
        </section>
      )}
      {inboundEvents.length > 0 && (
        <section className="channels-inbound-events" aria-label="Inbound channel event queue">
          <div>
            <span>Inbound event routing</span>
            <h3>Recent reviewed channel events</h3>
          </div>
          <ul>
            {inboundEvents.map((event) => (
              <li key={event.id}>
                <b>{event.title}</b>
                <span>
                  {event.status} 路 {event.itemCount} item(s)
                </span>
                <p>{event.summary}</p>
                <div className="channels-inbound-actions">
                  <button
                    type="button"
                    className="channel-import-button"
                    disabled={event.status !== "queued" || routingEventId === event.id}
                    onClick={() => void routeInboundEvent(event)}
                  >
                    <MessageSquare size={15} />
                    {routingEventId === event.id ? "Routing" : "Route to chat"}
                  </button>
                  <button
                    type="button"
                    className="channel-import-button channel-dismiss-button"
                    disabled={event.status !== "queued" || routingEventId === event.id}
                    onClick={() => void dismissInboundEvent(event)}
                  >
                    <XCircle size={15} />
                    {routingEventId === event.id ? "Updating" : "Dismiss"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {importResult && (
        <section className="channels-import-result" aria-label="Imported channel context">
          <div>
            <span>Read-only context import</span>
            <h3>{importResult.message}</h3>
            <small>{importResult.verification}</small>
            <button
              type="button"
              className="channel-import-button"
              disabled={importResult.items.length === 0}
              onClick={() => onAttachImportedContext?.(importResult)}
            >
              <MessageSquare size={15} />
              Attach to chat
            </button>
          </div>
          <ul>
            {importResult.items.map((item) => (
              <li key={item.id}>
                <b>{item.title}</b>
                <span>{item.relativePath}</span>
                <p>{item.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="channels-section" aria-label="Chat channel adapters">
        <h3>{zh ? "聊天入口" : "Chat Entries"}</h3>
        <div className="channels-grid">
          {groupedAdapters.chat.map((adapter) => (
            <ChannelAdapterCard
              key={adapter.id}
              adapter={adapter}
              importing={importingAdapterId === adapter.id}
              configuring={configuringAdapterId === adapter.id}
              authStarting={authStartingAdapterId === adapter.id}
              drafting={draftingAdapterId === adapter.id}
              language={language}
              onConfigure={configureAdapter}
              onStartAuth={startAdapterAuth}
              onPollAuth={pollAdapterAuth}
              onRevokeAuth={revokeAdapterAuth}
              authOperationId={authResult?.adapterId === adapter.id ? authResult.operationId : adapter.authOperationId}
              liveRepository={liveRepository}
              onLiveRepositoryChange={setLiveRepository}
              slackToken={slackToken}
              slackChannel={slackChannel}
              onSlackTokenChange={setSlackToken}
              onSlackChannelChange={setSlackChannel}
              onConfigureSlackToken={configureSlackToken}
              outboundTarget={outboundTarget}
              onOutboundTargetChange={setOutboundTarget}
              docsToken={docsToken}
              docsDocumentId={docsDocumentId}
              onDocsTokenChange={setDocsToken}
              onDocsDocumentIdChange={setDocsDocumentId}
              onConfigureDocsToken={configureDocsToken}
              calendarToken={calendarToken}
              calendarId={calendarId}
              onCalendarTokenChange={setCalendarToken}
              onCalendarIdChange={setCalendarId}
              onConfigureCalendarToken={configureCalendarToken}
              onLiveSync={syncLiveProvider}
              onImport={importContext}
              onPickFiles={pickFileContext}
              onQueueOutboundDraft={queueOutboundDraft}
            />
          ))}
        </div>
      </section>

      <section className="channels-section" aria-label="Connector channel adapters">
        <h3>{zh ? "连接器" : "Connectors"}</h3>
        <div className="channels-grid">
          {groupedAdapters.connector.map((adapter) => (
            <ChannelAdapterCard
              key={adapter.id}
              adapter={adapter}
              importing={importingAdapterId === adapter.id}
              configuring={configuringAdapterId === adapter.id}
              authStarting={authStartingAdapterId === adapter.id}
              drafting={draftingAdapterId === adapter.id}
              language={language}
              onConfigure={configureAdapter}
              onStartAuth={startAdapterAuth}
              onPollAuth={pollAdapterAuth}
              onRevokeAuth={revokeAdapterAuth}
              authOperationId={authResult?.adapterId === adapter.id ? authResult.operationId : adapter.authOperationId}
              liveRepository={liveRepository}
              onLiveRepositoryChange={setLiveRepository}
              slackToken={slackToken}
              slackChannel={slackChannel}
              onSlackTokenChange={setSlackToken}
              onSlackChannelChange={setSlackChannel}
              onConfigureSlackToken={configureSlackToken}
              outboundTarget={outboundTarget}
              onOutboundTargetChange={setOutboundTarget}
              docsToken={docsToken}
              docsDocumentId={docsDocumentId}
              onDocsTokenChange={setDocsToken}
              onDocsDocumentIdChange={setDocsDocumentId}
              onConfigureDocsToken={configureDocsToken}
              calendarToken={calendarToken}
              calendarId={calendarId}
              onCalendarTokenChange={setCalendarToken}
              onCalendarIdChange={setCalendarId}
              onConfigureCalendarToken={configureCalendarToken}
              onLiveSync={syncLiveProvider}
              onImport={importContext}
              onPickFiles={pickFileContext}
              onQueueOutboundDraft={queueOutboundDraft}
            />
          ))}
        </div>
      </section>

      <section className="channels-section" aria-label="Input channel adapters">
        <h3>{zh ? "输入方式" : "Inputs"}</h3>
        <div className="channels-grid">
          {groupedAdapters.input.map((adapter) => (
            <ChannelAdapterCard
              key={adapter.id}
              adapter={adapter}
              importing={importingAdapterId === adapter.id}
              configuring={configuringAdapterId === adapter.id}
              authStarting={authStartingAdapterId === adapter.id}
              drafting={draftingAdapterId === adapter.id}
              language={language}
              onConfigure={configureAdapter}
              onStartAuth={startAdapterAuth}
              onPollAuth={pollAdapterAuth}
              onRevokeAuth={revokeAdapterAuth}
              authOperationId={authResult?.adapterId === adapter.id ? authResult.operationId : adapter.authOperationId}
              liveRepository={liveRepository}
              onLiveRepositoryChange={setLiveRepository}
              slackToken={slackToken}
              slackChannel={slackChannel}
              onSlackTokenChange={setSlackToken}
              onSlackChannelChange={setSlackChannel}
              onConfigureSlackToken={configureSlackToken}
              outboundTarget={outboundTarget}
              onOutboundTargetChange={setOutboundTarget}
              docsToken={docsToken}
              docsDocumentId={docsDocumentId}
              onDocsTokenChange={setDocsToken}
              onDocsDocumentIdChange={setDocsDocumentId}
              onConfigureDocsToken={configureDocsToken}
              calendarToken={calendarToken}
              calendarId={calendarId}
              onCalendarTokenChange={setCalendarToken}
              onCalendarIdChange={setCalendarId}
              onConfigureCalendarToken={configureCalendarToken}
              onLiveSync={syncLiveProvider}
              onImport={importContext}
              onPickFiles={pickFileContext}
              onQueueOutboundDraft={queueOutboundDraft}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ExternalReadinessCard({
  connection,
}: {
  connection: DesktopExternalConnectionReadiness;
}): React.JSX.Element {
  return (
    <article className={`external-readiness-card ${connection.status}`}>
      <div>
        <span>{connection.id}</span>
        <b>{connection.name}</b>
        <em>{formatExternalStatus(connection.status)}</em>
      </div>
      <dl>
        <div>
          <dt>Mode</dt>
          <dd>{connection.readOnly ? "Read-only" : "Writable"}</dd>
        </div>
        <div>
          <dt>Config</dt>
          <dd>{connection.configured ? "Configured" : "Needs setup"}</dd>
        </div>
      </dl>
      <ul>
        {connection.capabilitySources.slice(0, 4).map((source) => (
          <li key={source}>{source}</li>
        ))}
      </ul>
      <p>{connection.evidence[0]}</p>
      <div className="external-readiness-gaps" aria-label={`${connection.name} remaining gaps`}>
        <span>Remaining gaps</span>
        <ul>
          {connection.gaps.slice(0, 3).map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      </div>
      {connection.reconnectReadinessChecks && (
        <div
          className="external-readiness-checks"
          aria-label={`${connection.name} reconnect readiness checks`}
        >
          <span>Reconnect readiness</span>
          <ul>
            {connection.reconnectReadinessChecks.slice(0, 4).map((check) => (
              <li key={check}>{check}</li>
            ))}
          </ul>
        </div>
      )}
      {connection.reconnectPolicy && (
        <div
          className="external-readiness-reconnect"
          aria-label={`${connection.name} reconnect review policy`}
        >
          <span>Reconnect review</span>
          <b>{connection.reconnectPolicy.automatic ? "Automatic" : "Manual approval"}</b>
          <ul>
            {connection.reconnectPolicy.triggers.slice(0, 2).map((trigger) => (
              <li key={trigger}>{trigger}</li>
            ))}
          </ul>
          <small>{connection.reconnectPolicy.safeguards[0]}</small>
          <small>{connection.reconnectPolicy.verification}</small>
        </div>
      )}
      <small>{connection.approvalBoundary}</small>
      <small className="external-readiness-verification">{connection.verification}</small>
    </article>
  );
}

function formatExternalStatus(
  status: DesktopExternalConnectionReadiness["status"],
): string {
  return {
    available: "Ready",
    partial: "Partial",
    planned: "Planned",
  }[status];
}

function ChannelAdapterCard({
  adapter,
  importing,
  configuring,
  authStarting,
  drafting,
  language,
  onConfigure,
  onStartAuth,
  onPollAuth,
  onRevokeAuth,
  authOperationId,
  liveRepository,
  onLiveRepositoryChange,
  slackToken,
  slackChannel,
  onSlackTokenChange,
  onSlackChannelChange,
  onConfigureSlackToken,
  outboundTarget,
  onOutboundTargetChange,
  docsToken,
  docsDocumentId,
  onDocsTokenChange,
  onDocsDocumentIdChange,
  onConfigureDocsToken,
  calendarToken,
  calendarId,
  onCalendarTokenChange,
  onCalendarIdChange,
  onConfigureCalendarToken,
  onLiveSync,
  onImport,
  onPickFiles,
  onQueueOutboundDraft,
}: {
  adapter: DesktopChannelAdapter;
  importing: boolean;
  configuring: boolean;
  authStarting: boolean;
  drafting: boolean;
  language: AppLanguage;
  onConfigure: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onStartAuth: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onPollAuth: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onRevokeAuth: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  authOperationId?: string;
  liveRepository: string;
  onLiveRepositoryChange: (value: string) => void;
  slackToken: string;
  slackChannel: string;
  onSlackTokenChange: (value: string) => void;
  onSlackChannelChange: (value: string) => void;
  onConfigureSlackToken: () => void | Promise<void>;
  outboundTarget: string;
  onOutboundTargetChange: (value: string) => void;
  docsToken: string;
  docsDocumentId: string;
  onDocsTokenChange: (value: string) => void;
  onDocsDocumentIdChange: (value: string) => void;
  onConfigureDocsToken: () => void | Promise<void>;
  calendarToken: string;
  calendarId: string;
  onCalendarTokenChange: (value: string) => void;
  onCalendarIdChange: (value: string) => void;
  onConfigureCalendarToken: () => void | Promise<void>;
  onLiveSync: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onImport: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onPickFiles: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onQueueOutboundDraft: (adapter: DesktopChannelAdapter) => void | Promise<void>;
}): React.JSX.Element {
  const zh = language === "zh";
  const Icon = providerIcons[adapter.provider];
  const canConfigureLocalGitHub =
    adapter.id === "github-connector" && adapter.authMode !== "local_git_remote";
  const canStartAuth = ["mobile-chat", "github-connector"].includes(
    adapter.id,
  );
  const canImportContext =
    adapter.id === "file-input" ||
    adapter.id === "mobile-chat" ||
    adapter.id === "slack-chat" ||
    adapter.id === "docs-connector" ||
    adapter.id === "calendar-connector" ||
    adapter.id === "database-connector" ||
    adapter.id === "logs-monitor" ||
    adapter.id === "voice-input" ||
    (adapter.id === "github-connector" && adapter.status === "available" && adapter.configured);
  const canQueueOutboundDraft =
    adapter.id !== "file-input" &&
    adapter.requiresApproval &&
    adapter.direction !== "inbound";
  const canPickFiles = adapter.id === "file-input";
  return (
    <article className={`channel-adapter-card ${adapter.status}`}>
      <div className="channel-adapter-card-header">
        <span className="channel-adapter-icon">
          <Icon size={18} />
        </span>
        <div>
          <h4>{adapter.name}</h4>
          <span>{formatDirection(adapter.direction, language)}</span>
        </div>
        <b>{formatStatus(adapter.status, language)}</b>
      </div>
      <p>{adapter.description}</p>
      <div className="channel-adapter-meta">
        <span>{adapter.configured ? (zh ? "已验证配置" : "Verified configuration") : adapter.authPreparedAt ? (zh ? "授权尚未完成" : "Authorization incomplete") : zh ? "未配置" : "Not configured"}</span>
        <span>{adapter.requiresApproval ? (zh ? "需要审批" : "Approval required") : zh ? "无需审批" : "No approval gate"}</span>
        {adapter.authMode && adapter.authMode !== "not_configured" && (
          <span>{adapter.authMode}</span>
        )}
        {adapter.credentialState && <span>{adapter.credentialState}</span>}
        {adapter.authPreparedAt && <span>auth prepared</span>}
      </div>
      {(adapter.accountLabel || adapter.scopeLabel) && (
        <p className="channel-adapter-scope">
          {[adapter.accountLabel, adapter.scopeLabel].filter(Boolean).join(" / ")}
        </p>
      )}
      <ul>
        {adapter.capabilities.map((capability) => (
          <li key={capability}>{capability}</li>
        ))}
      </ul>
      {canConfigureLocalGitHub && (
        <button
          type="button"
          className="channel-import-button"
          onClick={() => void onConfigure(adapter)}
          disabled={configuring}
        >
          <GitBranch size={15} />
          {configuring ? "Configuring" : "Use local Git remote"}
        </button>
      )}
      {canStartAuth && (
        <button
          type="button"
          className="channel-import-button"
          onClick={() => void onStartAuth(adapter)}
          disabled={authStarting}
        >
          <KeyRound size={15} />
          {authStarting ? "Preparing" : "Prepare auth"}
        </button>
      )}
      {adapter.id === "github-connector" && authOperationId && !adapter.configured && (
        <button type="button" className="channel-import-button" onClick={() => void onPollAuth(adapter)} disabled={authStarting}><KeyRound size={15} />{authStarting ? "Checking" : "Check authorization"}</button>
      )}
      {adapter.id === "github-connector" && adapter.authMode === "oauth" && adapter.configured && (
        <><input value={liveRepository} onChange={(event) => onLiveRepositoryChange(event.target.value)} placeholder="owner/repository" aria-label="GitHub live repository" /><button type="button" className="channel-import-button" onClick={() => void onLiveSync(adapter)} disabled={importing || !liveRepository.trim()}>{importing ? "Syncing" : "Sync live issues / PRs"}</button><button type="button" className="channel-import-button" onClick={() => void onRevokeAuth(adapter)} disabled={authStarting}>{authStarting ? "Revoking" : "Revoke authorization"}</button></>
      )}
      {adapter.id === "slack-chat" && !adapter.configured && (
        <><input type="password" value={slackToken} onChange={(event) => onSlackTokenChange(event.target.value)} placeholder="xoxb-…" autoComplete="off" aria-label="Slack bot token" /><button type="button" className="channel-import-button" onClick={() => void onConfigureSlackToken()} disabled={authStarting || !slackToken.trim()}>{authStarting ? "Verifying" : "Verify bot token"}</button></>
      )}
      {adapter.id === "slack-chat" && adapter.authMode === "provider_token" && adapter.configured && (
        <><input value={slackChannel} onChange={(event) => onSlackChannelChange(event.target.value.toUpperCase())} placeholder="C0123456789" aria-label="Slack channel ID" /><button type="button" className="channel-import-button" onClick={() => void onLiveSync(adapter)} disabled={importing || !slackChannel.trim()}>{importing ? "Syncing" : "Sync live history"}</button><button type="button" className="channel-import-button" onClick={() => void onRevokeAuth(adapter)} disabled={authStarting}>{authStarting ? "Revoking" : "Revoke authorization"}</button></>
      )}
      {adapter.id === "docs-connector" && !adapter.configured && (
        <><input type="password" value={docsToken} onChange={(event) => onDocsTokenChange(event.target.value)} placeholder="ya29.…" autoComplete="off" aria-label="Google OAuth access token" /><button type="button" className="channel-import-button" onClick={() => void onConfigureDocsToken()} disabled={authStarting || !docsToken.trim()}>{authStarting ? "Verifying" : "Verify Google token"}</button></>
      )}
      {adapter.id === "docs-connector" && adapter.authMode === "provider_token" && adapter.configured && (
        <><input value={docsDocumentId} onChange={(event) => onDocsDocumentIdChange(event.target.value)} placeholder="Google document ID or URL" aria-label="Google document ID" /><button type="button" className="channel-import-button" onClick={() => void onLiveSync(adapter)} disabled={importing || !docsDocumentId.trim()}>{importing ? "Syncing" : "Sync live document"}</button><button type="button" className="channel-import-button" onClick={() => void onRevokeAuth(adapter)} disabled={authStarting}>{authStarting ? "Revoking" : "Revoke authorization"}</button></>
      )}
      {adapter.id === "calendar-connector" && !adapter.configured && (
        <><input type="password" value={calendarToken} onChange={(event) => onCalendarTokenChange(event.target.value)} placeholder="ya29.…" autoComplete="off" aria-label="Google Calendar OAuth access token" /><button type="button" className="channel-import-button" onClick={() => void onConfigureCalendarToken()} disabled={authStarting || !calendarToken.trim()}>{authStarting ? "Verifying" : "Verify Calendar token"}</button></>
      )}
      {adapter.id === "calendar-connector" && adapter.authMode === "provider_token" && adapter.configured && (
        <><input value={calendarId} onChange={(event) => onCalendarIdChange(event.target.value)} placeholder="primary or calendar@example.com" aria-label="Google Calendar ID" /><button type="button" className="channel-import-button" onClick={() => void onLiveSync(adapter)} disabled={importing || !calendarId.trim()}>{importing ? "Syncing" : "Sync next 7 days"}</button><button type="button" className="channel-import-button" onClick={() => void onRevokeAuth(adapter)} disabled={authStarting}>{authStarting ? "Revoking" : "Revoke authorization"}</button></>
      )}
      {canImportContext && (
        <button
          type="button"
          className="channel-import-button"
          onClick={() => void onImport(adapter)}
          disabled={importing}
        >
          <FileSearch size={15} />
          {importing ? "Importing" : "Import context"}
        </button>
      )}
      {canPickFiles && (
        <button
          type="button"
          className="channel-import-button"
          onClick={() => void onPickFiles(adapter)}
          disabled={importing}
        >
          <FolderOpen size={15} />
          {importing ? "Importing" : "Pick files"}
        </button>
      )}
      {canQueueOutboundDraft && (
        <><input value={outboundTarget} onChange={(event) => onOutboundTargetChange(event.target.value)} placeholder={adapter.id === "slack-chat" ? "Slack channel ID" : adapter.id === "github-connector" ? "owner/repository#issue" : "Reviewed delivery target"} aria-label={`${adapter.name} outbound target`} /><button
          type="button"
          className="channel-import-button"
          onClick={() => void onQueueOutboundDraft(adapter)}
          disabled={drafting || !outboundTarget.trim()}
        >
          <Send size={15} />
          {drafting ? "Queueing" : "Queue draft approval"}
        </button></>
      )}
      {adapter.setupHint && <small>{adapter.setupHint}</small>}
    </article>
  );
}

function formatStatus(
  status: DesktopChannelAdapter["status"],
  language: AppLanguage,
): string {
  const zh = language === "zh";
  return {
    available: zh ? "可用" : "Available",
    config_required: zh ? "需配置" : "Needs config",
    planned: zh ? "规划中" : "Planned",
    disabled: zh ? "停用" : "Disabled",
  }[status];
}

function formatDirection(
  direction: DesktopChannelAdapter["direction"],
  language: AppLanguage,
): string {
  const zh = language === "zh";
  return {
    inbound: zh ? "输入" : "Inbound",
    outbound: zh ? "输出" : "Outbound",
    bidirectional: zh ? "双向" : "Bidirectional",
  }[direction];
}
