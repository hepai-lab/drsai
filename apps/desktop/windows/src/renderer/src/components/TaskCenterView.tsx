import { useEffect, useState } from "react";
import type {
  DesktopBackgroundTask,
  DesktopScheduledTask,
  DesktopScheduledTaskUserDefinition,
} from "@shared/desktopApi";
import { desktopApi } from "../desktopApi";
import type { AppLanguage } from "../navigation";
import {
  getNextWeeklyRunAt,
  parseNaturalLanguageSchedule,
  type NaturalLanguageScheduleDraft,
} from "../naturalLanguageSchedule";
import { BackgroundTaskQueue } from "./SkillSquareView";

export function TaskCenterView({ language, workspacePath }: { language: AppLanguage; workspacePath: string }): React.JSX.Element {
  const zh = language === "zh";
  const [tasks, setTasks] = useState<DesktopBackgroundTask[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<DesktopScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scheduleText, setScheduleText] = useState("每周一上午九点检查这个文件夹的新数据");
  const [draft, setDraft] = useState<NaturalLanguageScheduleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTime, setEditTime] = useState("09:00");
  const [editMaterial, setEditMaterial] = useState("");
  const [editAction, setEditAction] = useState("");
  const [editNotification, setEditNotification] = useState("");

  useEffect(() => {
    let active = true;
    async function refresh(): Promise<void> {
      try {
        const [background, scheduled] = await Promise.all([
          desktopApi.listBackgroundTasks({ workspacePath, limit: 50 }),
          desktopApi.listScheduledTasks({ workspacePath, limit: 50 }),
        ]);
        if (!active) return;
        setTasks(background);
        setScheduledTasks(scheduled);
        setError("");
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (active) setLoading(false);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [workspacePath]);

  function understand(): void {
    try {
      setDraft(parseNaturalLanguageSchedule(scheduleText, workspacePath));
      setMessage(zh ? "已读懂，请确认下面的安排。" : "Understood. Please confirm the schedule below.");
      setError("");
    } catch (caught) {
      setDraft(null);
      setMessage("");
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function confirm(): Promise<void> {
    if (!draft) return;
    setBusy(true);
    try {
      const saved = await desktopApi.createScheduledTask({
        kind: "monitor",
        title: draft.title,
        cadence: draft.cadence,
        target: draft.target,
        workspacePath,
        workflowTemplateId: "plan-review-fix",
        nextRunAt: draft.nextRunAt,
        approvalRequired: false,
        message: "安排已确认；到点后检查当前文件夹的新数据。",
        verification: "可在“已安排”中查看或编辑时间、材料、动作和通知方式。",
        userDefinition: { ...draft.definition, confirmedAt: new Date().toISOString() },
      });
      setScheduledTasks((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setDraft(null);
      setMessage(zh ? "安排已保存，可在下方查看和编辑。" : "Schedule saved. You can view and edit it below.");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(task: DesktopScheduledTask): void {
    const definition = task.userDefinition;
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditTime(definition?.localTime ?? "09:00");
    setEditMaterial(definition?.materialDescription ?? `当前文件夹：${task.target}`);
    setEditAction(definition?.actionDescription ?? task.target);
    setEditNotification(definition?.notificationDescription ?? "完成后通过 Windows 通知");
    setMessage("");
  }

  async function saveEdit(task: DesktopScheduledTask): Promise<void> {
    const definition = task.userDefinition;
    const [hour, minute] = editTime.split(":").map(Number);
    if (!definition || !editTitle.trim() || !editMaterial.trim() || !editAction.trim() ||
      !editNotification.trim() || !Number.isInteger(hour) || !Number.isInteger(minute) ||
      hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      setError(zh ? "请完整填写标题、时间、材料、动作和通知方式。" : "Complete every schedule field before saving.");
      return;
    }
    setBusy(true);
    try {
      const weekday = definition.weekday ?? 1;
      const updatedDefinition: DesktopScheduledTaskUserDefinition = {
        ...definition,
        localTime: editTime,
        timeDescription: `${weekdayLabel(weekday, zh)} ${editTime}`,
        materialDescription: editMaterial.trim(),
        actionDescription: editAction.trim(),
        notificationDescription: editNotification.trim(),
      };
      const updated = await desktopApi.updateScheduledTask({
        taskId: task.id,
        status: task.status,
        title: editTitle.trim(),
        cadence: task.cadence,
        target: task.target,
        nextRunAt: getNextWeeklyRunAt(new Date(), weekday, hour, minute),
        userDefinition: updatedDefinition,
        message: "安排已更新；将按新的设置执行。",
      });
      setScheduledTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setEditingId(null);
      setMessage(zh ? "修改已保存。" : "Changes saved.");
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(task: DesktopScheduledTask, status: "enabled" | "paused"): Promise<void> {
    setBusy(true);
    try {
      const updated = await desktopApi.updateScheduledTask({ taskId: task.id, status });
      setScheduledTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
      setMessage(status === "paused"
        ? (zh ? "安排已暂停，下次触发前不会执行。" : "Schedule paused. It will not run at the next trigger.")
        : (zh ? "安排已恢复，将从下次触发继续执行。" : "Schedule resumed for its next trigger."));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(task: DesktopScheduledTask): Promise<void> {
    setBusy(true);
    try {
      const result = await desktopApi.deleteScheduledTask({ taskId: task.id });
      setScheduledTasks((current) => current.filter((item) => item.id !== task.id));
      setDeletingId(null);
      setMessage(result.historyPolicy === "retain_results"
        ? (zh ? "安排已删除，不会再执行；已有任务结果仍会保留。" : "Schedule deleted. It will not run again; existing results are retained.")
        : result.message);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  return <section className="task-center-view" data-testid="task-center-view">
    <header><div><h2>{zh ? "任务中心" : "Task center"}</h2><p>{zh ? "创建安排，并统一查看任务状态。" : "Create schedules and see task status in one place."}</p></div><span role="status">{loading ? (zh ? "正在更新…" : "Updating…") : (zh ? "状态已同步" : "Status synced")}</span></header>
    {error ? <p className="task-center-error" id="natural-schedule-error" role="alert">{error}</p> : null}
    <section className="natural-schedule-card" aria-label={zh ? "用一句话创建安排" : "Create a schedule in plain language"}>
      <div className="natural-schedule-heading"><h3>{zh ? "用一句话创建安排" : "Create a schedule in plain language"}</h3><p>{zh ? "例如：每周一上午九点检查这个文件夹的新数据" : "For example: Check this folder for new data every Monday at 9 AM."}</p></div>
      <div className="natural-schedule-input-row"><input data-testid="natural-schedule-input" value={scheduleText} onChange={(event) => setScheduleText(event.target.value)} aria-label={zh ? "安排说明" : "Schedule instruction"} aria-invalid={Boolean(error)} aria-describedby={error ? "natural-schedule-error" : undefined} /><button type="button" data-testid="natural-schedule-understand" onClick={understand}>{zh ? "读懂并预览" : "Preview"}</button></div>
      {draft ? <div className="schedule-confirmation" data-testid="schedule-confirmation"><strong>{zh ? "请确认这项安排" : "Confirm this schedule"}</strong><ScheduleDefinition definition={draft.definition} zh={zh} /><div className="schedule-confirm-actions"><button type="button" onClick={() => setDraft(null)}>{zh ? "取消" : "Cancel"}</button><button type="button" data-testid="schedule-confirm-save" disabled={busy} onClick={() => void confirm()}>{busy ? (zh ? "保存中…" : "Saving…") : (zh ? "确认并保存" : "Confirm and save")}</button></div></div> : null}
      {message ? <p className="schedule-message" role="status">{message}</p> : null}
    </section>
    <section className="saved-schedules" aria-label={zh ? "已保存的安排" : "Saved schedules"}>
      <div className="saved-schedules-heading"><h3>{zh ? "已保存的安排" : "Saved schedules"}</h3><span>{scheduledTasks.length}</span></div>
      {scheduledTasks.length === 0 ? <p className="saved-schedules-empty">{zh ? "还没有安排。" : "No schedules yet."}</p> : <ol>{scheduledTasks.map((task) => {
        const definition = task.userDefinition;
        return <li key={task.id} data-testid="saved-schedule-item" data-task-id={task.id}>{editingId === task.id && definition ? <div className="schedule-edit-form" data-testid="schedule-edit-form">
          <label>{zh ? "标题" : "Title"}<input value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label>{zh ? "时间" : "Time"}<input type="time" value={editTime} onChange={(event) => setEditTime(event.target.value)} /></label><label>{zh ? "材料" : "Material"}<input value={editMaterial} onChange={(event) => setEditMaterial(event.target.value)} /></label><label>{zh ? "动作" : "Action"}<input value={editAction} onChange={(event) => setEditAction(event.target.value)} /></label><label>{zh ? "通知" : "Notification"}<input value={editNotification} onChange={(event) => setEditNotification(event.target.value)} /></label><div className="schedule-confirm-actions"><button type="button" onClick={() => setEditingId(null)}>{zh ? "取消" : "Cancel"}</button><button type="button" data-testid="schedule-edit-save" disabled={busy} onClick={() => void saveEdit(task)}>{zh ? "保存修改" : "Save changes"}</button></div>
        </div> : <><div className="saved-schedule-title"><strong>{task.title}</strong><span className={task.status}>{task.status === "enabled" ? (zh ? "已开启" : "Enabled") : task.status === "paused" ? (zh ? "已暂停" : "Paused") : (zh ? "需处理" : "Needs attention")}</span></div>{definition ? <ScheduleDefinition definition={definition} zh={zh} /> : <p>{task.target}</p>}{task.lastTriggerAudit ? <div className="schedule-trigger-audit" data-testid="schedule-trigger-audit"><strong>{task.lastTriggerAudit.missed ? (zh ? "已补跑错过的安排" : "Missed schedule caught up") : (zh ? "已按时触发" : "Triggered on time")}</strong><span>{zh ? "计划时间" : "Scheduled"}：{new Date(task.lastTriggerAudit.scheduledFor).toLocaleString()}</span><span>{zh ? "实际触发" : "Triggered"}：{new Date(task.lastTriggerAudit.triggeredAt).toLocaleString()}</span><span>{zh ? "时区与夏令时" : "Timezone and DST"}：{task.lastTriggerAudit.timezone} · {zh ? "保持当地钟表时间" : "follow local wall clock"}</span></div> : null}<div className="schedule-management-actions" data-testid="schedule-management-actions"><button type="button" data-testid="schedule-edit" disabled={!definition || busy} onClick={() => beginEdit(task)}>{zh ? "编辑" : "Edit"}</button><button type="button" data-testid={task.status === "enabled" ? "schedule-pause" : "schedule-resume"} disabled={busy} onClick={() => void changeStatus(task, task.status === "enabled" ? "paused" : "enabled")}>{task.status === "enabled" ? (zh ? "暂停" : "Pause") : (zh ? "恢复" : "Resume")}</button><button type="button" className="schedule-delete-button" data-testid="schedule-delete" disabled={busy} onClick={() => setDeletingId(task.id)}>{zh ? "删除" : "Delete"}</button></div>{deletingId === task.id ? <div className="schedule-delete-confirmation" data-testid="schedule-delete-confirmation"><strong>{zh ? "确定删除这个安排？" : "Delete this schedule?"}</strong><p>{zh ? "删除后不再执行未来安排，已有任务结果仍会保留。" : "Future runs will stop; existing task results will be retained."}</p><div className="schedule-confirm-actions"><button type="button" data-testid="schedule-delete-cancel" onClick={() => setDeletingId(null)}>{zh ? "取消" : "Cancel"}</button><button type="button" data-testid="schedule-delete-confirm" disabled={busy} onClick={() => void confirmDelete(task)}>{zh ? "确认删除" : "Delete schedule"}</button></div></div> : null}</>}</li>;
      })}</ol>}
    </section>
    <BackgroundTaskQueue language={language} tasks={tasks} />
  </section>;
}

function ScheduleDefinition({ definition, zh }: { definition: Omit<DesktopScheduledTaskUserDefinition, "confirmedAt"> | DesktopScheduledTaskUserDefinition; zh: boolean }): React.JSX.Element {
  return <dl className="schedule-definition"><div><dt>{zh ? "时间" : "Time"}</dt><dd>{definition.timeDescription}（{definition.timezone}）</dd></div><div><dt>{zh ? "材料" : "Material"}</dt><dd>{definition.materialDescription}</dd></div><div><dt>{zh ? "动作" : "Action"}</dt><dd>{definition.actionDescription}</dd></div><div><dt>{zh ? "通知" : "Notification"}</dt><dd>{definition.notificationDescription}</dd></div></dl>;
}

function weekdayLabel(weekday: number, zh: boolean): string {
  const labels = zh ? ["每周日", "每周一", "每周二", "每周三", "每周四", "每周五", "每周六"] : ["Every Sunday", "Every Monday", "Every Tuesday", "Every Wednesday", "Every Thursday", "Every Friday", "Every Saturday"];
  return labels[weekday] ?? labels[1];
}
