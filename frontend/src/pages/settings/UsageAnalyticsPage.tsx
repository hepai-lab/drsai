import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button, ConfigProvider, Result, Segmented, Spin, Typography, message, theme } from "antd";
import "./UsageAnalyticsPage.css";
import { appContext } from "../../hooks/provider";
import {
    adminAnalyticsAPI,
    userAPI,
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

type UsageDailyTrendRow = NonNullable<AdminUsageOverviewData["usage_daily_trends"]>[number];

type SessionUserRow = AdminUsageOverviewData["sessions_per_user"][number];

type TodayStats = {
    todayKey: string;
    dau: number;
    usagePairs: number;
    newSessions: number;
    recentEvents: Array<{
        time: string;
        agentName: string;
        userId: string;
        useCount: number;
    }>;
};

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
    trend: 420,
} as const;

const USAGE_TREND_WINDOW_DAYS = 7;

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

function beijingTodayKey(): string {
    return beijingDayKey(Date.now());
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

/** 今日有效调用：按 Session（user + agent_mode_config）在北京日历日内创建计次。 */
function computeTodayStats(overview: AdminUsageOverviewData | null): TodayStats | null {
    if (!overview?.today_session_stats) return null;

    const sessionStats = overview.today_session_stats;
    const todayKey = sessionStats.today_key ?? beijingTodayKey();
    const recentEvents = (sessionStats.recent_by_user_agent ?? [])
        .slice(0, RECENT_TODAY_FEED_LIMIT)
        .map((row) => ({
            time: formatAnalyticsTimeOnly(row.latest_created_at),
            agentName: hasResolvedAgentName(row.agent_name) ? String(row.agent_name).trim() : "—",
            userId: String(row.user_id || "—"),
            useCount: Math.max(1, Number(row.session_count ?? 0) || 0),
        }));

    return {
        todayKey,
        dau: sessionStats.dau ?? 0,
        usagePairs: sessionStats.session_count ?? 0,
        newSessions: sessionStats.session_count ?? 0,
        recentEvents,
    };
}

function formatTrendDayLabel(dayKey: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey.trim());
    if (!m) return dayKey;
    return `${m[2]}-${m[3]}`;
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

function buildUsageDailyTrendLineOption(ordered: UsageDailyTrendRow[]) {
    const { axisMuted, splitMuted, labelColor, tipTitle, tipBody, accentBright } = ANALYTICS_CHART_COLORS;
    const dayLabels = ordered.map((r) => formatTrendDayLabel(r.day_key));
    const agentSeries = ordered.map((r) => Math.max(0, Number(r.agent_session_count ?? 0) || 0));
    const userSeries = ordered.map((r) => Math.max(0, Number(r.active_user_count ?? 0) || 0));

    return {
        backgroundColor: "transparent",
        textStyle: { fontFamily: "system-ui, 'Segoe UI', sans-serif" },
        title: { show: false },
        legend: {
            top: 4,
            right: 8,
            textStyle: { color: labelColor, fontSize: 11 },
            itemWidth: 18,
            itemHeight: 8,
            itemGap: 16,
        },
        tooltip: {
            trigger: "axis",
            axisPointer: {
                type: "line",
                lineStyle: { color: "rgba(168, 85, 247, 0.45)", width: 1 },
            },
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
                const agentVal = agentSeries[idx] ?? 0;
                const userVal = userSeries[idx] ?? 0;
                return `<div style="max-width:320px;line-height:1.5;border:1px solid ${accentBright};border-radius:12px;overflow:hidden">
<div style="padding:10px 12px;background:linear-gradient(135deg,rgba(124,58,237,0.35),rgba(168,85,247,0.15));border-bottom:1px solid rgba(168,85,247,0.25)">
<div style="font-weight:700;font-size:13px;color:${tipTitle}">${row.day_key}（北京）</div>
</div>
<div style="padding:10px 12px;color:${tipBody}">
<div>智能体调用：<b style="color:${accentBright}">${agentVal}</b></div>
<div style="margin-top:6px">用户使用（活跃人数）：<b style="color:#e879f9">${userVal}</b></div>
</div>
</div>`;
            },
        },
        grid: { left: "4%", right: "4%", bottom: 36, top: 44, containLabel: true },
        xAxis: {
            type: "category",
            data: dayLabels,
            name: "日期",
            nameTextStyle: { color: labelColor, fontSize: 11 },
            axisLine: { lineStyle: { color: axisMuted } },
            axisTick: { lineStyle: { color: axisMuted } },
            axisLabel: { color: labelColor, fontVariantNumeric: "tabular-nums" },
            splitLine: { show: true, lineStyle: { type: "dashed", color: splitMuted } },
        },
        yAxis: {
            type: "value",
            name: "数量",
            minInterval: 1,
            nameTextStyle: { color: labelColor, fontSize: 11 },
            axisLine: { lineStyle: { color: axisMuted } },
            axisTick: { lineStyle: { color: axisMuted } },
            axisLabel: { color: labelColor, fontVariantNumeric: "tabular-nums" },
            splitLine: { lineStyle: { type: "dashed", color: splitMuted } },
        },
        series: [
            {
                name: "智能体调用",
                type: "line",
                smooth: true,
                symbol: "circle",
                symbolSize: 7,
                data: agentSeries,
                lineStyle: { width: 2.5, color: accentBright },
                itemStyle: { color: accentBright, borderColor: "rgba(233, 213, 255, 0.35)", borderWidth: 1 },
                areaStyle: {
                    color: {
                        type: "linear",
                        x: 0,
                        y: 0,
                        x2: 0,
                        y2: 1,
                        colorStops: [
                            { offset: 0, color: "rgba(192, 132, 252, 0.28)" },
                            { offset: 1, color: "rgba(124, 58, 237, 0.02)" },
                        ],
                    },
                },
                emphasis: { focus: "series" },
                animationDuration: 480,
                animationEasing: "cubicOut",
            },
            {
                name: "用户使用",
                type: "line",
                smooth: true,
                symbol: "circle",
                symbolSize: 7,
                data: userSeries,
                lineStyle: { width: 2.5, color: "#e879f9" },
                itemStyle: { color: "#e879f9", borderColor: "rgba(233, 213, 255, 0.35)", borderWidth: 1 },
                areaStyle: {
                    color: {
                        type: "linear",
                        x: 0,
                        y: 0,
                        x2: 0,
                        y2: 1,
                        colorStops: [
                            { offset: 0, color: "rgba(232, 121, 249, 0.22)" },
                            { offset: 1, color: "rgba(124, 58, 237, 0.02)" },
                        ],
                    },
                },
                emphasis: { focus: "series" },
                animationDuration: 480,
                animationEasing: "cubicOut",
            },
        ],
    };
}

