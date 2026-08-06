/**
 * SkillsManager — desktop GUI equivalent of the TUI SkillsPane.
 *
 * Views: list → detail | editor (create/edit) | confirm-delete | message
 * All TUI features are present plus a full SKILL.md editor (desktop extension).
 */

import {
  ArrowLeft,
  FilePlus,
  Pencil,
  RefreshCw,
  Save,
  Trash2,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { GatewaySkill } from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { requestAppDecision } from "./AppDecisionDialog";

// ── Types ──────────────────────────────────────────────────────────────────────

type ManagerView =
  | { kind: "list" }
  | { kind: "detail"; skill: GatewaySkill; content: string }
  | { kind: "editor"; mode: "create" | "edit"; skill?: GatewaySkill; name: string; content: string }
  | { kind: "confirm-delete"; skill: GatewaySkill }
  | { kind: "message"; text: string; isError?: boolean };

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

// ── Props ──────────────────────────────────────────────────────────────────────

interface SkillsManagerProps {
  language: AppLanguage;
  activeThreadId?: string;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function SkillsManager({ language, activeThreadId }: SkillsManagerProps): React.JSX.Element {
  const zh = language === "zh";

  const [view, setView] = useState<ManagerView>({ kind: "list" });
  const [skills, setSkills] = useState<GatewaySkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // editor dirty-state for the unsaved-changes guard
  const [editorDirty, setEditorDirty] = useState(false);

  useEffect(() => {
    void loadSkills();
  }, []);

  async function loadSkills(): Promise<void> {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await desktopApi.listInstalledSkills();
      setSkills(data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleReload(): Promise<void> {
    setBusy(true);
    try {
      await desktopApi.reloadSkills({ threadId: activeThreadId });
      setView({ kind: "message", text: zh ? "✓ Skills 已重新加载。" : "✓ Skills reloaded." });
    } catch (err) {
      setView({ kind: "message", text: `${zh ? "重新加载失败" : "Reload failed"}: ${err instanceof Error ? err.message : String(err)}`, isError: true });
    } finally {
      setBusy(false);
    }
  }

  async function handleShowDetail(skill: GatewaySkill): Promise<void> {
    setBusy(true);
    try {
      const res = await desktopApi.getSkillContent({ skillPath: skill.path });
      setView({ kind: "detail", skill, content: res.content });
    } catch (err) {
      setView({ kind: "message", text: `${zh ? "读取失败" : "Read failed"}: ${err instanceof Error ? err.message : String(err)}`, isError: true });
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
      setView({ kind: "message", text: `${zh ? "读取失败" : "Read failed"}: ${err instanceof Error ? err.message : String(err)}`, isError: true });
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
      setView({ kind: "message", text: zh ? "技能名称不能为空。" : "Skill name cannot be empty.", isError: true });
      return;
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(trimmedName) || trimmedName.length > 64) {
      setView({
        kind: "message",
        text: zh
          ? "名称只能包含字母、数字、_ 和 -，最长 64 个字符。"
          : "Name must match [a-zA-Z0-9_-] and be at most 64 chars.",
        isError: true,
      });
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
          ? `（已写入磁盘，但热重载失败：${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}。可点「热重载」或新开对话后再用。）`
          : ` (Saved to disk, but hot-reload failed: ${reloadErr instanceof Error ? reloadErr.message : String(reloadErr)}. Click Hot-reload or start a new chat.)`;
      }
      await loadSkills();
      setEditorDirty(false);
      setView({
        kind: "message",
        text: zh
          ? `✓ '${trimmedName}' 已${mode === "create" ? "创建" : "更新"}。${reloadNote}`
          : `✓ '${trimmedName}' ${mode === "create" ? "created" : "updated"}.${reloadNote}`,
        isError: Boolean(reloadNote),
      });
    } catch (err) {
      setView({
        kind: "message",
        text: `${zh ? "保存失败" : "Save failed"}: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteConfirmed(skill: GatewaySkill): Promise<void> {
    setBusy(true);
    try {
      await desktopApi.uninstallSkill({ name: skill.name });
      try {
        await desktopApi.reloadSkills({ threadId: activeThreadId });
      } catch {
        // Disk delete already succeeded; stale in-memory skills clear on next chat.
      }
      setSkills((prev) => prev.filter((s) => s.name !== skill.name));
      setView({ kind: "message", text: zh ? `✓ '${skill.name}' 已删除。` : `✓ '${skill.name}' deleted.` });
    } catch (err) {
      setView({
        kind: "message",
        text: `${zh ? "删除失败" : "Delete failed"}: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function goBack(): Promise<void> {
    if (view.kind === "editor" && editorDirty) {
      if (!await requestAppDecision({ id: "discard-skill-editor", tone: "danger", title: zh ? "放弃未保存的更改？" : "Discard unsaved changes?", description: zh ? "技能编辑器中的未保存内容会丢失。" : "Unsaved content in the skill editor will be lost.", impact: zh ? "已保存的技能内容不会改变。" : "Previously saved skill content is unchanged.", confirmLabel: zh ? "放弃更改" : "Discard changes" })) return;
    }
    setEditorDirty(false);
    setView({ kind: "list" });
  }

  // ── Loading / error ──────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <p className="skills-loading">{zh ? "加载中…" : "Loading…"}</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <p className="skills-error">{loadError}</p>
        <button type="button" className="skills-btn" onClick={() => { void loadSkills(); }}>
          {zh ? "重试" : "Retry"}
        </button>
      </div>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────────

  if (view.kind === "list") {
    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <div className="skills-toolbar">
          <button
            type="button"
            className="skills-btn primary"
            onClick={handleCreate}
            title={zh ? "新建 Skill" : "New Skill"}
          >
            <FilePlus size={14} />
            {zh ? "新建" : "New"}
          </button>
          <button
            type="button"
            className="skills-btn"
            onClick={() => { void loadSkills(); }}
            disabled={loading}
            title={zh ? "刷新列表" : "Refresh"}
          >
            <RefreshCw size={14} className={loading ? "spin" : ""} />
            {zh ? "刷新" : "Refresh"}
          </button>
          <button
            type="button"
            className="skills-btn"
            onClick={() => { void handleReload(); }}
            disabled={busy}
            title={zh ? "重新加载到 Agent" : "Reload into agent"}
          >
            <Zap size={14} />
            {zh ? "热重载" : "Hot-reload"}
          </button>
        </div>

        <div className="skills-divider" />

        {skills.length === 0 ? (
          <div className="skills-empty">
            <p>{zh ? "尚未安装任何 Skill。" : "No skills installed yet."}</p>
            <p className="skills-hint">
              {zh
                ? "Skills 以 SKILL.md 文件形式存储于 ~/.drsai/workspace/runs/<user>/configs/skills/<name>/"
                : "Skills are stored as SKILL.md files under ~/.drsai/workspace/runs/<user>/configs/skills/<name>/"}
            </p>
          </div>
        ) : (
          <div className="skills-list">
            {skills.map((skill) => (
              <div key={skill.name} className="skills-row">
                <button
                  type="button"
                  className="skills-row-main"
                  onClick={() => { void handleShowDetail(skill); }}
                  disabled={busy}
                >
                  <span className="skills-row-name">{skill.name}</span>
                  {skill.description && (
                    <span className="skills-row-desc">
                      {skill.description.length > 80
                        ? skill.description.slice(0, 77) + "…"
                        : skill.description}
                    </span>
                  )}
                  <span className="skills-row-meta">
                    {skill.category && <span className="skills-tag">{skill.category}</span>}
                    {skill.size != null && <span className="skills-meta-text">{formatBytes(skill.size)}</span>}
                    {skill.mtime != null && <span className="skills-meta-text">{formatDate(skill.mtime)}</span>}
                  </span>
                </button>
                <div className="skills-row-actions">
                  <button
                    type="button"
                    className="skills-icon-btn"
                    title={zh ? "编辑" : "Edit"}
                    disabled={busy}
                    onClick={() => { void handleEdit(skill); }}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    className="skills-icon-btn danger"
                    title={zh ? "删除" : "Delete"}
                    disabled={busy}
                    onClick={() => setView({ kind: "confirm-delete", skill })}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="skills-divider" />
        <p className="skills-hint-bar">
          {zh
            ? "点击技能名称查看详情 · 铅笔图标编辑 · 垃圾桶图标删除 · 热重载立即生效"
            : "Click skill name to view · pencil to edit · trash to delete · hot-reload to apply"}
        </p>
      </div>
    );
  }

  // ── Detail view ──────────────────────────────────────────────────────────────

  if (view.kind === "detail") {
    const { skill, content } = view;
    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <div className="skills-detail-header">
          <button type="button" className="skills-btn" onClick={goBack}>
            <ArrowLeft size={14} />
            {zh ? "返回" : "Back"}
          </button>
          <span className="skills-detail-name">{skill.name}</span>
          <button
            type="button"
            className="skills-btn"
            onClick={() => { void handleEdit(skill); }}
            disabled={busy}
          >
            <Pencil size={14} />
            {zh ? "编辑" : "Edit"}
          </button>
        </div>
        <div className="skills-divider" />
        <pre className="skills-content-pre">{content}</pre>
        <div className="skills-divider" />
        <p className="skills-hint-bar">
          {zh ? "按「返回」回到列表" : "Click Back to return to list"}
        </p>
      </div>
    );
  }

  // ── Editor view ──────────────────────────────────────────────────────────────

  if (view.kind === "editor") {
    const { mode, name, content } = view;
    const currentName = name;
    const currentContent = content;

    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <div className="skills-detail-header">
          <button type="button" className="skills-btn" onClick={goBack}>
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
        <div className="skills-divider" />

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
              placeholder={zh ? "my_skill" : "my_skill"}
              value={currentName}
              maxLength={64}
              onChange={(e) => {
                const nextName = e.target.value;
                setEditorDirty(true);
                // Keep SKILL.md name/title in sync while the user is still on the starter template.
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
            ? "保存后会自动热重载到当前 Agent 会话"
            : "Saving will automatically hot-reload into the current agent session"}
        </p>
      </div>
    );
  }

  // ── Confirm-delete view ──────────────────────────────────────────────────────

  if (view.kind === "confirm-delete") {
    const { skill } = view;
    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <div className="skills-divider" />
        <div className="skills-confirm-body">
          <p className="skills-confirm-msg">
            {zh ? `确认删除技能 ` : `Delete skill `}
            <strong>{skill.name}</strong>
            {zh ? `？此操作将永久移除该技能目录。` : `? This will permanently remove the skill directory.`}
          </p>
          <div className="skills-confirm-actions">
            <button
              type="button"
              className="skills-btn danger"
              disabled={busy}
              onClick={() => { void handleDeleteConfirmed(skill); }}
            >
              <Trash2 size={14} />
              {zh ? "确认删除" : "Delete"}
            </button>
            <button type="button" className="skills-btn" onClick={goBack}>
              {zh ? "取消" : "Cancel"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Message view ─────────────────────────────────────────────────────────────

  if (view.kind === "message") {
    return (
      <div className="skills-manager">
        <SkillsHeader zh={zh} />
        <div className="skills-divider" />
        <div className="skills-message-body">
          <p className={view.isError ? "skills-error" : "skills-success"}>{view.text}</p>
          <button type="button" className="skills-btn" onClick={() => setView({ kind: "list" })}>
            <ArrowLeft size={14} />
            {zh ? "返回列表" : "Back to list"}
          </button>
        </div>
      </div>
    );
  }

  return <></>;
}

// ── Header sub-component ───────────────────────────────────────────────────────

function SkillsHeader({ zh }: { zh: boolean }): React.JSX.Element {
  return (
    <div className="skills-header">
      <Zap size={16} />
      <h2 className="skills-title">{zh ? "⚡ Skills 管理" : "⚡ Skills Manager"}</h2>
    </div>
  );
}
