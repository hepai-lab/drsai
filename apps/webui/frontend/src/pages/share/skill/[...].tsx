import { Button, Input, Spin, message } from "antd";
import { Download, Lock, Package, ShieldAlert, Timer } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";
import { getServerUrl } from "../../../components/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface SharedSkillMeta {
    share_id: string;
    has_password: boolean;
    expires_at: string;
    skill: {
        slug: string;
        name: string;
        description: string;
        icon: string;
        version: string;
        owner: string;
        profile: string;
        changelog: string;
    };
}

const PAGE_CLS = "min-h-screen flex flex-col bg-primary";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchMeta(shareId: string): Promise<SharedSkillMeta> {
    const base = getServerUrl();
    const resp = await fetch(`${base}/skills/share/${encodeURIComponent(shareId)}`);
    const data = await resp.json();
    if (!resp.ok) {
        throw new Error(data.detail || data.message || "Failed to load");
    }
    if (!data.status) throw new Error(data.message || "Failed to load");
    return data.data;
}

async function verifyPassword(shareId: string, password: string): Promise<string> {
    const base = getServerUrl();
    const form = new FormData();
    form.append("password", password);
    const resp = await fetch(`${base}/skills/share/${encodeURIComponent(shareId)}/verify`, {
        method: "POST",
        body: form,
    });
    const data = await resp.json();
    if (!resp.ok) {
        throw new Error(data.detail || data.message || "Verification failed");
    }
    if (!data.status) throw new Error(data.message || "Verification failed");
    return data.data.token;
}

