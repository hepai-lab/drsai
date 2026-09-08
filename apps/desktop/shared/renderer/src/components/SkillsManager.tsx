/**
 * SkillsManager — local skills + online Skills Square (WebUI marketplace).
 * Local and online share the same page chrome / card visual system.
 */

import {
  ArrowLeft,
  FilePlus,
  FolderInput,
  Loader2,
  Package,
  Pencil,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentSkillPolicy, GatewaySkill } from "@shared/desktopApi";
import { useAuth } from "../auth/AuthProvider";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { requestAppDecision } from "./AppDecisionDialog";
import { SkillsSquarePanel } from "./SkillsSquarePanel";

// ── Types ──────────────────────────────────────────────────────────────────────

type SkillsTopTab = "local" | "online";

/** Used only when uninstall hits skill_in_use (policy still references the skill). */
const LOCAL_SKILLS_AGENT_ID = "opendrsai";

type ManagerView =
  | { kind: "list" }
  | { kind: "detail"; skill: GatewaySkill; content: string }
  | { kind: "editor"; mode: "create" | "edit"; skill?: GatewaySkill; name: string; content: string };

// ── Default SKILL.md template ───────────────────────────────────────────────────

function defaultSkillContent(name: string): string {
  const title = name.trim() || "my_skill";
  return `---
name: ${title}
description: 把用户给出的要点整理成简洁摘要。用户说帮我总结、提炼要点时立即使用。
category: user
compatibility: ["drsai"]
---

# ${title}

当用户给出一段文字、笔记或聊天记录并要求总结时：

1. 用 1 句话概括主题
2. 列出 3-5 条关键要点（每条不超过 1 句）
3. 如有行动项，单独列出

用中文 Markdown 输出；不要编造原文没有的信息。
`;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms?: number): string {
  if (!ms) return "";
  return new Date(ms * 1000).toLocaleString();
}

function skillDirName(skill: GatewaySkill): string {
  const path = skill.path?.replace(/[\\/]+$/, "") ?? "";
  return path.split(/[\\/]/).pop()?.trim() || skill.name;
}

function skillAvatarLetter(name: string): string {
  const base = name.trim();
  if (!base) return "?";
  return ([...base][0] ?? "?").toUpperCase();
}

