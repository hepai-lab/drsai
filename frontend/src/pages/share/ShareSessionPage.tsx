import { Spin } from "antd";
import React, { useEffect, useMemo, useState } from "react";
import { useLang } from "../../i18n/useLang";
import { sessionAPI } from "../../components/views/api";
import type { Run, Session } from "../../components/types/datamodel";
import RunView from "../chat/runview";
import { getAgentConfig, shouldShowPanel } from "../chat/config/agentConfigs";

function normalizeRun(raw: Run, sessionId: number): Run {
  return {
    ...raw,
    id: String(raw.id),
    session_id: sessionId,
    messages: raw.messages ?? [],
    team_result: raw.team_result ?? null,
    task: raw.task ?? { source: "user", content: "" },
  };
}

const ShareSessionPage: React.FC = () => {
  const { t } = useLang();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [isPanelMinimized, setIsPanelMinimized] = useState(false);
  const [showPanel, setShowPanel] = useState(false);

  const shareToken = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token")?.trim() ?? "";
  }, []);

  useEffect(() => {
    if (!shareToken) {
      setError(t("shareSession.missingToken"));
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await sessionAPI.getSharedSession(shareToken);
        if (cancelled) return;

        const sess = data.session as Session;
        setSession(sess);
        const runs = data.runs ?? [];
        const latest = runs.length > 0 ? runs[runs.length - 1] : null;
        if (latest) {
          setRun(normalizeRun(latest as Run, sess.id!));
        } else {
          setRun(null);
        }

        const mode = sess.agent_mode_config?.mode;
        setShowPanel(shouldShowPanel(mode));
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : t("shareSession.loadFailed"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shareToken]);

  const agentConfig = useMemo(
    () => getAgentConfig(session?.agent_mode_config?.mode),
    [session?.agent_mode_config?.mode]
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <Spin size="large" />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-primary px-4">
        <p className="text-primary text-lg mb-2">{t("shareSession.cannotView")}</p>
        <p className="text-secondary text-sm">{error ?? t("shareSession.invalidLink")}</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="min-h-screen flex flex-col bg-primary">
        <header className="border-b border-border px-4 py-3">
          <h1 className="text-lg font-medium text-primary truncate">
            {session.name || t("shareSession.sharedSession")}
          </h1>
          <p className="text-xs text-secondary mt-1">{t("shareSession.readOnly")}</p>
        </header>
        <div className="flex-1 flex items-center justify-center text-secondary">
          {t("shareSession.noMessages")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-primary">
      <header className="flex-shrink-0 border-b border-border px-4 py-3">
        <h1 className="text-lg font-medium text-primary truncate">
          {session.name || "分享的会话"}
        </h1>
        <p className="text-xs text-secondary mt-1">只读 · 访客模式</p>
      </header>
      <div className="flex-1 min-h-0">
        <RunView
          run={run}
          viewOnly
          agentConfig={agentConfig}
          isPanelMinimized={isPanelMinimized}
          setIsPanelMinimized={setIsPanelMinimized}
          showPanel={showPanel}
          setShowPanel={setShowPanel}
          enable_upload={false}
        />
      </div>
    </div>
  );
};

export default ShareSessionPage;
