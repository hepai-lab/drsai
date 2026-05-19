import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfigProvider, Result, Segmented, Spin, Typography, message, theme } from "antd";
import "./UsageAnalyticsPage.css";
import { appContext } from "../../hooks/provider";
import {
    adminAnalyticsAPI,
    organizationsAPI,
    type AdminUsageOverviewData,
} from "../../components/views/api";

/** 管理端统计统一按北京时间展示（与服务器/用户本机时区无关）。 */
const ANALYTICS_DISPLAY_TZ = "Asia/Shanghai";

/**
 * 后端常见：ISO 串无 Z / 无时区后缀，但实际存的是 UTC。浏览器会把无后缀 ISO 当「本地时间」，会偏 8h。
 * 无显式时区时按 UTC 解析，再交给 toLocaleString 换到北京时间。
 */
function parseAnalyticsInstant(raw: string): Date {
    let s = String(raw).trim();
    if (!s) return new Date(NaN);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) {
        s = s.replace(" ", "T");
    }
    const hasExplicitZone = /[zZ]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
    if (hasExplicitZone) {
        return new Date(s);
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
        return new Date(`${s}Z`);
    }
    return new Date(s);
}

function formatAnalyticsDateTime(raw: string | null | undefined): string {
    if (raw == null || raw === "") return "";
    const d = parseAnalyticsInstant(String(raw));
    if (Number.isNaN(d.getTime())) return String(raw);
    return d.toLocaleString("zh-CN", {
        hour12: false,
        timeZone: ANALYTICS_DISPLAY_TZ,
    });
}

/** 图表只展示后端已解析出显示名的智能体；agent_name 为空则不入图。 */
function hasResolvedAgentName(agentName: unknown): boolean {
    return agentName != null && String(agentName).trim().length > 0;
}

type TopAgentRow = AdminUsageOverviewData["top_agents_by_usage_records"][number];

type UsageEventRow = AdminUsageOverviewData["usage_events"][number];

type SessionUserRow = AdminUsageOverviewData["sessions_per_user"][number];

type DashboardStats = {
    activeUsers: number;
    activeAgents: number;
    totalSessions: number;
    totalRuns: number;
    usageRecords: number;
    totalUseCount: number;
};

function beijingDayKey(ms: number): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: ANALYTICS_DISPLAY_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date(ms));
}

function computeDashboardStats(overview: AdminUsageOverviewData | null): DashboardStats | null {
    if (!overview) return null;
    const usageEvents = overview.usage_events || [];
    const sessions = overview.sessions_per_user || [];
    const runs = overview.runs_per_user || [];
    const topAgents = overview.top_agents_by_usage_records || [];

    const userIds = new Set<string>();
    const agentIds = new Set<string>();
    let totalUseCount = 0;

    for (const row of usageEvents) {
        if (row.user_id) userIds.add(String(row.user_id));
        if (row.agent_id) agentIds.add(String(row.agent_id));
        totalUseCount += Math.max(0, Number(row.use_count ?? 0) || 0);
    }
    for (const row of sessions) {
        if (row.user_id) userIds.add(String(row.user_id));
    }
    for (const row of runs) {
        if (row.user_id) userIds.add(String(row.user_id));
    }
    for (const row of topAgents) {
        if (row.agent_id) agentIds.add(String(row.agent_id));
    }

    const totalSessions = sessions.reduce((sum, row) => sum + (Number(row.session_count) || 0), 0);
    const totalRuns = runs.reduce((sum, row) => sum + (Number(row.run_count) || 0), 0);

    return {
        activeUsers: userIds.size,
        activeAgents: agentIds.size,
        totalSessions,
        totalRuns,
        usageRecords: usageEvents.length,
        totalUseCount,
    };
}

const CHART_HEIGHT = {
    row: 300,
    scatter: 420,
} as const;

const RECENT_TODAY_FEED_LIMIT = 20;

const TOP_AGENTS_CHART_LIMIT = 8;
const TOP_USERS_CHART_LIMIT = 10;

const DashboardStatCard: React.FC<{ label: string; value: string | number; hint?: string }> = ({
    label,
    value,
    hint,
}) => (
    <div className="usage-analytics-stat">
        <div className="usage-analytics-stat-label">{label}</div>
        <div className="usage-analytics-stat-value">{value}</div>
        {hint ? <div className="usage-analytics-stat-hint">{hint}</div> : null}
    </div>
);

const ChartCard: React.FC<{
    title: string;
    caption?: string;
    badge?: string;
    height: number;
    wide?: boolean;
    className?: string;
    headerExtra?: React.ReactNode;
    loading: boolean;
    children: React.ReactNode;
}> = ({ title, caption, badge, height, wide, className, headerExtra, loading, children }) => (
    <div
        className={`usage-analytics-chart-card${wide ? " usage-analytics-chart-card--wide" : ""}${className ? ` ${className}` : ""}`}
    >
        <div className="usage-analytics-chart-card-head">
            <div className="min-w-0 flex-1">
                <h3 className="usage-analytics-chart-card-title">{title}</h3>
                {caption ? <p className="usage-analytics-chart-card-caption">{caption}</p> : null}
            </div>
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {headerExtra}
                {badge ? <span className="usage-analytics-chart-card-badge">{badge}</span> : null}
            </div>
        </div>
        <div className="usage-analytics-chart-card-body relative" style={{ height }}>
            {loading ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#07060d]/60">
                    <Spin size="small" />
                </div>
            ) : null}
            {children}
        </div>
    </div>
);