async function downloadSkill(shareId: string, token: string, slug: string): Promise<void> {
    const base = getServerUrl();
    const resp = await fetch(
        `${base}/skills/share/${encodeURIComponent(shareId)}/download?token=${encodeURIComponent(token)}`
    );
    if (!resp.ok) {
        let msg = "Download failed";
        try {
            const err = await resp.json();
            msg = err.detail || err.message || msg;
        } catch {
            msg = resp.statusText || msg;
        }
        throw new Error(msg);
    }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug}.zip`;
    a.click();
    URL.revokeObjectURL(url);
}

// ── Component ────────────────────────────────────────────────────────────────

const SharedSkillPage: React.FC = () => {
    const [shareId, setShareId] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [meta, setMeta] = useState<SharedSkillMeta | null>(null);
    const [password, setPassword] = useState("");
    const [verifying, setVerifying] = useState(false);
    const [downloadToken, setDownloadToken] = useState<string | null>(null);
    const [downloading, setDownloading] = useState(false);

    // Extract share_id from URL path: /share/skill/<share_id>
    useEffect(() => {
        if (typeof window === "undefined") return;
        const path = window.location.pathname;
        const parts = path.split("/").filter(Boolean);
        // parts = ["share", "skill", "<share_id>"]
        const id = parts.length >= 3 ? parts[2] : "";
        setShareId(id);
    }, []);

    // Load meta
    useEffect(() => {
        if (!shareId) {
            setError("No share ID found");
            setLoading(false);
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                setLoading(true);
                setError(null);
                const data = await fetchMeta(shareId);
                if (!cancelled) {
                    setMeta(data);
                    if (!data.has_password) {
                        // No password — verify immediately to get token
                        const token = await verifyPassword(shareId, "");
                        if (!cancelled) setDownloadToken(token);
                    }
                }
            } catch (e) {
                if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [shareId]);

    const handleVerify = useCallback(async () => {
        if (!shareId) return;
        setVerifying(true);
        try {
            const token = await verifyPassword(shareId, password);
            setDownloadToken(token);
            message.success("Password verified");
        } catch (e) {
            message.error(e instanceof Error ? e.message : "Verification failed");
        } finally {
            setVerifying(false);
        }
    }, [shareId, password]);

    const handleDownload = useCallback(async () => {
        if (!shareId || !downloadToken || !meta) return;
        setDownloading(true);
        try {
            await downloadSkill(shareId, downloadToken, meta.skill.slug);
            message.success("Download started");
        } catch (e) {
            message.error(e instanceof Error ? e.message : "Download failed");
        } finally {
            setDownloading(false);
        }
    }, [shareId, downloadToken, meta]);

    // ── Loading ──
    if (loading) {
        return (
            <div className={`${PAGE_CLS} items-center justify-center`}>
                <div className="flex flex-col items-center gap-3">
                    <Spin size="large" />
                    <p className="text-sm text-secondary">Loading shared skill…</p>
                </div>
            </div>
        );
    }

    // ── Error ──
    if (error) {
        const isExpired = error.includes("expired") || error.includes("410");
        return (
            <div className={`${PAGE_CLS} items-center justify-center px-4`}>
                <div className="flex flex-col items-center gap-4 text-center max-w-sm">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border-primary/50 bg-tertiary/10">
                        {isExpired ? (
                            <Timer className="h-8 w-8 text-amber-500" strokeWidth={1.5} />
                        ) : (
                            <ShieldAlert className="h-8 w-8 text-red-500" strokeWidth={1.5} />
                        )}
                    </div>
                    <h1 className="text-lg font-semibold text-primary">
                        {isExpired ? "Share link expired" : "Cannot load shared skill"}
                    </h1>
                    <p className="text-sm text-secondary">{error}</p>
                </div>
            </div>
        );
    }

    if (!meta) return null;

    const skill = meta.skill;

    // ── Password gate ──
    if (meta.has_password && !downloadToken) {
        return (
            <div className={`${PAGE_CLS} items-center justify-center px-4`}>
                <div className="flex w-full max-w-sm flex-col items-center gap-5">
                    <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-border-primary/50 bg-tertiary/10">
                        <Lock className="h-8 w-8 text-accent" strokeWidth={1.5} />
                    </div>
                    <div className="text-center">
                        <h1 className="text-lg font-semibold text-primary">{skill.name}</h1>
                        <p className="mt-1 text-sm text-secondary">This skill is password-protected</p>
                    </div>
                    <div className="w-full space-y-3">
                        <Input
                            type="password"
                            placeholder="Enter password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            onPressEnter={handleVerify}
                            className="[&_.ant-input]:rounded-xl [&_.ant-input]:border-primary/40 [&_.ant-input]:bg-tertiary/10 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                        />
                        <Button
                            block
                            loading={verifying}
                            disabled={verifying || !password.trim()}
                            onClick={handleVerify}
                            className="rounded-xl border-2 !border-accent !text-accent !font-semibold hover:!bg-accent/10"
                        >
                            Unlock
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Skill detail + download ──
    return (
        <div className={`${PAGE_CLS}`}>
            {/* Header */}
            <header className="shrink-0 border-b border-border-primary/20 px-6 py-4 dark:border-white/[0.06]">
                <div className="mx-auto flex max-w-2xl items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/12 text-accent">
                        <Package className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-base font-semibold text-primary">{skill.name}</h1>
                        <p className="text-xs text-secondary/60">
                            Shared by {skill.owner || "unknown"} · v{skill.version || "0.0.0"}
                        </p>
                    </div>
                    <Button
                        size="large"
                        icon={<Download className="h-4 w-4" />}
                        loading={downloading}
                        disabled={downloading}
                        onClick={handleDownload}
                        className="rounded-xl border-2 !border-accent !text-accent !font-semibold hover:!bg-accent/10"
                    >
                        Download
                    </Button>
                </div>
            </header>

            {/* Body */}
            <main className="flex-1 overflow-auto px-6 py-6">
                <div className="mx-auto max-w-2xl space-y-5">
                    {/* Info card */}
                    <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 p-5 dark:border-white/[0.06] dark:bg-white/[0.02]">
                        <div className="flex items-start gap-4">
                            {skill.profile ? (
                                <img
                                    src={skill.profile}
                                    alt={skill.name}
                                    className="h-14 w-14 rounded-xl object-cover shrink-0 shadow-sm"
                                />
                            ) : null}
                            <div className="min-w-0 flex-1">
                                <h2 className="break-words text-lg font-semibold text-primary">{skill.name}</h2>
                                {skill.description && (
                                    <p className="mt-2 break-words text-sm leading-relaxed text-secondary">{skill.description}</p>
                                )}
                            </div>
                        </div>

                        {/* Meta */}
                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                            <div className="flex items-center justify-between rounded-lg bg-tertiary/10 px-3 py-2 dark:bg-white/[0.04]">
                                <span className="text-secondary/60">Version</span>
                                <span className="font-agent-mono font-medium text-secondary">v{skill.version}</span>
                            </div>
                            <div className="flex items-center justify-between rounded-lg bg-tertiary/10 px-3 py-2 dark:bg-white/[0.04]">
                                <span className="text-secondary/60">Owner</span>
                                <span className="font-medium text-secondary">{skill.owner}</span>
                            </div>
                        </div>
                    </div>

                    {/* Changelog */}
                    {skill.changelog && (
                        <div className="rounded-xl border border-amber-200/60 bg-amber-50/60 px-4 py-3 text-xs text-amber-800 dark:border-amber-800/40 dark:bg-amber-900/15 dark:text-amber-200">
                            <span className="font-medium">Changelog</span>
                            <p className="mt-1 break-words leading-relaxed">{skill.changelog}</p>
                        </div>
                    )}

                    {/* Expiry */}
                    <p className="text-center text-xs text-secondary/50">
                        Share link expires at {new Date(meta.expires_at).toLocaleString()}
                    </p>
                </div>
            </main>
        </div>
    );
};

export default SharedSkillPage;