/** 近 7 日按北京日历日：智能体会话数 vs 活跃用户数。 */
const UsageDailyTrendLineChart: React.FC<{ loading: boolean; rows: UsageDailyTrendRow[] }> = ({
    loading,
    rows,
}) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<EChartsHandle | null>(null);

    const ordered = useMemo(
        () =>
            [...rows].sort((a, b) =>
                String(a.day_key).localeCompare(String(b.day_key), "en", { numeric: true })
            ),
        [rows]
    );

    const hasAnyActivity = useMemo(
        () =>
            ordered.some(
                (r) =>
                    (Number(r.agent_session_count ?? 0) || 0) > 0 ||
                    (Number(r.active_user_count ?? 0) || 0) > 0
            ),
        [ordered]
    );

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return undefined;

        let alive = true;
        const onResize = () => chartRef.current?.resize();

        void import(/* webpackChunkName: "echarts" */ "echarts").then((mod) => {
            if (!alive || !hostRef.current) return;
            const ec = getEchartsFromImport(mod);
            chartRef.current = ec.init(hostRef.current);
            window.addEventListener("resize", onResize);
            if (ordered.length > 0) {
                chartRef.current.setOption(buildUsageDailyTrendLineOption(ordered), true);
            }
        });

        return () => {
            alive = false;
            window.removeEventListener("resize", onResize);
            chartRef.current?.dispose();
            chartRef.current = null;
        };
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || ordered.length === 0) return;
        chart.setOption(buildUsageDailyTrendLineOption(ordered), true);
    }, [ordered]);

    useEffect(() => {
        if (!loading) chartRef.current?.resize();
    }, [loading, ordered]);

    if (!loading && ordered.length === 0) {
        return <span className="usage-analytics-muted text-sm">暂无近 {USAGE_TREND_WINDOW_DAYS} 日趋势数据</span>;
    }

    if (!loading && !hasAnyActivity) {
        return (
            <span className="usage-analytics-muted text-sm">
                近 {USAGE_TREND_WINDOW_DAYS} 日内暂无有效会话记录。
            </span>
        );
    }

    return (
        <div className="usage-analytics-panel relative h-full w-full overflow-hidden">
            <div ref={hostRef} className="relative z-[1] h-full w-full" />
        </div>
    );
};