const USAGE_SCATTER_MAX_POINTS = 350;

/** 图上只展示「最近一周」内的打卡（滚动 7×24h，本地毫秒时间轴）。 */
const USAGE_SCATTER_WINDOW_DAYS = 7;

const USAGE_SCATTER_WINDOW_MS = USAGE_SCATTER_WINDOW_DAYS * 24 * 60 * 60 * 1000;

const ANALYTICS_CHART_COLORS = {
    axisMuted: "rgba(168, 85, 247, 0.28)",
    splitMuted: "rgba(124, 58, 237, 0.12)",
    labelColor: "#a78bfa",
    tipTitle: "#f5f3ff",
    tipBody: "#ddd6fe",
    accent: "#a855f7",
    accentBright: "#c084fc",
    gradient: ["#1e0533", "#4c1d95", "#7c3aed", "#9333ea", "#a855f7", "#c084fc", "#e879f9"],
} as const;

const AnalyticsShell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ConfigProvider
        theme={{
            algorithm: theme.darkAlgorithm,
            token: {
                colorPrimary: "#a855f7",
                colorBgContainer: "#120c1c",
                colorBgElevated: "#1a1028",
                colorBorder: "rgba(168, 85, 247, 0.22)",
                colorText: "#ede9fe",
                colorTextSecondary: "rgba(196, 181, 253, 0.65)",
                borderRadius: 12,
            },
        }}
    >
        <div className="usage-analytics-shell relative h-full min-h-0 flex flex-col overflow-auto bg-[#07060d] text-purple-100/90">
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-28 -left-24 h-[28rem] w-[28rem] rounded-full bg-purple-600/18 blur-3xl" />
                <div className="absolute top-1/4 -right-16 h-80 w-80 rounded-full bg-violet-500/12 blur-3xl" />
                <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-fuchsia-600/10 blur-3xl" />
                <div
                    className="absolute inset-0 opacity-[0.35]"
                    style={{
                        backgroundImage:
                            "radial-gradient(circle at 1px 1px, rgba(168,85,247,0.08) 1px, transparent 0)",
                        backgroundSize: "28px 28px",
                    }}
                />
            </div>
            <div className="relative z-10 flex min-h-0 flex-1 flex-col p-4 md:p-6">{children}</div>
        </div>
    </ConfigProvider>
);
function usageEventTimeRaw(row: UsageEventRow): string | undefined {
    const a = row.last_used_at ?? row.updated_at;
    if (a != null && String(a).trim() !== "") return String(a);
    const c = row.created_at as string | undefined;
    if (c != null && String(c).trim() !== "") return String(c);
    return undefined;
}

type TodayStats = {
    todayKey: string;
    dau: number;
    activeAgents: number;
    usagePairs: number;
    newSessions: number;
    activeSessions: number;
    recentEvents: Array<{
        time: string;
        agentName: string;
        userId: string;
        useCount: number;
    }>;
};

function beijingTodayKey(): string {
    return beijingDayKey(Date.now());
}

function isBeijingToday(raw: string | null | undefined): boolean {
    if (raw == null || raw === "") return false;
    const d = parseAnalyticsInstant(String(raw));
    if (Number.isNaN(d.getTime())) return false;
    return beijingDayKey(d.getTime()) === beijingTodayKey();
}

