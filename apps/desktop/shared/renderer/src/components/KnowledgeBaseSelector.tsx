import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, Check, ChevronDown, Database, Globe2, Loader2 } from "lucide-react";
import { desktopApi } from "../desktopApi";

interface KnowledgeBaseSelectorProps {
  agentId: string;
  language: "zh" | "en";
}

export function KnowledgeBaseSelector({ agentId, language }: KnowledgeBaseSelectorProps): React.JSX.Element {
  const [knowledgeBases, setKnowledgeBases] = useState<Array<{ knowledge_id: string; display_name: string; type: "local-files" | "ragflow"; selected?: boolean }>>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isZh = language === "zh";

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [policy, preview] = await Promise.all([
        desktopApi.getMyDrSaiAgentKnowledgePolicy(agentId),
        desktopApi.previewMyDrSaiAgentKnowledge(agentId),
      ]);
      setSelectedIds(new Set(preview.sources));
      setKnowledgeBases(preview.knowledge_bases);
    } catch {
      // silently fail
    } finally {
      setBusy(false);
    }
  }, [agentId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const toggleKnowledge = async (knowledgeId: string) => {
    setBusy(true);
    try {
      const policy = await desktopApi.getMyDrSaiAgentKnowledgePolicy(agentId);
      const current = new Set(policy.sources);
      if (current.has(knowledgeId)) {
        current.delete(knowledgeId);
      } else {
        current.add(knowledgeId);
      }
      setSelectedIds(new Set(current));
      await desktopApi.updateMyDrSaiAgentKnowledgePolicy(agentId, {
        ...policy,
        mode: "explicit",
        sources: [...current],
        expected_revision: policy.revision,
      });
    } catch {
      // silently fail
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = selectedIds.size;
  const localKBs = useMemo(() => knowledgeBases.filter((kb) => kb.type === "local-files"), [knowledgeBases]);
  const remoteKBs = useMemo(() => knowledgeBases.filter((kb) => kb.type === "ragflow"), [knowledgeBases]);

  return (
    <div className="composer-meta-item kb-selector-container" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        className={"composer-meta-chip composer-meta-button" + (selectedCount > 0 ? " active" : "")}
        type="button"
        aria-expanded={open}
        title={isZh ? "知识库" : "Knowledge Base"}
      >
        <BookOpen size={14} />
        {isZh ? "知识库" : "KB"}
        {selectedCount > 0 && <span className="kb-selector-badge">{selectedCount}</span>}
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="composer-meta-menu kb-selector-menu" role="menu" aria-label={isZh ? "知识库选择" : "Knowledge Base selection"}>
          {busy && knowledgeBases.length === 0 && (
            <p className="composer-meta-menu-empty">{isZh ? "正在加载…" : "Loading…"}</p>
          )}
          {knowledgeBases.length === 0 && !busy && (
            <p className="composer-meta-menu-empty">{isZh ? "暂无知识库" : "No knowledge bases"}</p>
          )}
          {localKBs.length > 0 && (
            <>
              <div className="kb-selector-group-label"><Database size={11} />{isZh ? "本地" : "Local"}</div>
              {localKBs.map((kb) => (
                <button
                  key={kb.knowledge_id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={selectedIds.has(kb.knowledge_id)}
                  className={selectedIds.has(kb.knowledge_id) ? "active" : ""}
                  onClick={() => void toggleKnowledge(kb.knowledge_id)}
                >
                  <span>
                    <strong>{kb.display_name}</strong>
                    <small>{isZh ? "本地" : "Local"}</small>
                  </span>
                  {selectedIds.has(kb.knowledge_id) && <Check size={14} />}
                </button>
              ))}
            </>
          )}
          {remoteKBs.length > 0 && (
            <>
              <div className="kb-selector-group-label"><Globe2 size={11} />{isZh ? "远端" : "Remote"}</div>
              {remoteKBs.map((kb) => (
                <button
                  key={kb.knowledge_id}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={selectedIds.has(kb.knowledge_id)}
                  className={selectedIds.has(kb.knowledge_id) ? "active" : ""}
                  onClick={() => void toggleKnowledge(kb.knowledge_id)}
                >
                  <span>
                    <strong>{kb.display_name}</strong>
                    <small>RAGFlow</small>
                  </span>
                  {selectedIds.has(kb.knowledge_id) && <Check size={14} />}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