/** Newest installs first. */
function sortInstalled(skills: GatewaySkill[]): GatewaySkill[] {
  return [...skills].sort((a, b) => {
    const mt = (b.mtime ?? 0) - (a.mtime ?? 0);
    if (mt !== 0) return mt;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

function isGatewayNotReadyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNREFUSED|gateway.*(not|un)available|not ready|28643/i.test(message);
}

function parseSkillInUseAgents(raw: string): string[] {
  const fromJson = Array.from(raw.matchAll(/"agent_name"\s*:\s*"([^"]+)"/g)).map((m) => m[1]);
  if (fromJson.length > 0) return [...new Set(fromJson)];
  const paren = raw.match(/Agents?\s*\(([^)]+)\)/i);
  if (paren?.[1]) {
    return paren[1].split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

async function clearSkillPolicyReferences(skillKeys: string[], agentNames: string[]): Promise<void> {
  const keys = new Set(skillKeys.map((k) => k.trim()).filter(Boolean));
  for (const agentId of agentNames) {
    if (!agentId.trim()) continue;
    const policy = await desktopApi.getMyDrSaiAgentSkillPolicy(agentId);
    const next: AgentSkillPolicy = {
      ...policy,
      enabled: policy.enabled.filter((id) => !keys.has(id)),
      disabled: policy.disabled.filter((id) => !keys.has(id)),
      expected_revision: policy.revision,
    };
    await desktopApi.updateMyDrSaiAgentSkillPolicy(agentId, next);
  }
}

async function ensureGatewayReady(maxAttempts = 12): Promise<void> {
  if (typeof desktopApi.startGateway === "function") {
    try {
      await desktopApi.startGateway();
    } catch {
      // Keep retrying list calls while the process is still booting.
    }
  }
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (typeof desktopApi.getGatewayStatus === "function") {
        const status = await desktopApi.getGatewayStatus();
        if (status?.ready) return;
      } else {
        await desktopApi.listInstalledSkills();
        return;
      }
    } catch (error) {
      lastError = error;
      if (!isGatewayNotReadyError(error) && attempt >= 3) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(400 * attempt, 2000)));
    if (typeof desktopApi.startGateway === "function") {
      try {
        await desktopApi.startGateway();
      } catch {
        // ignore and continue polling
      }
    }
  }
  if (lastError) throw lastError;
  throw new Error("OpenDrSai gateway is not ready.");
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface SkillsManagerProps {
  language: AppLanguage;
  activeThreadId?: string;
  /** Controlled by sidebar: local vs online. */
  topTab?: SkillsTopTab;
  onTopTabChange?: (tab: SkillsTopTab) => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SkillsManager({
  language,
  activeThreadId,
  topTab: topTabProp,
  onTopTabChange,
}: SkillsManagerProps): React.JSX.Element {
  const zh = language === "zh";
  const { session } = useAuth();
  const userId = session.user?.id?.trim() || undefined;
  const userEmail = session.user?.email?.trim() || undefined;

  const [topTab, setTopTabState] = useState<SkillsTopTab>(topTabProp ?? "local");
  const [view, setView] = useState<ManagerView>({ kind: "list" });
  const [skills, setSkills] = useState<GatewaySkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [importingFolder, setImportingFolder] = useState(false);
  const [importingZip, setImportingZip] = useState(false);
  const [actionToast, setActionToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const actionToastTimerRef = useRef<number | null>(null);
  const [editorDirty, setEditorDirty] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [localSearchExpanded, setLocalSearchExpanded] = useState(false);
  const [localCategory, setLocalCategory] = useState("");

  useEffect(() => () => {
    if (actionToastTimerRef.current !== null) {
      window.clearTimeout(actionToastTimerRef.current);
    }
  }, []);

  function showActionToast(type: "success" | "error", message: string): void {
    setActionToast({ type, message });
    if (actionToastTimerRef.current !== null) {
      window.clearTimeout(actionToastTimerRef.current);
    }
    actionToastTimerRef.current = window.setTimeout(() => {
      setActionToast(null);
      actionToastTimerRef.current = null;
    }, 2600);
  }

  useEffect(() => {
    if (topTab !== "local") return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        await ensureGatewayReady();
        if (cancelled) return;
        const data = await desktopApi.listInstalledSkills({ userId });
        if (cancelled) return;
        setSkills(sortInstalled(data ?? []));
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, topTab]);

  async function loadSkills(options?: { notify?: boolean; silent?: boolean }): Promise<void> {
    if (!options?.silent) {
      setLoading(true);
      setLoadError(null);
    }
    try {
      await ensureGatewayReady();
      const data = await desktopApi.listInstalledSkills({ userId });
      setSkills(sortInstalled(data ?? []));
      if (options?.notify) {
        showActionToast("success", zh ? "列表已刷新" : "List refreshed");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!options?.silent) setLoadError(message);
      if (options?.notify) {
        showActionToast("error", `${zh ? "刷新失败" : "Refresh failed"}: ${message}`);
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  async function handleImportFolder(): Promise<void> {
    if (typeof desktopApi.pickFolder !== "function" || typeof desktopApi.importSkillFolder !== "function") {
      showActionToast("error", zh ? "当前环境不支持文件夹导入。" : "Folder import is unavailable in this environment.");
      return;
    }
    setImportingFolder(true);
    try {
      const picked = await desktopApi.pickFolder();
      if (picked.canceled || !picked.paths[0]) return;
      const result = await desktopApi.importSkillFolder({
        folderPath: picked.paths[0],
        threadId: activeThreadId,
      });
      await loadSkills({ silent: true });
      showActionToast(
        "success",
        zh
          ? `已导入「${result.name}」到本地 skills 目录（${result.files} 个文件）`
          : `Imported '${result.name}' into local skills (${result.files} files)`,
      );
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "导入失败" : "Import failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setImportingFolder(false);
    }
  }

  async function handleImportZip(): Promise<void> {
    if (typeof desktopApi.pickFiles !== "function" || typeof desktopApi.installSkillZip !== "function") {
      showActionToast("error", zh ? "当前环境不支持压缩包导入。" : "ZIP import is unavailable in this environment.");
      return;
    }
    setImportingZip(true);
    try {
      const picked = await desktopApi.pickFiles();
      if (picked.canceled || !picked.paths[0]) return;
      const zipPath = picked.paths.find((p: string) => /\.zip$/i.test(p)) || picked.paths[0];
      if (!/\.zip$/i.test(zipPath)) {
        showActionToast("error", zh ? "请选择 .zip 压缩包。" : "Please choose a .zip archive.");
        return;
      }
      const result = await desktopApi.installSkillZip({
        zipPath,
        threadId: activeThreadId,
      });
      await loadSkills({ silent: true });
      showActionToast(
        "success",
        zh
          ? `已从压缩包安装「${result.name}」（${result.files} 个文件）`
          : `Installed '${result.name}' from ZIP (${result.files} files)`,
      );
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "压缩包导入失败" : "ZIP import failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setImportingZip(false);
    }
  }

  async function handleShowDetail(skill: GatewaySkill): Promise<void> {
    setBusy(true);
    try {
      const res = await desktopApi.getSkillContent({ skillPath: skill.path });
      setView({ kind: "detail", skill, content: res.content });
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "读取失败" : "Read failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(skill: GatewaySkill): Promise<void> {
    setBusy(true);
    try {
      const res = await desktopApi.getSkillContent({ skillPath: skill.path });
      setEditorDirty(false);
      setView({ kind: "editor", mode: "edit", skill, name: skill.name, content: res.content });
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "读取失败" : "Read failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  function handleCreate(): void {
    setEditorDirty(false);
    const name = "my_skill";
    setView({ kind: "editor", mode: "create", name, content: defaultSkillContent(name) });
  }

  async function handleSave(mode: "create" | "edit", name: string, content: string): Promise<void> {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showActionToast("error", zh ? "技能名称不能为空。" : "Skill name cannot be empty.");
      return;
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(trimmedName) || trimmedName.length > 64) {
      showActionToast(
        "error",
        zh
          ? "名称只能包含字母、数字、_ 和 -，最长 64 个字符。"
          : "Name must match [a-zA-Z0-9_-] and be at most 64 chars.",
      );
      return;
    }
    setBusy(true);
    try {
      if (mode === "create") {
        await desktopApi.installSkill({ name: trimmedName, content });
      } else {
        await desktopApi.updateSkill({ name: trimmedName, content });
      }
      let reloadNote = "";
      try {
        await desktopApi.reloadSkills({ threadId: activeThreadId });
      } catch (reloadErr) {
        reloadNote = zh
          ? `（已写入磁盘，但对当前对话刷新失败：${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}。新开对话或下一轮扫描后可用。）`
          : ` (Saved to disk, but chat reload failed: ${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}. Start a new chat or wait for the next scan.)`;
      }
      await loadSkills();
      setEditorDirty(false);
      setView({ kind: "list" });
      showActionToast(
        reloadNote ? "error" : "success",
        zh
          ? `「${trimmedName}」已${mode === "create" ? "创建" : "更新"}${reloadNote}`
          : `'${trimmedName}' ${mode === "create" ? "created" : "updated"}.${reloadNote}`,
      );
    } catch (err) {
      showActionToast(
        "error",
        `${zh ? "保存失败" : "Save failed"}: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRequest(skill: GatewaySkill): Promise<void> {
    const approved = await requestAppDecision({
      id: `delete-skill-${skillDirName(skill)}`,
      tone: "danger",
      title: zh ? "确认删除技能？" : "Delete skill?",
      description: zh
        ? `将永久删除「${skill.name}」及其目录，此操作不可撤销。`
        : `Permanently delete '${skill.name}' and its directory. This cannot be undone.`,
      impact: zh
        ? "删除后需重新导入或新建。"
        : "Re-import or create again to use it.",
      confirmLabel: zh ? "确认删除" : "Delete",
    });
    if (!approved) return;
    await handleDeleteConfirmed(skill);
  }

  async function handleDeleteConfirmed(skill: GatewaySkill, options?: { clearReferences?: boolean }): Promise<void> {
    setBusy(true);
    const installId = skillDirName(skill);
    const skillKeys = [installId, skill.name].filter(Boolean);
    try {
      if (options?.clearReferences) {
        const agents = [LOCAL_SKILLS_AGENT_ID];
        await clearSkillPolicyReferences(skillKeys, agents);
      }
      await desktopApi.uninstallSkill({ name: installId, userId });
      try {
        await desktopApi.reloadSkills({ threadId: activeThreadId, userId });
      } catch {
        // Disk delete already succeeded; stale in-memory skills clear on next chat.
      }
      setSkills((prev) =>
        prev.filter((s) => (s.path || s.name) !== (skill.path || skill.name) && skillDirName(s) !== installId),
      );
      showActionToast("success", zh ? `「${skill.name}」已删除` : `'${skill.name}' deleted`);
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      const inUse = /skill_in_use|referenced by one or more Agents/i.test(raw);
      const agents = parseSkillInUseAgents(raw);
      const agentHint = agents.length > 0 ? agents.join("、") : LOCAL_SKILLS_AGENT_ID;
      if (inUse && !options?.clearReferences) {
        const approved = await requestAppDecision({
          id: `clear-skill-refs-${installId}`,
          tone: "danger",
          title: zh ? "技能仍被智能体引用" : "Skill is still referenced",
          description: zh
            ? `智能体「${agentHint}」仍引用「${skill.name}」。删除前需要先清除这些引用。`
            : `Agent '${agentHint}' still references '${skill.name}'. Clear those references before deleting.`,
          impact: zh
            ? "确认后会清除引用，再永久删除技能目录。"
            : "Confirm to clear references, then permanently delete the skill folder.",
          confirmLabel: zh ? "清除引用并删除" : "Clear references and delete",
        });
        if (approved) {
          const targetAgents = agents.length > 0 ? agents : [LOCAL_SKILLS_AGENT_ID];
          try {
            await clearSkillPolicyReferences(skillKeys, targetAgents);
            await handleDeleteConfirmed(skill, { clearReferences: false });
            return;
          } catch (clearErr) {
            showActionToast(
              "error",
              zh
                ? `无法清除引用：${clearErr instanceof Error ? clearErr.message : String(clearErr)}。`
                : `Could not clear references: ${clearErr instanceof Error ? clearErr.message : String(clearErr)}.`,
            );
            return;
          }
        }
        showActionToast(
          "error",
          zh
            ? `无法删除「${skill.name}」：智能体 ${agentHint} 仍引用该技能。`
            : `Cannot delete '${skill.name}': agent ${agentHint} still references it.`,
        );
        return;
      }
      showActionToast(
        "error",
        `${zh ? "删除失败" : "Delete failed"}: ${raw}`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function goBack(): Promise<void> {
    if (view.kind === "editor" && editorDirty) {
      const approved = await requestAppDecision({
        id: "discard-skill-editor",
        tone: "danger",
        title: zh ? "放弃未保存的更改？" : "Discard unsaved changes?",
        description: zh ? "技能编辑器中的未保存内容会丢失。" : "Unsaved content in the skill editor will be lost.",
        impact: zh ? "已保存的技能内容不会改变。" : "Previously saved skill content is unchanged.",
        confirmLabel: zh ? "放弃更改" : "Discard changes",
      });
      if (!approved) return;
    }
    setEditorDirty(false);
    setView({ kind: "list" });
  }

  async function switchTopTab(next: SkillsTopTab): Promise<void> {
    if (next === topTab) return;
    if (topTab === "local" && view.kind === "editor" && editorDirty) {
      const approved = await requestAppDecision({
        id: "discard-skill-editor-tab",
        tone: "danger",
        title: zh ? "放弃未保存的更改？" : "Discard unsaved changes?",
        description: zh ? "切换标签会丢失技能编辑器中的未保存内容。" : "Switching tabs will discard unsaved skill editor content.",
        impact: zh ? "已保存的技能内容不会改变。" : "Previously saved skill content is unchanged.",
        confirmLabel: zh ? "放弃更改" : "Discard changes",
      });
      if (!approved) {
        onTopTabChange?.(topTab);
        return;
      }
    }
    setEditorDirty(false);
    setView({ kind: "list" });
    setTopTabState(next);
    // Sidebar/App already owns navigation; only revert uses onTopTabChange.
  }

  useEffect(() => {
    if (topTabProp == null || topTabProp === topTab) return;
    void switchTopTab(topTabProp);
    // Sync from sidebar / App navigation only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topTabProp]);

  const localCategories = useMemo(() => {
    const set = new Set<string>();
    for (const skill of skills) {
      const cat = skill.category?.trim();
      if (cat) set.add(cat);
    }
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [skills]);

  const filteredLocalSkills = useMemo(() => {
    const q = localSearch.trim().toLowerCase();
    return skills.filter((skill) => {
      if (localCategory && skill.category?.trim() !== localCategory) return false;
      if (!q) return true;
      const hay = `${skill.name} ${skill.description ?? ""} ${skillDirName(skill)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [skills, localSearch, localCategory]);

  const localStats = useMemo(() => {
    const totalBytes = skills.reduce((sum, s) => sum + (s.size ?? 0), 0);
    return {
      total: skills.length,
      sizeLabel: totalBytes > 0 ? formatBytes(totalBytes) : "—",
    };
  }, [skills]);

  const localSubtitle = zh
    ? "与后端扫描目录一致：装进本地即可被对话按需调用。新建、导入文件夹或压缩包。"
    : "Mirrors the backend scan directory. Installed skills are available on demand. Create or import a folder/ZIP.";

  // ── Online (WebUI Skills Square) ─────────────────────────────────────────────

  if (topTab === "online") {
    return (
      <SkillsPageShell toast={actionToast}>
        <SkillsHeader
          zh={zh}
          title={zh ? "在线技能" : "Online skills"}
          subtitle={
            zh
              ? "浏览、收藏与发布；安装到本地后才会进入扫描目录并参与对话。"
              : "Browse, collect, and publish. Install locally to enter the scan directory and chat."
          }
        />
        <SkillsSquarePanel
          language={language}
          userId={userId}
          userEmail={userEmail}
          threadId={activeThreadId}
          isAdmin={
            session.user?.role === "admin" ||
            (Array.isArray(session.user?.roles) && session.user.roles.includes("admin"))
          }
        />
      </SkillsPageShell>
    );
  }

  // ── Local: loading / error ────────────────────────────────────────────────────

  if (loading && view.kind === "list") {
    return (
      <SkillsPageShell toast={actionToast}>
        <SkillsHeader
          zh={zh}
          title={zh ? "本地技能" : "Local skills"}
          subtitle={localSubtitle}
        />
        <div className="skills-page-content">
          <p className="skills-loading">{zh ? "正在连接网关并加载 Skills…" : "Connecting to gateway and loading Skills…"}</p>
        </div>
      </SkillsPageShell>
    );
  }

  if (loadError && view.kind === "list") {
    return (
      <SkillsPageShell toast={actionToast}>
        <SkillsHeader
          zh={zh}
          title={zh ? "本地技能" : "Local skills"}
          subtitle={localSubtitle}
        />
        <div className="skills-page-content">
          <div className="skills-empty-state skills-online-empty">
            <div className="skills-online-empty-icon skills-online-empty-icon-error">
              <Package size={28} />
            </div>
            <p className="skills-online-empty-title">{zh ? "加载失败" : "Failed to load"}</p>
            <p className="skills-online-empty-desc">{loadError}</p>
            <button type="button" className="skills-btn primary" onClick={() => { void loadSkills(); }}>
              {zh ? "重试" : "Retry"}
            </button>
          </div>
        </div>
      </SkillsPageShell>
    );
  }

  // ── Local list view ───────────────────────────────────────────────────────────

  if (view.kind === "list") {
    return (
      <SkillsPageShell toast={actionToast}>
        <SkillsHeader
          zh={zh}
          title={zh ? "本地技能" : "Local skills"}
          subtitle={localSubtitle}
        />

        <div className="skills-page-content skills-local">
          <div className="skills-online-stats" aria-label={zh ? "统计" : "Stats"}>
            {(
              [
                [zh ? "本地技能" : "Local skills", String(localStats.total)],
                [zh ? "占用空间" : "Disk size", localStats.sizeLabel],
              ] as const
            ).map(([title, value]) => (
              <div key={title} className="skills-online-stat-card">
                <div className="skills-online-stat-title">{title}</div>
                <div className="skills-online-stat-value">{value}</div>
              </div>
            ))}
          </div>

          <div className="skills-online-filters">
            <div className="skills-online-filter-bar">
              <div className="skills-online-cat-tabs" role="group" aria-label={zh ? "筛选" : "Filters"}>
                <button
                  type="button"
                  className={`skills-online-cat-tab${!localCategory ? " active" : ""}`}
                  onClick={() => setLocalCategory("")}
                >
                  {zh ? "全部" : "All"}
                </button>
                {localCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    className={`skills-online-cat-tab${localCategory === cat ? " active" : ""}`}
                    onClick={() => setLocalCategory((c) => (c === cat ? "" : cat))}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="skills-online-filter-actions">
                <button
                  type="button"
                  className="skills-btn primary skills-local-filter-cta"
                  onClick={handleCreate}
                  title={zh ? "新建 Skill" : "New Skill"}
                >
                  <FilePlus size={14} />
                  {zh ? "新建" : "New"}
                </button>
                <button
                  type="button"
                  className="skills-btn ghost skills-local-filter-cta"
                  onClick={() => { void handleImportFolder(); }}
                  disabled={importingFolder || importingZip}
                  title={zh ? "从文件夹导入到 skills 目录" : "Import folder into skills directory"}
                >
                  {importingFolder ? <Loader2 size={14} className="spin" /> : <FolderInput size={14} />}
                  {importingFolder ? (zh ? "导入中" : "Importing") : (zh ? "导入文件夹" : "Import folder")}
                </button>
                <button
                  type="button"
                  className="skills-btn ghost skills-local-filter-cta"
                  onClick={() => { void handleImportZip(); }}
                  disabled={importingFolder || importingZip}
                  title={zh ? "从 ZIP 安装到 skills 目录" : "Install ZIP into skills directory"}
                >
                  {importingZip ? <Loader2 size={14} className="spin" /> : <Package size={14} />}
                  {importingZip ? (zh ? "安装中" : "Installing") : (zh ? "导入压缩包" : "Import ZIP")}
                </button>
                {localSearchExpanded ? (
                  <div className="skills-online-search">
                    <Search size={14} className="skills-online-search-icon" aria-hidden />
                    <input
                      type="search"
                      className="skills-online-search-input"
                      autoFocus
                      value={localSearch}
                      placeholder={zh ? "搜索本地技能…" : "Search local skills…"}
                      onChange={(e) => setLocalSearch(e.target.value)}
                      onBlur={() => {
                        if (!localSearch.trim()) setLocalSearchExpanded(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          setLocalSearch("");
                          setLocalSearchExpanded(false);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    className="skills-online-icon-btn"
                    title={zh ? "搜索" : "Search"}
                    onClick={() => setLocalSearchExpanded(true)}
                  >
                    <Search size={16} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className="skills-online-icon-btn"
                  onClick={() => { void loadSkills({ notify: true }); }}
                  disabled={loading}
                  title={zh ? "刷新列表" : "Refresh"}
                  aria-label={zh ? "刷新列表" : "Refresh"}
                >
                  <RefreshCw size={15} className={loading ? "spin" : ""} />
                </button>
              </div>
            </div>
          </div>

          <div className="skills-online-body skills-local-body">
            {skills.length === 0 ? (
              <div className="skills-empty-state skills-online-empty">
                <div className="skills-online-empty-icon">
                  <Package size={28} />
                </div>
                <p className="skills-online-empty-title">
                  {zh ? "尚未安装任何 Skill" : "No skills installed yet"}
                </p>
                <p className="skills-online-empty-desc">
                  {zh ? "本地目录为空。请使用「导入文件夹」「导入压缩包」或「新建」。" : "No local skills yet. Use Import folder, Import ZIP, or New."}
                </p>
              </div>
            ) : filteredLocalSkills.length === 0 ? (
              <div className="skills-empty-state skills-online-empty">
                <div className="skills-online-empty-icon">
                  <Search size={28} />
                </div>
                <p className="skills-online-empty-title">
                  {zh ? "没有匹配的技能" : "No matching skills"}
                </p>
                <p className="skills-online-empty-desc">
                  {zh ? "试试调整搜索或分类筛选。" : "Try adjusting search or category filters."}
                </p>
              </div>
            ) : (
              <div className="skills-online-grid">
                {filteredLocalSkills.map((skill) => {
                  const dirName = skillDirName(skill);
                  const showDir = Boolean(dirName && dirName !== skill.name);
                  const metaParts = [
                    skill.size != null ? formatBytes(skill.size) : "",
                    skill.mtime != null ? formatDate(skill.mtime) : "",
                  ].filter(Boolean);
                  return (
                    <article
                      key={skill.path || `${dirName}:${skill.name}`}
                      className="skills-online-card is-clickable skills-local-card"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        if (busy) return;
                        void handleShowDetail(skill);
                      }}
                      onKeyDown={(e) => {
                        if (busy) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          void handleShowDetail(skill);
                        }
                      }}
                    >
                      <div className="skills-online-card-head">
                        <div className="skills-online-card-avatar" aria-hidden>
                          {skillAvatarLetter(skill.name)}
                        </div>
                        <div className="skills-online-card-title-wrap">
                          <h3 className="skills-online-card-title" title={skill.name}>
                            {skill.name}
                          </h3>
                          <div className="skills-online-card-badges">
                            {skill.category ? (
                              <span className="skills-online-tag-pill">{skill.category}</span>
                            ) : (
                              <span className="skills-online-tag-pill">
                                {zh ? "本地" : "Local"}
                              </span>
                            )}
                            {showDir ? (
                              <span className="skills-online-tag-pill" title={dirName}>
                                {dirName}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <p className="skills-online-card-desc">
                        {skill.description?.trim()
                          || (zh ? "暂无描述" : "No description")}
                      </p>

                      <div className="skills-online-card-foot">
                        <div className="skills-online-card-foot-left">
                          {metaParts.length > 0 ? (
                            <span className="skills-online-downloads">
                              {metaParts.join(" · ")}
                            </span>
                          ) : (
                            <span className="skills-online-downloads">
                              {zh ? "本地技能" : "Local"}
                            </span>
                          )}
                        </div>
                        <div
                          className="skills-local-card-actions"
                          onClick={(e) => { e.stopPropagation(); }}
                          onKeyDown={(e) => { e.stopPropagation(); }}
                        >
                          <button
                            type="button"
                            className="skills-online-icon-btn"
                            title={zh ? "编辑" : "Edit"}
                            disabled={busy}
                            onClick={() => { void handleEdit(skill); }}
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            type="button"
                            className="skills-online-icon-btn danger"
                            title={zh ? "删除" : "Delete"}
                            disabled={busy}
                            onClick={() => { void handleDeleteRequest(skill); }}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </SkillsPageShell>
    );
  }

  // ── Local detail view ─────────────────────────────────────────────────────────

  if (view.kind === "detail") {
    const { skill, content } = view;
    return (
      <SkillsPageShell toast={actionToast}>
        <SkillsHeader zh={zh} title={zh ? "本地技能" : "Local skills"} />
        <div className="skills-page-content">
          <div className="skills-online-detail">
            <button type="button" className="skills-btn skills-online-detail-back" onClick={() => { void goBack(); }}>
              <ArrowLeft size={14} />
              {zh ? "返回" : "Back"}
            </button>

            <div className="skills-online-detail-hero skills-online-detail-card">
              <div className="skills-online-detail-hero-row">
                <div className="skills-online-detail-title-wrap">
                  <div className="skills-online-card-avatar skills-online-detail-avatar" aria-hidden>
                    {skillAvatarLetter(skill.name)}
                  </div>
                  <div className="skills-online-detail-title-meta">
                    <div className="skills-online-detail-title-row">
                      <h3 className="skills-online-detail-title">{skill.name}</h3>
                      <span className="skills-online-detail-source is-public">
                        {zh ? "本地" : "Local"}
                      </span>
                    </div>
                    <div className="skills-online-detail-submeta">
                      {skill.category ? <span>{skill.category}</span> : null}
                      {skill.size != null ? <span>{formatBytes(skill.size)}</span> : null}
                      {skill.mtime != null ? <span>{formatDate(skill.mtime)}</span> : null}
                    </div>
                    {skill.description ? (
                      <p className="skills-online-detail-desc" style={{ marginTop: 8 }}>
                        {skill.description}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="skills-online-detail-actions">
                  <button
                    type="button"
                    className="skills-online-detail-cta"
                    onClick={() => { void handleEdit(skill); }}
                    disabled={busy}
                  >
                    <Pencil size={14} />
                    {zh ? "编辑" : "Edit"}
                  </button>
                </div>
              </div>
            </div>

            <div className="skills-online-detail-panel skills-online-detail-card">
              <div className="skills-online-detail-body">
                <div className="skills-online-detail-markdown gfs-preview-markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
              </div>
            </div>
          </div>
        </div>
      </SkillsPageShell>
    );
  }

  // ── Local editor view ─────────────────────────────────────────────────────────

  if (view.kind === "editor") {
    const { mode, name, content } = view;
    const currentName = name;
    const currentContent = content;

    return (
      <SkillsPageShell toast={actionToast}>
        <SkillsHeader zh={zh} title={zh ? "本地技能" : "Local skills"} />
        <div className="skills-page-content">
          <div className="skills-local-editor-card">
            <div className="skills-local-editor-header">
              <button type="button" className="skills-btn ghost" onClick={() => { void goBack(); }}>
                <ArrowLeft size={14} />
                {zh ? "取消" : "Cancel"}
              </button>
              <span className="skills-detail-name">
                {mode === "create" ? (zh ? "新建 Skill" : "New Skill") : (zh ? `编辑 ${currentName}` : `Edit ${currentName}`)}
              </span>
              <button
                type="button"
                className="skills-btn primary"
                disabled={busy}
                onClick={() => { void handleSave(mode, currentName, currentContent); }}
              >
                <Save size={14} />
                {zh ? "保存" : "Save"}
              </button>
            </div>

            {mode === "create" && (
              <div className="skills-field">
                <label className="skills-label" htmlFor="skill-name">
                  {zh ? "技能名称" : "Skill name"}
                  <span className="skills-label-hint">{zh ? "（字母、数字、_ 或 -）" : "(letters, digits, _ or -)"}</span>
                </label>
                <input
                  id="skill-name"
                  type="text"
                  className="skills-input"
                  placeholder="my_skill"
                  value={currentName}
                  maxLength={64}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setEditorDirty(true);
                    let nextContent = currentContent;
                    const prevTitle = currentName.trim() || "my_skill";
                    const nextTitle = nextName.trim() || "my_skill";
                    if (currentContent.includes(`name: ${prevTitle}`) || currentContent.includes(`# ${prevTitle}`)) {
                      nextContent = currentContent
                        .replace(new RegExp(`^name:\\s*${prevTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"), `name: ${nextTitle}`)
                        .replace(new RegExp(`^#\\s*${prevTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m"), `# ${nextTitle}`);
                    }
                    setView({ kind: "editor", mode, name: nextName, content: nextContent });
                  }}
                  autoFocus
                />
              </div>
            )}

            <div className="skills-field skills-field-grow">
              <label className="skills-label" htmlFor="skill-content">
                SKILL.md
              </label>
              <textarea
                id="skill-content"
                className="skills-textarea"
                value={currentContent}
                spellCheck={false}
                onChange={(e) => {
                  setEditorDirty(true);
                  setView({ kind: "editor", mode, name: currentName, content: e.target.value });
                }}
              />
            </div>

            <p className="skills-hint-bar">
              {zh
                ? "保存后会对当前对话立即生效"
                : "Saving applies the skill to the current chat immediately"}
            </p>
          </div>
        </div>
      </SkillsPageShell>
    );
  }

  return <></>;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SkillsPageShell({
  children,
  toast,
}: {
  children: React.ReactNode;
  toast: { type: "success" | "error"; message: string } | null;
}): React.JSX.Element {
  return (
    <div className="skills-manager skills-manager-page skills-manager-online">
      <div className="skills-page-bg skills-online-bg" aria-hidden>
        <div className="skills-online-bg-orb skills-online-bg-orb-tr" />
        <div className="skills-online-bg-orb skills-online-bg-orb-bl" />
        <div className="skills-online-bg-orb skills-online-bg-orb-center" />
        <div className="skills-online-bg-grid" />
      </div>
      {children}
      {toast ? <SkillsActionToast toast={toast} /> : null}
    </div>
  );
}

function SkillsActionToast({ toast }: { toast: { type: "success" | "error"; message: string } }): React.JSX.Element {
  return (
    <div
      className={`skills-action-toast skills-action-toast-${toast.type}`}
      role="status"
      aria-live="polite"
    >
      {toast.message}
    </div>
  );
}

function SkillsHeader({
  zh,
  title,
  subtitle,
}: {
  zh: boolean;
  title?: string;
  subtitle?: string;
}): React.JSX.Element {
  return (
    <div className="skills-header">
      <Zap size={16} />
      <div className="skills-header-text">
        <h2 className="skills-title">{title || (zh ? "技能" : "Skills")}</h2>
        {subtitle ? <p className="skills-relation-hint">{subtitle}</p> : null}
      </div>
    </div>
  );
}