function formatAnalyticsTimeOnly(raw: string): string {
    const d = parseAnalyticsInstant(raw);
    if (Number.isNaN(d.getTime())) return String(raw);
    return d.toLocaleString("zh-CN", {
        hour12: false,
        timeZone: ANALYTICS_DISPLAY_TZ,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

function computeTodayStats(overview: AdminUsageOverviewData | null): TodayStats | null {
    if (!overview) return null;

    const todayKey = beijingTodayKey();
    const usageEvents = overview.usage_events || [];
    const sessions = overview.recent_sessions_preview || [];

    const todayUserIds = new Set<string>();
    const todayAgentIds = new Set<string>();
    let usagePairs = 0;
    const todayEvents: Array<{ t: number; row: UsageEventRow }> = [];

    for (const row of usageEvents) {
        const raw = usageEventTimeRaw(row);
        if (!isBeijingToday(raw)) continue;
        usagePairs += 1;
        if (row.user_id) todayUserIds.add(String(row.user_id));
        if (hasResolvedAgentName(row.agent_name) && row.agent_id) {
            todayAgentIds.add(String(row.agent_id));
        }
        const d = parseAnalyticsInstant(String(raw));
        if (!Number.isNaN(d.getTime())) {
            todayEvents.push({ t: d.getTime(), row });
        }
    }

    let newSessions = 0;
    let activeSessions = 0;
    for (const session of sessions) {
        if (isBeijingToday(session.created_at)) newSessions += 1;
        if (isBeijingToday(session.updated_at)) activeSessions += 1;
    }

    todayEvents.sort((a, b) => b.t - a.t);
    const recentEvents = todayEvents.slice(0, RECENT_TODAY_FEED_LIMIT).map(({ row }) => {
        const raw = usageEventTimeRaw(row)!;
        return {
            time: formatAnalyticsTimeOnly(raw),
            agentName: hasResolvedAgentName(row.agent_name) ? String(row.agent_name).trim() : "—",
            userId: String(row.user_id || "—"),
            useCount: Math.max(0, Number(row.use_count ?? 0) || 0),
        };
    });

    return {
        todayKey,
        dau: todayUserIds.size,
        activeAgents: todayAgentIds.size,
        usagePairs,
        newSessions,
        activeSessions,
        recentEvents,
    };
}

function usageScatterYKey(row: UsageEventRow): string {
    const name = String(row.agent_name ?? "").trim();
    const u = String(row.user_id || "—");
    return `${name}\x00${u}`;
}

function truncateAxisText(text: string, max: number): string {
    if (text.length <= max) return text;
    return `${text.slice(0, max - 1)}…`;
}

type EChartsHandle = {
    setOption(option: unknown, notMerge?: boolean): void;
    resize(): void;
    dispose(): void;
};

/** UMD/`echarts$` webpack bundle exposes API on `default` or top-level depending on tooling. */
function getEchartsFromImport(mod: unknown): { init: (dom: HTMLElement | null) => EChartsHandle } {
    const root = mod as Record<string, unknown>;
    const candidate = (root.default ?? root) as Record<string, unknown>;
    const init = candidate.init;
    if (typeof init !== "function") {
        throw new Error("echarts: expected init() on dynamic import module");
    }
    return candidate as { init: (dom: HTMLElement | null) => EChartsHandle };
}

/** 时间轴散点：X=调用时间，Y=智能体·用户，点大小≈use_count。 */
const RecentAgentUsageScatterChart: React.FC<{ loading: boolean; rows: UsageEventRow[] }> = ({
    loading,
    rows,
}) => {
    const hostRef = useRef<HTMLDivElement | null>(null);

    const scatterWindowStats = useMemo(() => {
        const nowMs = Date.now();
        const windowStartMs = nowMs - USAGE_SCATTER_WINDOW_MS;
        let anyValidTime = false;
        let anyNamedWithValidTime = false;
        let namedInWindow = 0;
        for (const row of rows) {
            const raw = usageEventTimeRaw(row);
            if (!raw) continue;
            const d = parseAnalyticsInstant(raw);
            if (Number.isNaN(d.getTime())) continue;
            anyValidTime = true;
            if (!hasResolvedAgentName(row.agent_name)) continue;
            anyNamedWithValidTime = true;
            if (d.getTime() >= windowStartMs) namedInWindow++;
        }
        return {
            anyValidTime,
            anyNamedWithValidTime,
            namedInWindow,
        };
    }, [rows]);

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return undefined;

        let alive = true;
        let chart: EChartsHandle | null = null;
        const onResize = () => chart?.resize();

        void import(/* webpackChunkName: "echarts" */ "echarts").then((mod) => {
            if (!alive || !hostRef.current) return;
            const ec = getEchartsFromImport(mod);
            chart = ec.init(hostRef.current);
            window.addEventListener("resize", onResize);

            type Prepared = {
                t: number;
                yKey: string;
                agentName: string;
                userId: string;
                useCount: number;
                row: UsageEventRow;
            };
            const withTime: Prepared[] = [];
            for (const row of rows) {
                if (!hasResolvedAgentName(row.agent_name)) continue;
                const raw = usageEventTimeRaw(row);
                if (!raw) continue;
                const d = parseAnalyticsInstant(raw);
                if (Number.isNaN(d.getTime())) continue;
                const cnt = Math.max(1, Number(row.use_count ?? 0) || 1);
                withTime.push({
                    t: d.getTime(),
                    yKey: usageScatterYKey(row),
                    agentName: String(row.agent_name ?? "").trim(),
                    userId: String(row.user_id || "—"),
                    useCount: cnt,
                    row,
                });
            }
            withTime.sort((a, b) => a.t - b.t);
            const nowMs = Date.now();
            const windowStartMs = nowMs - USAGE_SCATTER_WINDOW_MS;
            const inWindowAll = withTime.filter((p) => p.t >= windowStartMs);
            const prepared =
                inWindowAll.length > USAGE_SCATTER_MAX_POINTS
                    ? inWindowAll.slice(-USAGE_SCATTER_MAX_POINTS)
                    : inWindowAll;

            const yCats = prepared.map((p) => p.yKey);
            const yLabelMeta = Object.fromEntries(
                prepared.map((p) => [p.yKey, { agentName: p.agentName, userId: p.userId }])
            );
            let minCnt = Infinity;
            let maxCnt = 0;
            for (const p of prepared) {
                minCnt = Math.min(minCnt, p.useCount);
                maxCnt = Math.max(maxCnt, p.useCount);
            }
            if (!Number.isFinite(minCnt)) minCnt = 1;
            if (maxCnt <= minCnt) maxCnt = minCnt + 1;

            const { axisMuted, splitMuted, labelColor, tipTitle, tipBody, accent, accentBright, gradient } =
                ANALYTICS_CHART_COLORS;

            const seriesData = prepared.map((p) => ({
                value: [p.t, p.yKey, p.useCount] as [number, string, number],
                symbolSize: Math.min(34, Math.sqrt(p.useCount) * 4 + 5),
            }));

            /** 无底右时间轴 slider，留白略小于原先「底栏+滑块」方案 */
            const bottomPad = prepared.length > 28 ? 62 : 40;
            const dataZoom: unknown[] = [{ type: "inside", xAxisIndex: 0, filterMode: "none" }];
            if (prepared.length > 24) {
                const yRangePct = Math.min(100, (24 / Math.max(1, yCats.length)) * 100);
                dataZoom.push({
                    type: "slider",
                    yAxisIndex: 0,
                    width: 12,
                    right: 6,
                    top: 20,
                    bottom: bottomPad,
                    filterMode: "none",
                    start: Math.max(0, 100 - yRangePct),
                    end: 100,
                    borderColor: axisMuted,
                    fillerColor: "rgba(124, 58, 237, 0.18)",
                    handleStyle: { color: accentBright, borderColor: accent },
                    textStyle: { color: labelColor, fontSize: 10 },
                });
            }

            chart.setOption(
                {
                    backgroundColor: "transparent",
                    textStyle: { fontFamily: "system-ui, 'Segoe UI', sans-serif" },
                    title: { show: false },
                    tooltip: {
                        trigger: "item",
                        borderWidth: 0,
                        padding: 0,
                        extraCssText:
                            "box-shadow:0 12px 40px rgba(76,29,149,0.35);border-radius:12px;overflow:hidden;",
                        backgroundColor: "rgba(12, 8, 20, 0.96)",
                        formatter: (params: unknown) => {
                            const p = params as { dataIndex?: number };
                            const idx = p.dataIndex ?? 0;
                            const item = prepared[idx];
                            if (!item) return "";
                            const r = item.row;
                            const rawT = usageEventTimeRaw(r);
                            const when = rawT ? formatAnalyticsDateTime(rawT) : "—";
                            const aid = String(r.agent_id || "—");
                            const aname = String(r.agent_name ?? "").trim();
                            const tipBorder = accentBright;
                            return `<div style="max-width:400px;line-height:1.5;border:1px solid ${tipBorder};border-radius:12px;overflow:hidden">
<div style="padding:10px 12px;background:linear-gradient(135deg,rgba(124,58,237,0.35),rgba(168,85,247,0.15));border-bottom:1px solid rgba(168,85,247,0.25)">
<div style="font-weight:700;font-size:13px;color:${tipTitle}">${aname}</div>
<div style="font-size:11px;font-family:monospace;opacity:.85;word-break:break-all;margin-top:6px;color:${tipTitle}">${aid}</div>
</div>
<div style="padding:10px 12px;color:${tipBody}">
<div>用户：<span style="font-family:monospace;font-size:11px">${String(r.user_id || "—")}</span></div>
<div style="margin-top:6px">最近调用（北京时间）：<b style="color:${tipTitle}">${when}</b></div>
<div style="margin-top:6px">use_count：<b style="color:${accentBright}">${item.useCount}</b></div>
</div>
</div>`;
                        },
                    },
                    visualMap: {
                        show: prepared.length > 0,
                        type: "continuous",
                        dimension: 2,
                        min: minCnt,
                        max: maxCnt,
                        orient: "vertical",
                        right: prepared.length > 24 ? 22 : 12,
                        top: 36,
                        bottom: bottomPad + 4,
                        calculable: true,
                        precision: 0,
                        // text: ["多档位", "少档位"],
                        textStyle: { color: labelColor, fontSize: 10 },
                        inRange: {
                            color: [...gradient],
                        },
                    },
                    grid: {
                        left: "18%",
                        right: prepared.length > 24 ? "14%" : "12%",
                        top: 16,
                        bottom: bottomPad,
                        containLabel: false,
                    },
                    dataZoom,
                    xAxis: {
                        type: "time",
                        name: "调用时间",
                        min: windowStartMs,
                        max: nowMs,
                        nameTextStyle: { color: labelColor, fontSize: 11 },
                        axisLine: { lineStyle: { color: axisMuted } },
                        axisTick: { lineStyle: { color: axisMuted } },
                        axisLabel: {
                            color: labelColor,
                            formatter: (v: string) =>
                                new Date(v).toLocaleString("zh-CN", {
                                    hour12: false,
                                    timeZone: ANALYTICS_DISPLAY_TZ,
                                    month: "2-digit",
                                    day: "2-digit",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                }),
                        },
                        splitLine: {
                            show: true,
                            lineStyle: { type: "dashed", color: splitMuted },
                        },
                    },
                    yAxis: {
                        type: "category",
                        data: yCats,
                        axisLine: { lineStyle: { color: axisMuted } },
                        axisTick: { show: false },
                        axisLabel: {
                            width: 160,
                            interval: 0,
                            overflow: "truncate",
                            color: labelColor,
                            fontSize: 11,
                            formatter: (key: string) => {
                                const meta = yLabelMeta[key];
                                if (!meta) return key;
                                return truncateAxisText(meta.agentName, 28);
                            },
                            lineHeight: 22,
                        },
                        splitLine: { show: true, lineStyle: { type: "dashed", color: splitMuted } },
                    },
                    series: [
                        {
                            type: "scatter",
                            data: seriesData,
                            symbol: "circle",
                            itemStyle: {
                                borderColor: "rgba(233, 213, 255, 0.28)",
                                borderWidth: 1.2,
                                shadowBlur: 12,
                                shadowColor: "rgba(168, 85, 247, 0.55)",
                            },
                            emphasis: {
                                scale: 1.22,
                                focus: "self",
                                itemStyle: {
                                    shadowBlur: 22,
                                    shadowColor: "rgba(192, 132, 252, 0.75)",
                                    borderWidth: 2,
                                },
                            },
                            animationDuration: 480,
                            animationEasing: "cubicOut",
                        },
                    ],
                },
                true
            );
        });

        return () => {
            alive = false;
            window.removeEventListener("resize", onResize);
            chart?.dispose();
            chart = null;
        };
    }, [rows]);

    if (!loading && rows.length === 0) {
        return <span className="usage-analytics-muted text-sm">暂无打卡数据</span>;
    }

    if (!loading && !scatterWindowStats.anyValidTime && rows.length > 0) {
        return (
            <span className="usage-analytics-muted text-sm">
                有 {rows.length} 条打卡记录，但缺少可解析的调用时间；请检查服务端时间字段。
            </span>
        );
    }

    if (!loading && scatterWindowStats.anyValidTime && !scatterWindowStats.anyNamedWithValidTime) {
        return (
            <span className="usage-analytics-muted text-sm">
                当前样本中未能解析出智能体显示名称；已隐藏这些记录。名称解析成功后刷新即可展示。
            </span>
        );
    }

    if (!loading && scatterWindowStats.namedInWindow === 0) {
        return (
            <span className="usage-analytics-muted text-sm">
                最近一周内暂无「已解析名称」的打卡记录。
            </span>
        );
    }

    return (
        <div className="usage-analytics-panel relative h-full w-full overflow-hidden">
            <div ref={hostRef} className="relative z-[1] h-full w-full" />
        </div>
    );
};

const TopAgentsUsageBarChart: React.FC<{ loading: boolean; rows: TopAgentRow[] }> = ({
    loading,
    rows,
}) => {
    const hostRef = useRef<HTMLDivElement | null>(null);

    const rowsWithName = useMemo(
        () => rows.filter((r) => hasResolvedAgentName(r.agent_name)).slice(0, TOP_AGENTS_CHART_LIMIT),
        [rows]
    );

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return undefined;

        let alive = true;
        let chart: EChartsHandle | null = null;
        const onResize = () => chart?.resize();

        void import(/* webpackChunkName: "echarts" */ "echarts").then((mod) => {
            if (!alive || !hostRef.current) return;
            const ec = getEchartsFromImport(mod);
            chart = ec.init(hostRef.current);
            window.addEventListener("resize", onResize);

            const ordered = [...rowsWithName].reverse();
            const { axisMuted, splitMuted, labelColor, tipTitle, tipBody, accentBright } = ANALYTICS_CHART_COLORS;

            chart.setOption(
                {
                    backgroundColor: "transparent",
                    textStyle: { fontFamily: "system-ui, 'Segoe UI', sans-serif" },
                    title: { show: false },
                    tooltip: {
                        trigger: "axis",
                        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(168, 85, 247, 0.18)" } },
                        borderWidth: 0,
                        padding: 0,
                        extraCssText:
                            "box-shadow:0 12px 40px rgba(76,29,149,0.35);border-radius:12px;overflow:hidden;",
                        backgroundColor: "rgba(12, 8, 20, 0.96)",
                        formatter: (params: unknown) => {
                            const arr = Array.isArray(params) ? params : [params];
                            const first = arr[0] as { dataIndex?: number } | undefined;
                            const idx = first?.dataIndex ?? 0;
                            const row = ordered[idx];
                            if (!row) return "";
                            const title = String(row.agent_name).trim();
                            const rank = ordered.length - idx;
                            return `<div style="max-width:400px;line-height:1.5;border:1px solid ${accentBright};border-radius:12px;overflow:hidden">
<div style="padding:10px 12px;background:linear-gradient(135deg,rgba(124,58,237,0.35),rgba(168,85,247,0.15));border-bottom:1px solid rgba(168,85,247,0.25)">
<div style="font-size:10px;opacity:.85;color:${tipTitle};letter-spacing:.06em;font-weight:500">排名 <b>#${rank}</b></div>
<div style="font-weight:700;font-size:13px;color:${tipTitle};margin-top:6px">${title}</div>
<div style="font-size:11px;font-family:monospace;opacity:.85;word-break:break-all;margin-top:6px;color:${tipTitle}">${row.agent_id}</div>
</div>
<div style="padding:10px 12px;color:${tipBody}">
<div>汇总 use_count：<b style="color:${accentBright}">${row.total_use_count_records}</b></div>
</div>
</div>`;
                        },
                    },
                    grid: { left: "2%", right: "14%", bottom: 8, top: 8, containLabel: true },
                    xAxis: {
                        type: "value",
                        name: "",
                        nameTextStyle: { color: labelColor, fontSize: 10 },
                        axisLine: { lineStyle: { color: axisMuted } },
                        axisTick: { lineStyle: { color: axisMuted } },
                        axisLabel: { color: labelColor, fontVariantNumeric: "tabular-nums" },
                        splitLine: { lineStyle: { type: "dashed", color: splitMuted } },
                    },
                    yAxis: {
                        type: "category",
                        data: ordered.map((r) => String(r.agent_name).trim()),
                        axisLine: { lineStyle: { color: axisMuted } },
                        axisTick: { show: false },
                        axisLabel: { width: 200, overflow: "truncate", interval: 0, color: labelColor },
                        splitLine: { show: true, lineStyle: { type: "dashed", color: splitMuted } },
                    },
                    series: [
                        {
                            type: "bar",
                            data: ordered.map((r) => r.total_use_count_records),
                            barCategoryGap: "28%",
                            barMaxWidth: 28,
                            showBackground: true,
                            backgroundStyle: {
                                color: "rgba(124, 58, 237, 0.08)",
                                borderRadius: [0, 10, 10, 0],
                            },
                            itemStyle: {
                                borderRadius: [0, 8, 8, 0],
                                color: accentBright,
                                borderColor: "rgba(233, 213, 255, 0.2)",
                                borderWidth: 1,
                            },
                            emphasis: { focus: "self" },
                            label: {
                                show: true,
                                position: "right",
                                formatter: "{c}",
                                color: labelColor,
                                fontSize: 10,
                                fontWeight: 600,
                                fontVariantNumeric: "tabular-nums",
                            },
                            animationDuration: 400,
                            animationEasing: "cubicOut",
                        },
                    ],
                },
                true
            );
        });

        return () => {
            alive = false;
            window.removeEventListener("resize", onResize);
            chart?.dispose();
            chart = null;
        };
    }, [rowsWithName]);

    if (!loading && rows.length > 0 && rowsWithName.length === 0) {
        return (
            <span className="usage-analytics-muted text-sm">
                当前热门榜样本中暂无已解析显示名的智能体；未能解析名称的条目已隐藏，解析完成后刷新即可。
            </span>
        );
    }

    if (!loading && rows.length === 0) {
        return <span className="usage-analytics-muted text-sm">暂无热门智能体数据</span>;
    }

    return (
        <div className="usage-analytics-panel relative h-full w-full overflow-hidden">
            <div ref={hostRef} className="relative z-[1] h-full w-full" />
        </div>
    );
};

