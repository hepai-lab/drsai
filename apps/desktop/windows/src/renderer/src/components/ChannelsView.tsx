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
  const [draftingAdapterId, setDraftingAdapterId] = useState<string | null>(null);
  const [routingEventId, setRoutingEventId] = useState<string | null>(null);

  async function loadAdapters(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [adapters, deliveries, inbound] = await Promise.all([
        desktopApi.listChannelAdapters(workspacePath),
        desktopApi.listChannelOutboundDeliveries({ workspacePath, limit: 6 }),
        desktopApi.listChannelInboundEvents({ workspacePath, limit: 6 }),
      ]);
      setResult(adapters);
      setOutboundDeliveries(deliveries);
      setInboundEvents(inbound);
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

  async function configureProviderSession(adapter: DesktopChannelAdapter): Promise<void> {
    setConfiguringAdapterId(adapter.id);
    setImportError(null);
    setConfigureResult(null);
    try {
      const configured = await desktopApi.configureChannelAdapter({
        adapterId: adapter.id,
        workspacePath,
        mode: "session_stub",
        accountLabel: `${adapter.name} account`,
        scopeLabel: `${adapter.provider}:workspace`,
        credentialState: "placeholder",
      });
      setConfigureResult(configured);
      await loadAdapters();
    } catch (loadError) {
      setImportError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to configure provider session.",
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
          target: `${adapter.provider}:review-target`,
          subject: "DrSai channel draft",
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
              onConfigureSession={configureProviderSession}
              onStartAuth={startAdapterAuth}
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
              onConfigureSession={configureProviderSession}
              onStartAuth={startAdapterAuth}
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
              onConfigureSession={configureProviderSession}
              onStartAuth={startAdapterAuth}
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

function ChannelAdapterCard({
  adapter,
  importing,
  configuring,
  authStarting,
  drafting,
  language,
  onConfigure,
  onConfigureSession,
  onStartAuth,
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
  onConfigureSession: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onStartAuth: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onImport: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onPickFiles: (adapter: DesktopChannelAdapter) => void | Promise<void>;
  onQueueOutboundDraft: (adapter: DesktopChannelAdapter) => void | Promise<void>;
}): React.JSX.Element {
  const zh = language === "zh";
  const Icon = providerIcons[adapter.provider];
  const canConfigureLocalGitHub =
    adapter.id === "github-connector" && adapter.authMode !== "local_git_remote";
  const canConfigureProviderSession =
    ["slack-chat", "github-connector", "docs-connector", "calendar-connector"].includes(
      adapter.id,
    ) && adapter.authMode !== "session_stub";
  const canStartAuth = ["mobile-chat", "slack-chat", "github-connector", "docs-connector", "calendar-connector"].includes(
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
        <span>{adapter.configured ? (zh ? "已配置" : "Configured") : zh ? "未配置" : "Not configured"}</span>
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
      {canConfigureProviderSession && (
        <button
          type="button"
          className="channel-import-button"
          onClick={() => void onConfigureSession(adapter)}
          disabled={configuring}
        >
          <KeyRound size={15} />
          {configuring ? "Configuring" : "Configure session"}
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
        <button
          type="button"
          className="channel-import-button"
          onClick={() => void onQueueOutboundDraft(adapter)}
          disabled={drafting}
        >
          <Send size={15} />
          {drafting ? "Queueing" : "Queue draft approval"}
        </button>
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