function buildTopAgentsBarOption(ordered: TopAgentRow[]) {
    const { axisMuted, splitMuted, labelColor, tipTitle, tipBody, accentBright } = ANALYTICS_CHART_COLORS;
    return {
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
<div>会话数：<b style="color:${accentBright}">${row.total_use_count_records}</b></div>
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
    };
}

const TopAgentsUsageBarChart: React.FC<{ loading: boolean; rows: TopAgentRow[] }> = ({
    loading,
    rows,
}) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<EChartsHandle | null>(null);

    const rowsWithName = useMemo(
        () => rows.filter((r) => hasResolvedAgentName(r.agent_name)).slice(0, TOP_AGENTS_CHART_LIMIT),
        [rows]
    );

    const ordered = useMemo(() => [...rowsWithName].reverse(), [rowsWithName]);

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return undefined;

        let alive = true;
        const onResize = () => chartRef.current?.resize();

        void import(/* webpackChunkName: "echarts" */ "echarts").then((mod) => {
            if (!alive || !hostRef.current) return;
            const ec = getEchartsFromImport(mod);
            chartRef.current = ec.init(hostRef.current);
            window.addEventListener("resize", onResize);
            if (ordered.length > 0) {
                chartRef.current.setOption(buildTopAgentsBarOption(ordered), true);
            }
        });

        return () => {
            alive = false;
            window.removeEventListener("resize", onResize);
            chartRef.current?.dispose();
            chartRef.current = null;
        };
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || ordered.length === 0) return;
        chart.setOption(buildTopAgentsBarOption(ordered), true);
    }, [ordered]);

    useEffect(() => {
        if (!loading) chartRef.current?.resize();
    }, [loading, ordered]);

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

function buildUserSessionsBarOption(chartRows: SessionUserRow[]) {
    const { axisMuted, splitMuted, labelColor, tipTitle, tipBody, accentBright } = ANALYTICS_CHART_COLORS;
    return {
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
    };
}

const UserSessionsBarChart: React.FC<{ loading: boolean; rows: SessionUserRow[] }> = ({ loading, rows }) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const chartRef = useRef<EChartsHandle | null>(null);

    const ordered = useMemo(
        () => [...rows].sort((a, b) => b.session_count - a.session_count).slice(0, TOP_USERS_CHART_LIMIT),
        [rows]
    );

    const chartRows = useMemo(() => [...ordered].reverse(), [ordered]);

    useEffect(() => {
        const el = hostRef.current;
        if (!el) return undefined;

        let alive = true;
        const onResize = () => chartRef.current?.resize();

        void import(/* webpackChunkName: "echarts" */ "echarts").then((mod) => {
            if (!alive || !hostRef.current) return;
            const ec = getEchartsFromImport(mod);
            chartRef.current = ec.init(hostRef.current);
            window.addEventListener("resize", onResize);
            if (chartRows.length > 0) {
                chartRef.current.setOption(buildUserSessionsBarOption(chartRows), true);
            }
        });

        return () => {
            alive = false;
            window.removeEventListener("resize", onResize);
            chartRef.current?.dispose();
            chartRef.current = null;
        };
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || chartRows.length === 0) return;
        chart.setOption(buildUserSessionsBarOption(chartRows), true);
    }, [chartRows]);

    useEffect(() => {
        if (!loading) chartRef.current?.resize();
    }, [loading, chartRows]);

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
        stats.newSessions === 0;

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
                const access = await userAPI.getAccess(uid);
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
    const usageDailyTrendRows = useMemo(
        (): UsageDailyTrendRow[] => [...(overview?.usage_daily_trends ?? [])],
        [overview]
    );

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
                            title="调用趋势"
                            caption="按北京日历日 · 紫线=智能体会话数 · 粉线=活跃用户数"
                            badge="近 7 日"
                            height={CHART_HEIGHT.trend}
                            wide
                            loading={loading}
                        >
                            <UsageDailyTrendLineChart loading={loading} rows={usageDailyTrendRows} />
                        </ChartCard>
                    </div>
                </div>
            )}
        </AnalyticsShell>
    );
};

export default UsageAnalyticsPage;