const UserSessionsBarChart: React.FC<{ loading: boolean; rows: SessionUserRow[] }> = ({ loading, rows }) => {
    const hostRef = useRef<HTMLDivElement | null>(null);

    const ordered = useMemo(
        () => [...rows].sort((a, b) => b.session_count - a.session_count).slice(0, TOP_USERS_CHART_LIMIT),
        [rows]
    );

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return undefined;

        let alive = true;
        let chart: EChartsHandle | null = null;
        const onResize = () => chart?.resize();

        void import(/* webpackChunkName: "echarts" */ "echarts").then((mod) => {
            if (!alive || !hostRef.current) return;
            const ec = getEchartsFromImport(mod);
            chart = ec.init(hostRef.current);
            window.addEventListener("resize", onResize);

            const chartRows = [...ordered].reverse();
            const { axisMuted, splitMuted, labelColor, tipTitle, tipBody, accentBright } = ANALYTICS_CHART_COLORS;

            chart.setOption(
                {
                    backgroundColor: "transparent",
                    textStyle: { fontFamily: "system-ui, 'Segoe UI', sans-serif" },
                    title: { show: false },
                    tooltip: {
                        trigger: "axis",
                        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(168, 85, 247, 0.18)" } },
                        borderWidth: 0,
                        padding: 0,
                        extraCssText:
                            "box-shadow:0 12px 40px rgba(76,29,149,0.35);border-radius:12px;overflow:hidden;",
                        backgroundColor: "rgba(12, 8, 20, 0.96)",
                        formatter: (params: unknown) => {
                            const arr = Array.isArray(params) ? params : [params];
                            const first = arr[0] as { dataIndex?: number } | undefined;
                            const idx = first?.dataIndex ?? 0;
                            const row = chartRows[idx];
                            if (!row) return "";
                            const rank = chartRows.length - idx;
                            return `<div style="max-width:400px;line-height:1.5;border:1px solid ${accentBright};border-radius:12px;overflow:hidden">
<div style="padding:10px 12px;background:linear-gradient(135deg,rgba(124,58,237,0.35),rgba(168,85,247,0.15));border-bottom:1px solid rgba(168,85,247,0.25)">
<div style="font-size:10px;opacity:.85;color:${tipTitle};letter-spacing:.06em;font-weight:500">排名 <b>#${rank}</b></div>
<div style="font-size:11px;font-family:monospace;word-break:break-all;margin-top:6px;color:${tipTitle}">${row.user_id}</div>
</div>
<div style="padding:10px 12px;color:${tipBody}">
<div>会话数：<b style="color:${accentBright}">${row.session_count}</b></div>
</div>
</div>`;
                        },
                    },
                    grid: { left: "2%", right: "14%", bottom: 8, top: 8, containLabel: true },
                    xAxis: {
                        type: "value",
                        name: "",
                        nameTextStyle: { color: labelColor, fontSize: 10 },
                        axisLine: { lineStyle: { color: axisMuted } },
                        axisTick: { lineStyle: { color: axisMuted } },
                        axisLabel: { color: labelColor, fontVariantNumeric: "tabular-nums" },
                        splitLine: { lineStyle: { type: "dashed", color: splitMuted } },
                    },
                    yAxis: {
                        type: "category",
                        data: chartRows.map((r) => r.user_id),
                        axisLine: { lineStyle: { color: axisMuted } },
                        axisTick: { show: false },
                        axisLabel: {
                            width: 220,
                            overflow: "truncate",
                            interval: 0,
                            color: labelColor,
                            fontFamily: "ui-monospace, monospace",
                            fontSize: 10,
                        },
                        splitLine: { show: true, lineStyle: { type: "dashed", color: splitMuted } },
                    },
                    series: [
                        {
                            type: "bar",
                            data: chartRows.map((r) => r.session_count),
                            barCategoryGap: "28%",
                            barMaxWidth: 24,
                            showBackground: true,
                            backgroundStyle: {
                                color: "rgba(124, 58, 237, 0.08)",
                                borderRadius: [0, 10, 10, 0],
                            },
                            itemStyle: {
                                borderRadius: [0, 8, 8, 0],
                                color: accentBright,
                                borderColor: "rgba(233, 213, 255, 0.2)",
                                borderWidth: 1,
                            },
                            emphasis: { focus: "self" },
                            label: {
                                show: true,
                                position: "right",
                                formatter: "{c}",
                                color: labelColor,
                                fontSize: 10,
                                fontWeight: 600,
                                fontVariantNumeric: "tabular-nums",
                            },
                            animationDuration: 400,
                            animationEasing: "cubicOut",
                        },
                    ],
                },
                true
            );
        });

        return () => {
            alive = false;
            window.removeEventListener("resize", onResize);
            chart?.dispose();
            chart = null;
        };
    }, [ordered]);

    if (!loading && rows.length === 0) {
        return <span className="usage-analytics-muted text-sm">暂无用户会话数据</span>;
    }

    return (
        <div className="usage-analytics-panel relative h-full w-full overflow-hidden">
            <div ref={hostRef} className="relative z-[1] h-full w-full" />
        </div>
    );
};

