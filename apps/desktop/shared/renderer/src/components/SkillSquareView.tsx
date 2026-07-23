import {
  BookOpen,
  CalendarClock,
  Cable,
  CheckCircle2,
  ClipboardList,
  Download,
  Pencil,
  Play,
  PauseCircle,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  Terminal,
  Trash2,
  UploadCloud,
  WandSparkles,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  DesktopBackgroundTask,
  DesktopProjectMemoryEntry,
  DesktopProjectSkillDraft,
  DesktopScheduledTask,
  DesktopScheduledTaskWorkerStatus,
  DesktopWorkflowRun,
  DesktopWorkflowRunRecipe,
  DesktopWorkflowTemplate,
} from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import { SkillsManager } from "./SkillsManager";

interface SkillSquareFocusTarget {
  query: string;
  source: "slash_command";
}


export function SkillSquareView({
  activeThreadId,
  initialFocus,
  language,
  workspacePath,
}: {
  activeThreadId?: string;
  initialFocus?: SkillSquareFocusTarget;
  language: AppLanguage;
  workspacePath?: string;
}): React.JSX.Element {
  const zh = language === "zh";
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [projectMemory, setProjectMemory] = useState<DesktopProjectMemoryEntry[]>([]);
  const [skillDrafts, setSkillDrafts] = useState<DesktopProjectSkillDraft[]>([]);
  const [workflowTemplates, setWorkflowTemplates] = useState<DesktopWorkflowTemplate[]>([]);
  const [preparedWorkflow, setPreparedWorkflow] =
    useState<DesktopWorkflowRunRecipe | null>(null);
  const [workflowRun, setWorkflowRun] = useState<DesktopWorkflowRun | null>(null);
  const [backgroundTasks, setBackgroundTasks] = useState<DesktopBackgroundTask[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<DesktopScheduledTask[]>([]);
  const [scheduledWorkerStatus, setScheduledWorkerStatus] =
    useState<DesktopScheduledTaskWorkerStatus | null>(null);
  const [scheduledTaskBusyId, setScheduledTaskBusyId] = useState<string | null>(null);
  const [workflowBusyId, setWorkflowBusyId] = useState<string | null>(null);
  const [workflowRunBusy, setWorkflowRunBusy] = useState(false);
  const [workflowDispatchBusyId, setWorkflowDispatchBusyId] = useState<string | null>(null);
  const [workflowMessage, setWorkflowMessage] = useState<string | null>(null);
  const [marketplaceSyncBusy, setMarketplaceSyncBusy] = useState(false);
  const [workflowPostmortemRunId, setWorkflowPostmortemRunId] = useState<string | null>(null);
  const [workflowPostmortemDraft, setWorkflowPostmortemDraft] = useState("");
  const [dismissedWorkflowPostmortemRunId, setDismissedWorkflowPostmortemRunId] =
    useState<string | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [editingMemoryId, setEditingMemoryId] = useState<string | null>(null);
  const [editingMemoryContent, setEditingMemoryContent] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [memoryMessage, setMemoryMessage] = useState<string | null>(null);
  const normalizedFocusQuery = normalizeSkillSquareQuery(initialFocus?.query ?? "");

  const filteredWorkflowTemplates = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return workflowTemplates;
    return workflowTemplates.filter((template) =>
      matchesWorkflowTemplate(template, normalizedSearch),
    );
  }, [search, workflowTemplates]);

  useEffect(() => {
    const query = initialFocus?.query.trim();
    if (!query) return;
    setSearch(query);
    setWorkflowMessage(
      `Focused from /skills: ${query}. Review the highlighted skill or workflow before starting any run.`,
    );
  }, [initialFocus?.query]);

  useEffect(() => {
    void refreshProjectMemory();
  }, [workspacePath]);

  useEffect(() => {
    void refreshWorkflowMarketplace();
  }, []);

  useEffect(() => {
    void refreshWorkflowRuns();
    void refreshBackgroundTasks();
    void refreshScheduledTasks();
    void refreshScheduledWorkerStatus();
  }, [workspacePath]);

  useEffect(() => {
    const refreshTimer = window.setInterval(() => void refreshBackgroundTasks(), 1000);
    return () => window.clearInterval(refreshTimer);
  }, [workspacePath]);

  useEffect(() => {
    if (
      !workflowRun ||
      (workflowRun.status !== "complete" && workflowRun.status !== "blocked")
    ) {
      setWorkflowPostmortemRunId(null);
      setWorkflowPostmortemDraft("");
      return;
    }
    if (workflowRun.id === dismissedWorkflowPostmortemRunId) return;
    if (workflowRun.id === workflowPostmortemRunId) return;
    setWorkflowPostmortemRunId(workflowRun.id);
    setWorkflowPostmortemDraft(buildWorkflowPostmortemDraft(workflowRun));
  }, [dismissedWorkflowPostmortemRunId, workflowPostmortemRunId, workflowRun]);

  useEffect(() => {
    function handleWorkflowRunUpdated(event: Event): void {
      const run = (event as CustomEvent<{ run?: DesktopWorkflowRun }>).detail?.run;
      if (!run) return;
      if (workspacePath && run.workspacePath && run.workspacePath !== workspacePath) {
        return;
      }
      setWorkflowRun(run);
    }

    window.addEventListener("drsai:workflow-run-updated", handleWorkflowRunUpdated);
    return () => {
      window.removeEventListener(
        "drsai:workflow-run-updated",
        handleWorkflowRunUpdated,
      );
    };
  }, [workspacePath]);

  function refreshSkills(): void {
    setRefreshing(true);
    window.setTimeout(() => setRefreshing(false), 350);
    void refreshProjectMemory();
    void refreshWorkflowMarketplace();
    void refreshWorkflowRuns();
    void refreshBackgroundTasks();
    void refreshScheduledTasks();
    void refreshScheduledWorkerStatus();
  }

  async function refreshProjectMemory(): Promise<void> {
    if (!workspacePath) {
      setProjectMemory([]);
      setSkillDrafts([]);
      return;
    }
    setMemoryBusy(true);
    try {
      const [entries, drafts] = await Promise.all([
        desktopApi.listProjectMemory({
          workspacePath,
          limit: 50,
        }),
        desktopApi.listProjectSkillDrafts({
          workspacePath,
          limit: 20,
        }),
      ]);
      setProjectMemory(entries);
      setSkillDrafts(drafts);
      await refreshWorkflowMarketplace();
      setMemoryMessage(null);
    } catch (error) {
      setMemoryMessage(
        error instanceof Error ? error.message : "Failed to load project memory.",
      );
    } finally {
      setMemoryBusy(false);
    }
  }

  async function refreshWorkflowMarketplace(): Promise<void> {
    try {
      const marketplace = await desktopApi.listWorkflowMarketplace(workspacePath);
      setWorkflowTemplates(marketplace.templates);
    } catch {
      setWorkflowTemplates([]);
    }
  }

  async function syncWorkflowMarketplace(): Promise<void> {
    if (!workspacePath) return;
    setMarketplaceSyncBusy(true);
    setWorkflowMessage(null);
    try {
      const result = await desktopApi.syncWorkflowMarketplace({ workspacePath });
      await refreshWorkflowMarketplace();
      setWorkflowMessage(
        `Synced ${result.importedCount} local workflow template(s), ignored ${result.ignoredCount}. No network marketplace call was made.`,
      );
    } catch (error) {
      setWorkflowMessage(
        error instanceof Error
          ? error.message
          : "Failed to sync local workflow marketplace.",
      );
    } finally {
      setMarketplaceSyncBusy(false);
    }
  }

  async function refreshWorkflowRuns(): Promise<void> {
    try {
      const runs = await desktopApi.listWorkflowRuns(workspacePath);
      setWorkflowRun(runs[0] ?? null);
    } catch {
      setWorkflowRun(null);
    }
  }

  async function refreshBackgroundTasks(): Promise<void> {
    try {
      const tasks = await desktopApi.listBackgroundTasks({
        ...(workspacePath ? { workspacePath } : {}),
        limit: 12,
      });
      setBackgroundTasks(tasks);
    } catch {
      setBackgroundTasks([]);
    }
  }

  async function refreshScheduledTasks(): Promise<void> {
    try {
      const tasks = await desktopApi.listScheduledTasks({
        ...(workspacePath ? { workspacePath } : {}),
        limit: 12,
      });
      setScheduledTasks(tasks);
    } catch {
      setScheduledTasks([]);
    }
  }

  async function refreshScheduledWorkerStatus(): Promise<void> {
    try {
      const status = await desktopApi.getScheduledTaskWorkerStatus();
      setScheduledWorkerStatus(status);
    } catch {
      setScheduledWorkerStatus(null);
    }
  }

  async function createSampleScheduledTask(): Promise<void> {
    if (!workspacePath) return;
    setScheduledTaskBusyId("create");
    try {
      const task = await desktopApi.createScheduledTask({
        kind: "monitor",
        title: "Daily workspace health monitor",
        cadence: "daily",
        target: "Run status, tests, and open risks for the active workspace.",
        workspacePath,
        workflowTemplateId: "plan-review-fix",
        approvalRequired: true,
        verification: "Review persisted schedule state before enabling runtime triggers.",
        message: "Monitor definition is ready; trigger execution remains approval-gated.",
      });
      setScheduledTasks((current) => [task, ...current]);
    } finally {
      setScheduledTaskBusyId(null);
    }
  }

  async function runDueScheduledTasks(): Promise<void> {
    if (!workspacePath) return;
    setScheduledTaskBusyId("run-due");
    setWorkflowMessage(null);
    try {
      const result = await desktopApi.runDueScheduledTasks({
        workspacePath,
        limit: 12,
      });
      if (result.runs[0]) {
        setWorkflowRun(result.runs[0]);
      }
      await refreshScheduledTasks();
      await refreshBackgroundTasks();
      await refreshScheduledWorkerStatus();
      setWorkflowMessage(
        `Scheduled scan checked ${result.checked} due task(s), triggered ${result.triggered}, reconnected ${result.reconnected}, skipped ${result.skipped}, blocked ${result.blocked}.`,
      );
    } catch (error) {
      setWorkflowMessage(
        error instanceof Error ? error.message : "Failed to run scheduled scan.",
      );
    } finally {
      setScheduledTaskBusyId(null);
    }
  }

  async function toggleScheduledTask(task: DesktopScheduledTask): Promise<void> {
    setScheduledTaskBusyId(task.id);
    try {
      const updated = await desktopApi.updateScheduledTask({
        taskId: task.id,
        status: task.status === "paused" ? "enabled" : "paused",
        message:
          task.status === "paused"
            ? "Scheduled task is enabled for future trigger wiring."
            : "Scheduled task is paused and will not be picked up by future triggers.",
      });
      setScheduledTasks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } finally {
      setScheduledTaskBusyId(null);
    }
  }

  async function resumeScheduledTask(task: DesktopScheduledTask): Promise<void> {
    setScheduledTaskBusyId(`${task.id}:resume`);
    try {
      const updated = await desktopApi.updateScheduledTask({
        taskId: task.id,
        status: "enabled",
        nextRunAt: new Date().toISOString(),
        message:
          "Scheduled monitor was resumed and will be considered by the next due scan.",
      });
      setScheduledTasks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      await refreshScheduledWorkerStatus();
    } finally {
      setScheduledTaskBusyId(null);
    }
  }

  async function prepareWorkflow(template: DesktopWorkflowTemplate): Promise<void> {
    setWorkflowBusyId(template.id);
    setWorkflowMessage(null);
    try {
      const result = await desktopApi.prepareWorkflowRun({
        templateId: template.id,
        ...(workspacePath ? { workspacePath } : {}),
      });
      setPreparedWorkflow(result.recipe);
      setWorkflowRun(null);
      setWorkflowMessage(result.recipe.message);
    } catch (error) {
      setWorkflowMessage(
        error instanceof Error ? error.message : "Failed to prepare workflow.",
      );
    } finally {
      setWorkflowBusyId(null);
    }
  }

  async function startPreparedWorkflow(): Promise<void> {
    if (!preparedWorkflow) return;
    setWorkflowRunBusy(true);
    setWorkflowMessage(null);
    try {
      const result = await desktopApi.startWorkflowRun({
        recipe: preparedWorkflow,
      });
      setWorkflowRun(result.run);
      await refreshBackgroundTasks();
      setWorkflowMessage(result.run.message);
    } catch (error) {
      setWorkflowMessage(
        error instanceof Error ? error.message : "Failed to start workflow run.",
      );
    } finally {
      setWorkflowRunBusy(false);
    }
  }

  async function dispatchWorkflowStep(
    run: DesktopWorkflowRun,
    stepId: string,
  ): Promise<void> {
    setWorkflowDispatchBusyId(`${run.id}:${stepId}`);
    setWorkflowMessage(null);
    try {
      const result = await desktopApi.dispatchWorkflowRunStep({
        runId: run.id,
        stepId,
      });
      setWorkflowRun(result.run);
      await refreshBackgroundTasks();
      if (result.dispatched && result.kind === "chat_command" && result.command) {
        window.dispatchEvent(
          new CustomEvent("drsai:workflow-chat-command", {
            detail: {
              command: result.command,
              workflowRunId: result.run.id,
              stepId,
            },
          }),
        );
      }
      if (result.dispatched && result.kind === "terminal_command" && result.command) {
        window.dispatchEvent(
          new CustomEvent("drsai:workflow-terminal-command", {
            detail: {
              command: result.command,
              workflowRunId: result.run.id,
              stepId,
            },
          }),
        );
      }
      setWorkflowMessage(
        result.command && result.kind === "terminal_command"
          ? `${result.message} Command: ${result.command}`
          : result.message,
      );
    } catch (error) {
      setWorkflowMessage(
        error instanceof Error
          ? error.message
          : "Failed to dispatch workflow step.",
      );
    } finally {
      setWorkflowDispatchBusyId(null);
    }
  }

  async function addMemory(source: "manual" | "retrospective"): Promise<void> {
    if (!workspacePath || !memoryDraft.trim()) return;
    setMemoryBusy(true);
    try {
      const entry = await desktopApi.addProjectMemory({
        workspacePath,
        content: memoryDraft.trim(),
        source,
      });
      setProjectMemory((current) => [entry, ...current]);
      setMemoryDraft("");
      setMemoryMessage(
        source === "retrospective"
          ? "Retrospective saved to project memory."
          : "Project memory saved.",
      );
    } catch (error) {
      setMemoryMessage(
        error instanceof Error ? error.message : "Failed to save project memory.",
      );
    } finally {
      setMemoryBusy(false);
    }
  }

  async function saveWorkflowPostmortem(): Promise<void> {
    if (!workspacePath || !workflowRun || !workflowPostmortemDraft.trim()) return;
    setMemoryBusy(true);
    try {
      const entry = await desktopApi.addProjectMemory({
        workspacePath,
        content: workflowPostmortemDraft.trim(),
        source: "retrospective",
      });
      setProjectMemory((current) => [entry, ...current]);
      setDismissedWorkflowPostmortemRunId(workflowRun.id);
      setWorkflowPostmortemRunId(null);
      setWorkflowPostmortemDraft("");
      setMemoryMessage("Workflow retrospective saved to project memory.");
    } catch (error) {
      setMemoryMessage(
        error instanceof Error
          ? error.message
          : "Failed to save workflow retrospective.",
      );
    } finally {
      setMemoryBusy(false);
    }
  }

  function beginEditMemory(entry: DesktopProjectMemoryEntry): void {
    setEditingMemoryId(entry.id);
    setEditingMemoryContent(entry.content);
    setMemoryMessage(null);
  }

  async function saveMemoryEdit(entry: DesktopProjectMemoryEntry): Promise<void> {
    if (!workspacePath || !editingMemoryContent.trim()) return;
    setMemoryBusy(true);
    try {
      const updated = await desktopApi.updateProjectMemory({
        workspacePath,
        entryId: entry.id,
        content: editingMemoryContent.trim(),
        source: entry.source,
      });
      setProjectMemory((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      setEditingMemoryId(null);
      setEditingMemoryContent("");
      setMemoryMessage("Project memory updated.");
    } catch (error) {
      setMemoryMessage(
        error instanceof Error ? error.message : "Failed to update project memory.",
      );
    } finally {
      setMemoryBusy(false);
    }
  }

  async function deleteMemory(entry: DesktopProjectMemoryEntry): Promise<void> {
    if (!workspacePath) return;
    setMemoryBusy(true);
    try {
      await desktopApi.clearProjectMemory({
        workspacePath,
        entryId: entry.id,
      });
      setProjectMemory((current) => current.filter((item) => item.id !== entry.id));
      setMemoryMessage("Project memory deleted.");
    } catch (error) {
      setMemoryMessage(
        error instanceof Error ? error.message : "Failed to delete project memory.",
      );
    } finally {
      setMemoryBusy(false);
    }
  }

  async function promoteMemory(entry: DesktopProjectMemoryEntry): Promise<void> {
    if (!workspacePath) return;
    setMemoryBusy(true);
    try {
      const promoted = await desktopApi.addProjectMemory({
        workspacePath,
        content: `Skill promotion candidate: ${entry.content}`,
        source: "retrospective",
      });
      setProjectMemory((current) => [promoted, ...current]);
      setMemoryMessage("Skill promotion candidate saved for review.");
    } catch (error) {
      setMemoryMessage(
        error instanceof Error
          ? error.message
          : "Failed to prepare skill promotion candidate.",
      );
    } finally {
      setMemoryBusy(false);
    }
  }

  async function createSkillDraft(entry: DesktopProjectMemoryEntry): Promise<void> {
    if (!workspacePath) return;
    setMemoryBusy(true);
    try {
      const draft = await desktopApi.createProjectSkillDraft({
        workspacePath,
        content: entry.content,
        memoryEntryId: entry.id,
        source: "project_memory",
      });
      setSkillDrafts((current) => [draft, ...current]);
      setMemoryMessage(`Skill draft created: ${draft.slug}`);
    } catch (error) {
      setMemoryMessage(
        error instanceof Error ? error.message : "Failed to create skill draft.",
      );
    } finally {
      setMemoryBusy(false);
    }
  }

  async function installSkillDraft(draft: DesktopProjectSkillDraft): Promise<void> {
    if (!workspacePath) return;
    setMemoryBusy(true);
    try {
      const result = await desktopApi.installProjectSkillDraft({
        workspacePath,
        draftId: draft.id,
        target: "desktop_local",
      });
      setSkillDrafts((current) =>
        current.map((item) =>
          item.id === draft.id
            ? {
                ...item,
                installedAt: result.installedAt,
                installPath: result.installPath,
                updatedAt: result.installedAt,
              }
            : item,
        ),
      );
      setMemoryMessage(
        result.alreadyInstalled
          ? `Skill already installed: ${result.slug}`
          : `Skill installed locally: ${result.slug}`,
      );
    } catch (error) {
      setMemoryMessage(
        error instanceof Error ? error.message : "Failed to install skill draft.",
      );
    } finally {
      setMemoryBusy(false);
    }
  }

  async function publishSkillDraft(draft: DesktopProjectSkillDraft): Promise<void> {
    if (!workspacePath) return;
    setMemoryBusy(true);
    try {
      const result = await desktopApi.publishProjectSkillDraft({
        workspacePath,
        draftId: draft.id,
        target: "marketplace_submission",
      });
      setSkillDrafts((current) =>
        current.map((item) =>
          item.id === draft.id
            ? {
                ...item,
                publishedAt: result.publishedAt,
                marketplaceSubmissionPath: result.submissionPath,
                updatedAt: result.publishedAt,
              }
            : item,
        ),
      );
      setMemoryMessage(
        result.alreadyPublished
          ? `Marketplace submission already prepared: ${result.slug}`
          : `Marketplace submission prepared: ${result.slug}`,
      );
    } catch (error) {
      setMemoryMessage(
        error instanceof Error
          ? error.message
          : "Failed to prepare marketplace submission.",
      );
    } finally {
      setMemoryBusy(false);
    }
  }

  return (
    <section
      className="skill-square-view"
      aria-label={zh ? "技能广场" : "Skill Square"}
    >
      <div className="skill-square-toolbar">
        <div className="skill-square-title-block">
          <strong>{zh ? "技能" : "Skills"}</strong>
        </div>
        <label className="skill-square-search">
          <Search size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={zh ? "搜索技能 / 描述 / 分类" : "Search skills / description / category"}
          />
        </label>
        <div className="skill-square-actions">
          <button className="skill-square-refresh" type="button" onClick={refreshSkills}>
            <RefreshCw size={14} className={refreshing ? "spinning" : ""} />
            {zh ? "刷新" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="skill-square-content">
        {initialFocus?.query ? (
          <div className="skill-square-command-focus" aria-label="Slash command focus">
            <Sparkles size={14} />
            <span>
              /skills {initialFocus.query} focused this view. Select or prepare a
              highlighted item explicitly before execution.
            </span>
          </div>
        ) : null}
        <section className="skill-square-section project-memory-review">
          <div className="project-memory-header">
            <h3>
              <BookOpen size={14} />
              {zh ? "Project Memory" : "Project Memory"}
            </h3>
            <span>
              {projectMemory.length}
              {zh ? " entries" : " entries"}
            </span>
          </div>
          <div className="project-memory-editor">
            <textarea
              value={memoryDraft}
              disabled={!workspacePath || memoryBusy}
              onChange={(event) => setMemoryDraft(event.target.value)}
              placeholder={
                workspacePath
                  ? "Add a durable project note or post-task lesson."
                  : "Select a workspace before editing project memory."
              }
            />
            <div className="project-memory-editor-actions">
              <button
                type="button"
                disabled={!workspacePath || memoryBusy || !memoryDraft.trim()}
                onClick={() => void addMemory("manual")}
              >
                <Save size={14} />
                {zh ? "Save" : "Save"}
              </button>
              <button
                type="button"
                disabled={!workspacePath || memoryBusy || !memoryDraft.trim()}
                onClick={() => void addMemory("retrospective")}
              >
                <WandSparkles size={14} />
                {zh ? "Retrospective" : "Retrospective"}
              </button>
            </div>
          </div>
          {memoryMessage ? <div className="project-memory-message">{memoryMessage}</div> : null}
          <div className="project-memory-list" aria-label="Project memory review">
            {projectMemory.length === 0 ? (
              <div className="project-memory-empty">
                {memoryBusy
                  ? "Loading project memory..."
                  : "No project memory is saved for this workspace."}
              </div>
            ) : (
              projectMemory.map((entry, index) => (
                <article className="project-memory-card" key={entry.id}>
                  <div className="project-memory-card-top">
                    <span>{index + 1}</span>
                    <small>{entry.source}</small>
                    <time dateTime={entry.updatedAt}>
                      {formatMemoryTime(entry.updatedAt)}
                    </time>
                  </div>
                  {editingMemoryId === entry.id ? (
                    <textarea
                      value={editingMemoryContent}
                      disabled={memoryBusy}
                      onChange={(event) => setEditingMemoryContent(event.target.value)}
                    />
                  ) : (
                    <p>{entry.content}</p>
                  )}
                  <div className="project-memory-card-actions">
                    {editingMemoryId === entry.id ? (
                      <button
                        type="button"
                        disabled={memoryBusy || !editingMemoryContent.trim()}
                        onClick={() => void saveMemoryEdit(entry)}
                      >
                        <Save size={14} />
                        {zh ? "Save" : "Save"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={memoryBusy}
                        onClick={() => beginEditMemory(entry)}
                      >
                        <Pencil size={14} />
                        {zh ? "Edit" : "Edit"}
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={memoryBusy}
                      onClick={() => void promoteMemory(entry)}
                    >
                      <WandSparkles size={14} />
                      {zh ? "Promote" : "Promote"}
                    </button>
                    <button
                      type="button"
                      disabled={memoryBusy}
                      onClick={() => void createSkillDraft(entry)}
                    >
                      <Sparkles size={14} />
                      {zh ? "Draft skill" : "Draft skill"}
                    </button>
                    <button
                      className="danger"
                      type="button"
                      disabled={memoryBusy}
                      onClick={() => void deleteMemory(entry)}
                    >
                      <Trash2 size={14} />
                      {zh ? "Delete" : "Delete"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
          <div className="project-skill-drafts" aria-label="Generated skill drafts">
            <div className="project-skill-drafts-header">
              <strong>{zh ? "Skill drafts" : "Skill drafts"}</strong>
              <span>{skillDrafts.length}</span>
            </div>
            {skillDrafts.length === 0 ? (
              <div className="project-memory-empty">
                No generated skill drafts for this workspace.
              </div>
            ) : (
              skillDrafts.map((draft) => (
                <article
                  className={`project-skill-draft-card ${draft.installedAt ? "installed" : ""} ${draft.publishedAt ? "published" : ""}`}
                  key={draft.id}
                >
                  <div className="project-skill-draft-card-top">
                    <strong>{draft.title}</strong>
                    <span>
                      {draft.publishedAt
                        ? "Submission"
                        : draft.installedAt
                          ? "Installed"
                          : "Draft"}
                    </span>
                  </div>
                  <span>{draft.slug}</span>
                  <p>{draft.summary}</p>
                  <small>{draft.draftPath}</small>
                  {draft.installPath ? <small>{draft.installPath}</small> : null}
                  {draft.marketplaceSubmissionPath ? (
                    <small>{draft.marketplaceSubmissionPath}</small>
                  ) : null}
                  <div className="project-skill-draft-actions">
                    <button
                      type="button"
                      disabled={memoryBusy || Boolean(draft.installedAt)}
                      onClick={() => void installSkillDraft(draft)}
                      title="Install reviewed draft to local desktop skills"
                    >
                      {draft.installedAt ? <CheckCircle2 size={14} /> : <Download size={14} />}
                      {draft.installedAt ? "Installed" : "Install locally"}
                    </button>
                    <button
                      type="button"
                      disabled={memoryBusy || Boolean(draft.publishedAt)}
                      onClick={() => void publishSkillDraft(draft)}
                      title="Prepare a local marketplace submission package for review"
                    >
                      {draft.publishedAt ? <CheckCircle2 size={14} /> : <UploadCloud size={14} />}
                      {draft.publishedAt ? "Submission ready" : "Prepare submission"}
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
        <section
          className="skill-square-section workflow-marketplace"
          aria-label="Workflow marketplace"
        >
          <h3>
            <Sparkles size={14} />
            {zh ? "Workflow marketplace" : "Workflow marketplace"}
          </h3>
          <div className="workflow-marketplace-actions">
            <button
              type="button"
              disabled={!workspacePath || marketplaceSyncBusy}
              onClick={() => void syncWorkflowMarketplace()}
              title="Sync reviewed workflow templates from .drsai/workflow-marketplace.json"
            >
              <RefreshCw size={13} />
              {marketplaceSyncBusy ? "Syncing" : "Sync local"}
            </button>
            <span>No network marketplace call is made.</span>
          </div>
          {workflowMessage ? (
            <div className="project-memory-message">{workflowMessage}</div>
          ) : null}
          {preparedWorkflow ? (
            <div className={`workflow-run-recipe ${preparedWorkflow.status}`}>
              <div className="workflow-run-recipe-top">
                <strong>{preparedWorkflow.name}</strong>
                <span>{preparedWorkflow.status.replace("_", " ")}</span>
              </div>
              <ol>
                {preparedWorkflow.steps.map((step) => (
                  <li key={step.id}>
                    <strong>{step.title}</strong>
                    <span>{step.command ?? step.detail}</span>
                  </li>
                ))}
              </ol>
              <small>{preparedWorkflow.verification}</small>
              <button
                type="button"
                className="workflow-template-prepare"
                disabled={workflowRunBusy || preparedWorkflow.status === "blocked"}
                onClick={() => void startPreparedWorkflow()}
              >
                <Play size={14} />
                {workflowRunBusy ? "Starting" : "Start run"}
              </button>
            </div>
          ) : null}
          {workflowRun ? (
            <WorkflowRunExecution
              run={workflowRun}
              busyStepKey={workflowDispatchBusyId}
              onDispatch={dispatchWorkflowStep}
            />
          ) : null}
          {workflowRun &&
          workflowPostmortemRunId === workflowRun.id &&
          workflowRun.id !== dismissedWorkflowPostmortemRunId ? (
            <div
              className={`workflow-postmortem-prompt ${workflowRun.status}`}
              aria-label="Workflow retrospective prompt"
            >
              <div className="workflow-postmortem-prompt-top">
                <strong>
                  <WandSparkles size={14} />
                  Workflow retrospective
                </strong>
                <span>{workflowRun.status.replace("_", " ")}</span>
              </div>
              <textarea
                value={workflowPostmortemDraft}
                disabled={memoryBusy}
                onChange={(event) => setWorkflowPostmortemDraft(event.target.value)}
              />
              <div className="workflow-postmortem-actions">
                <button
                  type="button"
                  disabled={memoryBusy || !workflowPostmortemDraft.trim()}
                  onClick={() => void saveWorkflowPostmortem()}
                  title="Save this reviewed workflow lesson as retrospective project memory"
                >
                  <Save size={13} />
                  Save retrospective
                </button>
                <button
                  type="button"
                  disabled={memoryBusy}
                  onClick={() => {
                    setDismissedWorkflowPostmortemRunId(workflowRun.id);
                    setWorkflowPostmortemRunId(null);
                    setWorkflowPostmortemDraft("");
                  }}
                  title="Dismiss this retrospective prompt without writing project memory"
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
          <BackgroundTaskQueue language={language} tasks={backgroundTasks} />
          <ScheduledTaskPanel
            tasks={scheduledTasks}
            workerStatus={scheduledWorkerStatus}
            busyId={scheduledTaskBusyId}
            canCreate={Boolean(workspacePath)}
            canRun={Boolean(workspacePath)}
            onCreate={createSampleScheduledTask}
            onRunDue={runDueScheduledTasks}
            onToggle={toggleScheduledTask}
            onResume={resumeScheduledTask}
          />
          <div className="workflow-marketplace-grid">
            {filteredWorkflowTemplates.length === 0 ? (
              <div className="project-memory-empty">
                No workflow templates match the current skills search.
              </div>
            ) : (
              filteredWorkflowTemplates.map((template) => (
                <WorkflowTemplateCard
                  key={template.id}
                  focused={Boolean(normalizedFocusQuery) && matchesWorkflowTemplate(template, normalizedFocusQuery)}
                  template={template}
                  busy={workflowBusyId === template.id}
                  onPrepare={prepareWorkflow}
                />
              ))
            )}
          </div>
        </section>
        <section className="skill-square-section skill-manager-section">
          <SkillsManager activeThreadId={activeThreadId} language={language} />
        </section>
      </div>
    </section>
  );
}

function buildWorkflowPostmortemDraft(run: DesktopWorkflowRun): string {
  const completedSteps = run.steps.filter((step) => step.status === "completed").length;
  const blockedSteps = run.steps.filter((step) => step.status === "blocked").length;
  const currentStep = run.steps.find((step) => step.id === run.currentStepId);
  const outcome =
    run.status === "complete"
      ? "The workflow reached a completed state."
      : `The workflow is blocked${currentStep ? ` at ${currentStep.title}` : ""}.`;
  return [
    `Workflow retrospective candidate: ${run.name}`,
    `Status: ${run.status}`,
    `Outcome: ${outcome}`,
    `Run message: ${run.message}`,
    `Steps: ${completedSteps}/${run.steps.length} completed${blockedSteps ? `, ${blockedSteps} blocked` : ""}.`,
    `Verification: ${run.verification}`,
    "Lesson to reuse:",
  ].join("\n");
}

export function BackgroundTaskQueue({
  language,
  tasks,
}: {
  language: AppLanguage;
  tasks: DesktopBackgroundTask[];
}): React.JSX.Element {
  const zh = language === "zh";
  return (
    <div className="background-task-queue" data-testid="background-task-queue" role="region" aria-label={zh ? "后台任务" : "Background task queue"}>
      <div className="background-task-queue-top">
        <strong>
          <ClipboardList size={14} />
          {zh ? "后台任务" : "Background tasks"}
        </strong>
        <span>{tasks.length}</span>
      </div>
      {tasks.length === 0 ? (
        <div className="project-memory-empty">
          {zh ? "这个工作区还没有后台任务。" : "No background tasks have been queued for this workspace."}
        </div>
      ) : (
        <ol>
          {tasks.map((task) => {
            const state = getTaskStatePresentation(task, language);
            return (
              <li
                className={`${task.status} user-state-${state.key}`}
                data-task-id={task.id}
                data-task-status={task.status}
                data-testid="background-task-list-item"
                data-user-state={state.key}
                key={task.id}
              >
                <div className="background-task-list-summary">
                  <strong>{task.title}</strong>
                  <span
                    className="background-task-state-badge"
                    data-testid="background-task-list-status"
                    data-user-state={state.key}
                  >
                    <span aria-hidden="true" data-symbol={state.symbol} />
                    {state.label}
                  </span>
                </div>
                <small>{state.summary}</small>
                <details data-testid="background-task-detail">
                  <summary>{zh ? "查看任务详情" : "View task details"}</summary>
                  <div className="background-task-detail-grid">
                    <div>
                      <strong>{zh ? "当前状态" : "Current status"}</strong>
                      <span
                        className="background-task-state-badge"
                        data-testid="background-task-detail-status"
                        data-user-state={state.key}
                      >
                        <span aria-hidden="true" data-symbol={state.symbol} />
                        {state.label}
                      </span>
                    </div>
                    <p><strong>{zh ? "当前步骤" : "Current step"}</strong>{task.currentStep || state.defaultStep}</p>
                    <p><strong>{zh ? "接下来" : "Next"}</strong>{state.nextAction}</p>
                    {task.progress !== undefined ? (
                      <div
                        className="background-task-progress"
                        role="progressbar"
                        aria-label={zh ? `${task.title}进度` : `${task.title} progress`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={task.progress}
                      >
                        <span style={{ width: `${task.progress}%` }} />
                        <small>{task.progress}%</small>
                      </div>
                    ) : null}
                    {task.planSteps?.length ? (
                      <section className="background-task-plan" data-testid="background-task-plan">
                        <strong>{zh ? "执行计划" : "Plan"}</strong>
                        <ol>
                          {task.planSteps.map((step) => {
                            const completed = task.completedSteps?.includes(step.title) === true;
                            const adjusted = task.planAdjustments?.some((item) => item.failedStepId === step.id || item.failedStepTitle === step.title) === true;
                            const active = !completed && task.currentStep === step.title;
                            return (
                              <li
                                data-phase={step.phase}
                                data-plan-state={adjusted ? "adjusted" : completed ? "completed" : active ? "active" : "pending"}
                                key={step.id}
                              >
                                <span aria-hidden="true">{adjusted ? "⚠" : completed ? "✓" : active ? "→" : "○"}</span>
                                <span>{step.title}</span>
                              </li>
                            );
                          })}
                        </ol>
                      </section>
                    ) : null}
                    {task.planAdjustments?.length ? (() => {
                      const adjustment = task.planAdjustments[task.planAdjustments.length - 1];
                      return (
                        <section className="agent-plan-adjustment" data-testid="background-task-plan-adjustment" data-completeness={adjustment.completeness} role="status">
                          <header><span aria-hidden="true">⚠</span><strong>{zh ? "计划已调整，结果不完整" : "Plan adjusted; result incomplete"}</strong></header>
                          <dl>
                            <div><dt>{zh ? "未完成步骤" : "Step not completed"}</dt><dd>{adjustment.failedStepTitle}</dd></div>
                            <div><dt>{zh ? "原因" : "Reason"}</dt><dd>{adjustment.reason}</dd></div>
                            <div><dt>{zh ? "改为" : "Replacement"}</dt><dd>{adjustment.replacementStepTitle}</dd></div>
                            <div><dt>{zh ? "对结果的影响" : "Impact on result"}</dt><dd>{adjustment.impact}</dd></div>
                          </dl>
                        </section>
                      );
                    })() : null}
                    {task.completedSteps?.length ? (
                      <small>{zh ? "已完成：" : "Completed: "}{task.completedSteps.join(" · ")}</small>
                    ) : null}
                    {task.pendingDecisions?.length ? (
                      <small className="background-task-decisions">
                        {zh ? "需要你决定：" : "Needs you: "}{task.pendingDecisions.join(" · ")}
                      </small>
                    ) : null}
                    <p><strong>{zh ? "状态说明" : "Status detail"}</strong>{task.message}</p>
                    <small>{task.verification}</small>
                  </div>
                </details>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

type UserTaskState = "waiting" | "running" | "needs_decision" | "success" | "failure";

interface TaskStatePresentation {
  key: UserTaskState;
  label: string;
  symbol: string;
  summary: string;
  defaultStep: string;
  nextAction: string;
}

function getTaskStatePresentation(
  task: DesktopBackgroundTask,
  language: AppLanguage,
): TaskStatePresentation {
  const zh = language === "zh";
  const key: UserTaskState = task.status === "queued"
    ? "waiting"
    : task.status === "running"
      ? "running"
      : task.status === "waiting_approval" || (task.pendingDecisions?.length ?? 0) > 0
        ? "needs_decision"
        : task.status === "completed"
          ? "success"
          : "failure";
  const content: Record<UserTaskState, Omit<TaskStatePresentation, "key">> = {
    waiting: {
      label: zh ? "等待中" : "Waiting",
      symbol: "○",
      summary: zh ? "任务已加入队列，尚未开始。" : "The task is queued and has not started yet.",
      defaultStep: zh ? "等待可用资源" : "Waiting for available capacity",
      nextAction: zh ? "系统会自动开始，无需操作。" : "It will start automatically; no action is needed.",
    },
    running: {
      label: zh ? "进行中" : "Running",
      symbol: "▶",
      summary: zh ? "任务正在处理，状态会自动更新。" : "The task is being processed and will update automatically.",
      defaultStep: zh ? "正在执行任务" : "Working on the task",
      nextAction: zh ? "可以离开此页面，完成后会更新结果。" : "You can leave this page; the result will update when ready.",
    },
    needs_decision: {
      label: zh ? "需要决定" : "Needs a decision",
      symbol: "!",
      summary: zh ? "任务在等待你的选择，决定后才能继续。" : "The task needs your choice before it can continue.",
      defaultStep: zh ? "等待你的决定" : "Waiting for your decision",
      nextAction: zh ? "打开待确认事项并作出选择。" : "Open the pending decision and choose an option.",
    },
    success: {
      label: zh ? "已完成" : "Completed",
      symbol: "✓",
      summary: zh ? "任务已成功完成，可以查看成果。" : "The task completed successfully and its results are ready.",
      defaultStep: zh ? "任务已完成" : "Task completed",
      nextAction: zh ? "查看完成摘要和成果。" : "Review the completion summary and results.",
    },
    failure: {
      label: zh ? "未完成" : "Not completed",
      symbol: "×",
      summary: zh ? "任务没有完成，请查看原因和恢复建议。" : "The task did not complete; review the reason and recovery guidance.",
      defaultStep: zh ? "任务已停止" : "Task stopped",
      nextAction: zh ? "查看失败原因，修复后重试。" : "Review the failure, fix the issue, and retry.",
    },
  };
  return { key, ...content[key] };
}

function ScheduledTaskPanel({
  tasks,
  workerStatus,
  busyId,
  canCreate,
  canRun,
  onCreate,
  onRunDue,
  onToggle,
  onResume,
}: {
  tasks: DesktopScheduledTask[];
  workerStatus: DesktopScheduledTaskWorkerStatus | null;
  busyId: string | null;
  canCreate: boolean;
  canRun: boolean;
  onCreate: () => void;
  onRunDue: () => void;
  onToggle: (task: DesktopScheduledTask) => void;
  onResume: (task: DesktopScheduledTask) => void;
}): React.JSX.Element {
  return (
    <div className="scheduled-task-panel" aria-label="Scheduled and monitoring tasks">
      <div className="scheduled-task-panel-top">
        <strong>
          <CalendarClock size={14} />
          Scheduled monitors
        </strong>
        <button
          type="button"
          disabled={!canCreate || busyId === "create"}
          onClick={onCreate}
          title="Create a reviewable scheduled monitor definition"
        >
          <Play size={13} />
          {busyId === "create" ? "Creating" : "Create monitor"}
        </button>
        <button
          type="button"
          disabled={!canRun || busyId === "run-due"}
          onClick={onRunDue}
          title="Scan due monitors and queue approval-gated workflow runs"
        >
          <RefreshCw size={13} />
          {busyId === "run-due" ? "Scanning" : "Run due"}
        </button>
      </div>
      {workerStatus ? (
        <div
          className={`scheduled-worker-status ${workerStatus.running ? "running" : "idle"}`}
          aria-label="Scheduler worker status"
        >
          <div>
            <strong>{workerStatus.running ? "Worker scanning" : "Worker ready"}</strong>
            <span>{workerStatus.enabled ? "enabled" : "disabled"}</span>
          </div>
          <p>{workerStatus.message}</p>
          <small>
            Interval {formatDuration(workerStatus.intervalMs)}
            {workerStatus.nextRunAt
              ? ` · Next ${formatMemoryTime(workerStatus.nextRunAt)}`
              : ""}
          </small>
          {workerStatus.lastResult ? (
            <small>
              Last scan checked {workerStatus.lastResult.checked}, triggered{" "}
              {workerStatus.lastResult.triggered}, reconnected{" "}
              {workerStatus.lastResult.reconnected}, blocked{" "}
              {workerStatus.lastResult.blocked}
            </small>
          ) : null}
          {workerStatus.lastError ? <small>{workerStatus.lastError}</small> : null}
        </div>
      ) : null}
      {tasks.length === 0 ? (
        <div className="project-memory-empty">
          No scheduled monitors are configured for this workspace.
        </div>
      ) : (
        <ol>
          {tasks.map((task) => (
            <li className={task.status} key={task.id}>
              <div>
                <strong>{task.title}</strong>
                <span>{task.status}</span>
              </div>
              <small>
                {task.kind} every {task.cadence}
              </small>
              <small>{task.target}</small>
              {task.nextRunAt ? <small>Next: {formatMemoryTime(task.nextRunAt)}</small> : null}
              {task.activeWorkflowRunId ? (
                <small>
                  Active run: {task.activeWorkflowRunId}
                  {task.activeWorkflowRunStatus
                    ? ` (${task.activeWorkflowRunStatus.replace("_", " ")})`
                    : ""}
                </small>
              ) : null}
              <p>{task.message}</p>
              <small>{task.verification}</small>
              <button
                type="button"
                className="scheduled-task-toggle"
                disabled={busyId === task.id}
                onClick={() => onToggle(task)}
                title={task.status === "paused" ? "Enable scheduled monitor" : "Pause scheduled monitor"}
              >
                {task.status === "paused" ? <Play size={13} /> : <PauseCircle size={13} />}
                {task.status === "paused" ? "Enable" : "Pause"}
              </button>
              {task.status === "blocked" ? (
                <button
                  type="button"
                  className="scheduled-task-toggle"
                  disabled={busyId === `${task.id}:resume`}
                  onClick={() => onResume(task)}
                  title="Resume this monitor and include it in the next due scan"
                >
                  <RefreshCw size={13} />
                  {busyId === `${task.id}:resume` ? "Resuming" : "Resume"}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "unknown";
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return `${Math.round(ms / 1000)}s`;
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

function WorkflowRunExecution({
  run,
  busyStepKey,
  onDispatch,
}: {
  run: DesktopWorkflowRun;
  busyStepKey: string | null;
  onDispatch: (run: DesktopWorkflowRun, stepId: string) => void;
}): React.JSX.Element {
  return (
    <div className={`workflow-run-execution ${run.status}`} aria-label="Workflow run status">
      <div className="workflow-run-recipe-top">
        <strong>{run.name}</strong>
        <span>{run.status.replace("_", " ")}</span>
      </div>
      <p>{run.message}</p>
      {run.resumePlan ? (
        <div className="workflow-resume-plan" aria-label="Workflow restart resume plan">
          <strong>Restart resume</strong>
          <span>
            {run.resumePlan.pendingStepCount} pending,{" "}
            {run.resumePlan.resumableStepIds.length} resumable,{" "}
            {run.resumePlan.waitingApprovalStepIds.length} waiting approval
          </span>
          <small>{run.resumePlan.message}</small>
        </div>
      ) : null}
      <ol>
        {run.steps.map((step) => (
          <li className={step.status} key={step.id}>
            <strong>{step.title}</strong>
            <span>{step.status.replace("_", " ")}</span>
            <small>{step.command ?? step.detail}</small>
            <small>{step.message}</small>
            {step.resumeMessage ? <small>{step.resumeMessage}</small> : null}
            <button
              type="button"
              className="workflow-step-dispatch"
              disabled={!canDispatchWorkflowStep(step) || busyStepKey === `${run.id}:${step.id}`}
              onClick={() => onDispatch(run, step.id)}
              title={getWorkflowDispatchTitle(step)}
            >
              {getWorkflowDispatchIcon(step)}
              {busyStepKey === `${run.id}:${step.id}`
                ? "Dispatching"
                : getWorkflowDispatchLabel(step)}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function canDispatchWorkflowStep(step: DesktopWorkflowRun["steps"][number]): boolean {
  return (
    step.status !== "blocked" &&
    step.status !== "waiting_approval" &&
    step.status !== "completed" &&
    step.kind !== "approval"
  );
}

function getWorkflowDispatchLabel(step: DesktopWorkflowRun["steps"][number]): string {
  if (step.resumeAction === "dispatch_chat") return "Resume chat";
  if (step.resumeAction === "prepare_terminal") return "Resume terminal";
  if (step.resumeAction === "reconnect_external") return "Reconnect runtime";
  if (step.resumeAction === "confirm_manual") return "Resume checkpoint";
  if (step.kind === "chat_command") return "Send to chat";
  if (step.kind === "terminal_command") return "Prepare terminal";
  if (step.kind === "external_runtime") return "Reconnect runtime";
  return "Mark done";
}

function getWorkflowDispatchTitle(step: DesktopWorkflowRun["steps"][number]): string {
  if (step.resumeAction === "dispatch_chat") {
    return "Resume this recovered step by moving the command into the chat bar.";
  }
  if (step.resumeAction === "prepare_terminal") {
    return "Resume this recovered step through the terminal approval path.";
  }
  if (step.resumeAction === "reconnect_external") {
    return "Resume this recovered external runtime through its provider-specific reconnect path.";
  }
  if (step.resumeAction === "confirm_manual") {
    return "Confirm this recovered manual checkpoint.";
  }
  if (step.kind === "chat_command") return "Move this command into the chat bar.";
  if (step.kind === "terminal_command") {
    return "Prepare this command for the terminal approval path.";
  }
  if (step.kind === "external_runtime") {
    return "Reconnect or restart the external runtime through its provider-specific control plane.";
  }
  return "Mark this manual checkpoint complete.";
}

function getWorkflowDispatchIcon(step: DesktopWorkflowRun["steps"][number]): React.JSX.Element {
  if (step.kind === "chat_command") return <Send size={13} />;
  if (step.kind === "terminal_command") return <Terminal size={13} />;
  if (step.kind === "external_runtime") return <Cable size={13} />;
  return <CheckCircle2 size={13} />;
}

function formatMemoryTime(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

function WorkflowTemplateCard({
  focused,
  template,
  busy,
  onPrepare,
}: {
  focused: boolean;
  template: DesktopWorkflowTemplate;
  busy: boolean;
  onPrepare: (template: DesktopWorkflowTemplate) => void;
}): React.JSX.Element {
  const canPrepare = template.status === "available";
  return (
    <article className={`workflow-template-card ${template.status} ${focused ? "focused" : ""}`}>
      <div className="workflow-template-card-top">
        <strong>{template.name}</strong>
        <span>{template.status}</span>
      </div>
      <p>{template.summary}</p>
      <dl className="workflow-template-meta">
        <div>
          <dt>Trigger</dt>
          <dd>{template.trigger}</dd>
        </div>
        <div>
          <dt>Approval</dt>
          <dd>{template.approvalRequired ? "Required" : "Not required"}</dd>
        </div>
        <div>
          <dt>Risk</dt>
          <dd>{template.risk}</dd>
        </div>
      </dl>
      <ol>
        {template.steps.slice(0, 4).map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <div className="workflow-template-footer">
        <span>{template.category}</span>
        <small>{template.verification}</small>
      </div>
      <button
        type="button"
        className="workflow-template-prepare"
        disabled={!canPrepare || busy}
        onClick={() => onPrepare(template)}
      >
        <Play size={14} />
        {busy ? "Preparing" : canPrepare ? "Prepare run" : "Not available"}
      </button>
    </article>
  );
}

function normalizeSkillSquareQuery(value: string): string {
  return value.trim().toLowerCase();
}

function matchesWorkflowTemplate(
  template: DesktopWorkflowTemplate,
  normalizedQuery: string,
): boolean {
  return [
    template.id,
    template.name,
    template.category,
    template.status,
    template.summary,
    template.trigger,
    template.verification,
    ...template.steps,
    ...template.requiredCapabilities,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}