type RankingTabKey = "agents" | "users";

const UsageRankingCard: React.FC<{
    loading: boolean;
    agentRows: TopAgentRow[];
    sessionRows: SessionUserRow[];
}> = ({ loading, agentRows, sessionRows }) => {
    const [tab, setTab] = useState<RankingTabKey>("agents");
    const caption =
        tab === "agents"
            ? `Top ${TOP_AGENTS_CHART_LIMIT} · 累计 use_count（全用户汇总）`
            : `Top ${TOP_USERS_CHART_LIMIT} · 会话数（按 user 汇总）`;

    return (
        <ChartCard
            title="使用排行"
            caption={caption}
            height={CHART_HEIGHT.row}
            loading={loading}
            headerExtra={
                <Segmented
                    size="small"
                    value={tab}
                    onChange={(v) => setTab(v as RankingTabKey)}
                    options={[
                        { label: "智能体", value: "agents" },
                        { label: "用户", value: "users" },
                    ]}
                />
            }
        >
            {tab === "agents" ? (
                <TopAgentsUsageBarChart key="rank-agents" loading={loading} rows={agentRows} />
            ) : (
                <UserSessionsBarChart key="rank-users" loading={loading} rows={sessionRows} />
            )}
        </ChartCard>
    );
};

const TodayLivePanel: React.FC<{ loading: boolean; stats: TodayStats | null }> = ({ loading, stats }) => {
    if (!loading && !stats) {
        return <span className="usage-analytics-muted text-sm">暂无今日数据</span>;
    }

    const emptyToday =
        !loading &&
        stats &&
        stats.dau === 0 &&
        stats.usagePairs === 0 &&
        stats.newSessions === 0 &&
        stats.activeSessions === 0;

    const dauChip = loading ? "—" : (stats?.dau ?? 0);
    const checkInChip = loading ? "—" : (stats?.usagePairs ?? 0);
    const newSessionsChip = loading ? "—" : (stats?.newSessions ?? 0);

    return (
        <div className="usage-analytics-today">
            <div className="usage-analytics-today-head flex flex-wrap items-center gap-2">
                <span className="usage-analytics-chart-card-badge">DAU {dauChip}</span>
                <span className="usage-analytics-chart-card-badge">打卡 {checkInChip}</span>
                <span className="usage-analytics-chart-card-badge">新会话 {newSessionsChip}</span>
            </div>
            {emptyToday ? (
                <div className="usage-analytics-today-empty">
                    <span className="usage-analytics-muted text-sm">今日暂无活动记录，点击右上角刷新获取最新数据</span>
                </div>
            ) : (
                <div className="usage-analytics-today-feed">
                        <div className="usage-analytics-today-section-title">最近打卡</div>
                        {!loading && stats && stats.recentEvents.length === 0 ? (
                            <span className="usage-analytics-muted text-sm">今日暂无打卡</span>
                        ) : (
                            <ul className="usage-analytics-today-feed-list">
                                {(stats?.recentEvents ?? []).map((item, idx) => (
                                    <li key={`${item.time}-${item.userId}-${idx}`} className="usage-analytics-today-feed-item">
                                        <span className="usage-analytics-today-feed-time">{item.time}</span>
                                        <span className="usage-analytics-today-feed-agent">{item.agentName}</span>
                                        <span className="usage-analytics-today-feed-user">{item.userId}</span>
                                        <span className="usage-analytics-today-feed-count">×{item.useCount}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                </div>
            )}
        </div>
    );
};

const UsageAnalyticsPage: React.FC = () => {
    const { user } = useContext(appContext);
    const uid = user?.email || "";
    const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean | null>(null);
    const [overview, setOverview] = useState<AdminUsageOverviewData | null>(null);
    const [loading, setLoading] = useState(false);
    const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
    const [msgApi, holder] = message.useMessage();

    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            if (!uid) {
                setIsPlatformAdmin(false);
                return;
            }
            try {
                const access = await organizationsAPI.getAccess(uid);
                if (!cancelled) setIsPlatformAdmin(!!access?.is_platform_admin);
            } catch {
                if (!cancelled) setIsPlatformAdmin(false);
            }
        };
        void run();
        return () => {
            cancelled = true;
        };
    }, [uid]);

    const fetchOverview = useCallback(
        async (opts?: { quiet?: boolean }) => {
            if (!uid || !isPlatformAdmin) return;
            setLoading(true);
            try {
                const d = await adminAnalyticsAPI.usageOverview(uid);
                setOverview(d);
                setLastRefreshedAt(new Date());
                if (!opts?.quiet) msgApi.success("已刷新");
            } catch (e: unknown) {
                const m = e instanceof Error ? e.message : "加载失败";
                msgApi.error(m);
            } finally {
                setLoading(false);
            }
        },
        [uid, isPlatformAdmin, msgApi]
    );

    useEffect(() => {
        if (isPlatformAdmin === true && uid) {
            void fetchOverview({ quiet: true });
        }
    }, [isPlatformAdmin, uid, fetchOverview]);

    const dashboardStats = useMemo(() => computeDashboardStats(overview), [overview]);
    const todayStats = useMemo(() => computeTodayStats(overview), [overview]);

    const sampleLimitHint =
        overview?.limits?.usage_events != null
            ? `usage_events 样本上限 ${overview.limits.usage_events} 条`
            : null;

    if (isPlatformAdmin === null && uid) {
        return (
            <AnalyticsShell>
                <div className="flex flex-1 items-center justify-center p-8">
                    <Spin size="large" />
                </div>
            </AnalyticsShell>
        );
    }

    if (!uid) {
        return (
            <AnalyticsShell>
                {holder}
                <Result status="warning" title="未登录" />
            </AnalyticsShell>
        );
    }

    if (!isPlatformAdmin) {
        return (
            <AnalyticsShell>
                {holder}
                <Result
                    status="403"
                    title="无权限"
                    subTitle="仅平台管理员可查看使用分析数据。"
                />
            </AnalyticsShell>
        );
    }

    return (
        <AnalyticsShell>
            {holder}
            <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                    <Typography.Title
                        level={4}
                        className="!m-0 !bg-gradient-to-r !from-purple-200 !via-violet-300 !to-fuchsia-300 !bg-clip-text !font-bold !tracking-wide !text-transparent"
                    >
                        使用分析看板
                    </Typography.Title>
                    <p className="mt-1.5 text-xs text-purple-300/55">平台智能体使用全景 · 北京时间</p>
                    {lastRefreshedAt ? (
                        <p className="mt-1 text-[10px] text-purple-400/45">
                            数据更新于 {formatAnalyticsDateTime(lastRefreshedAt.toISOString())}
                            {sampleLimitHint ? ` · ${sampleLimitHint}` : ""}
                        </p>
                    ) : null}
                </div>
                <Button
                    type="primary"
                    loading={loading}
                    onClick={() => void fetchOverview()}
                    className="!border-none !bg-gradient-to-r !from-violet-600 !to-purple-600 !shadow-lg !shadow-purple-900/40 hover:!from-violet-500 hover:!to-purple-500"
                >
                    刷新
                </Button>
            </div>

            {!overview && loading ? (
                <div className="flex flex-1 items-center justify-center">
                    <Spin />
                </div>
            ) : (
                <div className="usage-analytics-board pb-2">
                    {dashboardStats ? (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
                            <DashboardStatCard label="活跃用户" value={dashboardStats.activeUsers} hint="有使用/会话/run 记录" />
                            <DashboardStatCard label="活跃智能体" value={dashboardStats.activeAgents} hint="被调用的智能体数" />
                            <DashboardStatCard label="总会话数" value={dashboardStats.totalSessions} />
                            <DashboardStatCard label="总 Run 数" value={dashboardStats.totalRuns} hint="runs_per_user 汇总" />
                            <DashboardStatCard label="打卡记录" value={dashboardStats.usageRecords} hint="usage_events 条数" />
                            <DashboardStatCard
                                label="累计 use_count"
                                value={dashboardStats.totalUseCount.toLocaleString("zh-CN")}
                                hint="汇总调用次数"
                            />
                        </div>
                    ) : null}

                    <div className="usage-analytics-charts-grid">
                        <div className="usage-analytics-charts-row-top">
                            <ChartCard
                                title="今日实况"
                                caption={`北京日历日 · ${todayStats?.todayKey ?? beijingTodayKey()}`}
                                badge="今日"
                                height={CHART_HEIGHT.row}
                                className="usage-analytics-chart-card--today"
                                loading={loading}
                            >
                                <TodayLivePanel loading={loading} stats={todayStats} />
                            </ChartCard>

                            <UsageRankingCard
                                loading={loading}
                                agentRows={[...(overview?.top_agents_by_usage_records || [])]}
                                sessionRows={[...(overview?.sessions_per_user || [])]}
                            />
                        </div>

                        <ChartCard
                            title="调用分布"
                            caption="散点= user×智能体 · 大小≈累计 use_count"
                            badge="近 7 日"
                            height={CHART_HEIGHT.scatter}
                            wide
                            loading={loading}
                        >
                            <RecentAgentUsageScatterChart
                                loading={loading}
                                rows={[...(overview?.usage_events || [])]}
                            />
                        </ChartCard>
                    </div>
                </div>
            )}
        </AnalyticsShell>
    );
};

export default UsageAnalyticsPage;
