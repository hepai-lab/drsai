import { Button, Input, message, Modal, Select, Spin } from "antd";
import { Copy, Link, Lock, Share2, Timer, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useState } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ShareItem {
    share_id: string;
    has_password: boolean;
    expires_at: string;
    expired: boolean;
    created_at: string;
    access_count: number;
}

export interface ShareSkillModalProps {
    open: boolean;
    skillSlug: string;
    skillName: string;
    userId: string;
    /** Returns the base origin for share URLs (e.g. "https://drsai.ihep.ac.cn"). */
    baseUrl: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    t: (key: any, ...args: any[]) => string;
    onClose: () => void;
    /** Callback: create share. Returns the created share_id on success. */
    onCreateShare: (slug: string, userId: string, password: string, expiresInHours: number) => Promise<{ share_id: string }>;
    /** Callback: revoke a share. */
    onRevokeShare: (slug: string, userId: string, shareId: string) => Promise<void>;
    /** Callback: list existing shares. */
    onListShares: (slug: string, userId: string) => Promise<ShareItem[]>;
}

const EXPIRY_OPTIONS = [
    { value: 1, labelKey: "1h" },
    { value: 24, labelKey: "24h" },
    { value: 168, labelKey: "7d" },
    { value: 720, labelKey: "30d" },
    { value: -1, labelKey: "custom" },
];

const INPUT_CLS =
    "w-full rounded-xl border border-primary/40 bg-tertiary/10 py-2 px-3 text-sm text-primary outline-none placeholder:text-secondary/60 transition-[border-color,box-shadow] duration-200 focus:border-accent/50 focus:ring-1 focus:ring-accent/30 dark:border-white/10 dark:bg-white/[0.04]";

const ShareSkillModal: React.FC<ShareSkillModalProps> = ({
    open,
    skillSlug,
    skillName,
    userId,
    baseUrl,
    t,
    onClose,
    onCreateShare,
    onRevokeShare,
    onListShares,
}) => {
    const [password, setPassword] = useState("");
    const [expiryPreset, setExpiryPreset] = useState(24);
    const [customHours, setCustomHours] = useState("");
    const [creating, setCreating] = useState(false);
    const [shares, setShares] = useState<ShareItem[]>([]);
    const [loadingShares, setLoadingShares] = useState(false);
    const [revokingId, setRevokingId] = useState<string | null>(null);
    const [lastCreatedUrl, setLastCreatedUrl] = useState("");

    const expiresInHours = expiryPreset === -1 ? parseInt(customHours, 10) || 24 : expiryPreset;

    const loadShares = useCallback(async () => {
        if (!userId || !skillSlug) return;
        setLoadingShares(true);
        try {
            const items = await onListShares(skillSlug, userId);
            setShares(items);
        } catch {
            // keep previous list
        } finally {
            setLoadingShares(false);
        }
    }, [userId, skillSlug, onListShares]);

    useEffect(() => {
        if (open) {
            setPassword("");
            setExpiryPreset(24);
            setCustomHours("");
            setLastCreatedUrl("");
            void loadShares();
        }
    }, [open, loadShares]);

    const handleCreate = async () => {
        if (expiresInHours < 1 || expiresInHours > 8760) {
            message.warning(t("shareSkill.invalidExpiry"));
            return;
        }
        setCreating(true);
        try {
            const result = await onCreateShare(skillSlug, userId, password.trim(), expiresInHours);
            const url = `${baseUrl}/share/skill/${result.share_id}`;
            setLastCreatedUrl(url);
            message.success(t("shareSkill.created"));
            setPassword("");
            setExpiryPreset(24);
            setCustomHours("");
            await loadShares();
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        } finally {
            setCreating(false);
        }
    };

    const handleRevoke = async (shareId: string) => {
        setRevokingId(shareId);
        try {
            await onRevokeShare(skillSlug, userId, shareId);
            message.success(t("shareSkill.revoked"));
            await loadShares();
        } catch (e) {
            message.error(e instanceof Error ? e.message : String(e));
        } finally {
            setRevokingId(null);
        }
    };

    const copyLink = async (url: string) => {
        try {
            await navigator.clipboard.writeText(url);
            message.success(t("shareSkill.copied"));
        } catch {
            message.error(t("shareSkill.copyFailed"));
        }
    };

    const formatExpiry = (iso: string): string => {
        const d = new Date(iso);
        return d.toLocaleString();
    };

    return (
        <Modal
            title={
                <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/12 text-accent">
                        <Share2 className="h-4 w-4" aria-hidden />
                    </span>
                    <div>
                        <div className="text-sm font-semibold text-primary">
                            {t("shareSkill.title")}: {skillName}
                        </div>
                    </div>
                </div>
            }
            open={open}
            onCancel={onClose}
            footer={null}
            destroyOnClose
            width={560}
            styles={{
                content: { borderRadius: 16, overflow: "hidden", padding: 0 },
                header: {
                    marginBottom: 0,
                    padding: "16px 20px 12px",
                    borderBottom: "1px solid color-mix(in oklab, var(--color-border-secondary, #e2e8f0) 65%, transparent)",
                },
                body: { padding: "0 20px 20px", paddingTop: 14 },
            }}
            className="[&_.ant-modal-content]:bg-background [&_.ant-modal-header]:bg-background [&_.ant-modal-header]:border-b-border-secondary/60 dark:[&_.ant-modal-header]:border-white/[0.08]"
        >
            {/* ── Create new share ── */}
            <div className="rounded-xl border border-border-primary/30 bg-tertiary/5 p-4 dark:border-white/[0.06] dark:bg-white/[0.02]">
                <div className="text-sm font-medium text-primary mb-3">{t("shareSkill.createTitle")}</div>

                <div className="space-y-3">
                    {/* Password */}
                    <div>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-secondary mb-1">
                            <Lock className="h-3 w-3" aria-hidden />
                            {t("shareSkill.password")}
                            <span className="text-secondary/50 font-normal">({t("shareSkill.optional")})</span>
                        </label>
                        <Input
                            placeholder={t("shareSkill.passwordPlaceholder")}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="[&_.ant-input]:rounded-xl [&_.ant-input]:border-primary/40 [&_.ant-input]:bg-tertiary/10 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                        />
                    </div>

                    {/* Expiry */}
                    <div>
                        <label className="flex items-center gap-1.5 text-xs font-medium text-secondary mb-1">
                            <Timer className="h-3 w-3" aria-hidden />
                            {t("shareSkill.expiry")}
                        </label>
                        <div className="flex items-center gap-2">
                            <Select
                                value={expiryPreset}
                                onChange={(v) => setExpiryPreset(v)}
                                className="w-28 [&_.ant-select-selector]:rounded-xl [&_.ant-select-selector]:border-primary/40 [&_.ant-select-selector]:bg-tertiary/10 dark:[&_.ant-select-selector]:border-white/10 dark:[&_.ant-select-selector]:bg-white/[0.04]"
                                options={EXPIRY_OPTIONS.map((o) => ({
                                    value: o.value,
                                    label: o.labelKey,
                                }))}
                            />
                            {expiryPreset === -1 && (
                                <Input
                                    type="number"
                                    min={1}
                                    max={8760}
                                    placeholder={t("shareSkill.customHours")}
                                    value={customHours}
                                    onChange={(e) => setCustomHours(e.target.value)}
                                    className="flex-1 [&_.ant-input]:rounded-xl [&_.ant-input]:border-primary/40 [&_.ant-input]:bg-tertiary/10 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
                                />
                            )}
                        </div>
                    </div>

                    <Button
                        type="primary"
                        loading={creating}
                        disabled={creating}
                        onClick={handleCreate}
                        icon={<Link className="h-4 w-4" aria-hidden />}
                        className="w-full rounded-xl"
                    >
                        {t("shareSkill.createBtn")}
                    </Button>

                    {/* Created link */}
                    {lastCreatedUrl && (
                        <div className="flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.06] px-3 py-2.5 dark:border-accent/25 dark:bg-accent/[0.08]">
                            <input
                                readOnly
                                value={lastCreatedUrl}
                                className="flex-1 truncate bg-transparent text-xs text-accent outline-none"
                            />
                            <button
                                type="button"
                                onClick={() => copyLink(lastCreatedUrl)}
                                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                            >
                                <Copy className="h-3.5 w-3.5" aria-hidden />
                                {t("shareSkill.copy")}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* ── Existing shares ── */}
            {shares.length > 0 && (
                <div className="mt-4">
                    <div className="text-sm font-medium text-primary mb-2">{t("shareSkill.existingShares")}</div>
                    <div className="space-y-2">
                        {loadingShares ? (
                            <div className="flex justify-center py-6">
                                <Spin />
                            </div>
                        ) : (
                            shares.map((s) => (
                                <div
                                    key={s.share_id}
                                    className={[
                                        "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                                        s.expired
                                            ? "border-red-200/60 bg-red-50/40 dark:border-red-800/30 dark:bg-red-900/10"
                                            : "border-border-primary/30 bg-tertiary/5 dark:border-white/[0.06] dark:bg-white/[0.02]",
                                    ].join(" ")}
                                >
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-xs font-medium text-primary">
                                                {baseUrl}/share/skill/{s.share_id.slice(0, 8)}…
                                            </span>
                                            {s.has_password && (
                                                <Lock className="h-3 w-3 shrink-0 text-amber-500" aria-hidden />
                                            )}
                                            {s.expired && (
                                                <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:bg-red-900/20 dark:text-red-400">
                                                    {t("shareSkill.expired")}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-0.5 flex items-center gap-3 text-[11px] text-secondary/60">
                                            <span>{t("shareSkill.expiresAt")}: {formatExpiry(s.expires_at)}</span>
                                            <span>{t("shareSkill.accessCount")}: {s.access_count}</span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => copyLink(`${baseUrl}/share/skill/${s.share_id}`)}
                                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-accent transition-colors hover:bg-accent/8"
                                        >
                                            <Copy className="h-3.5 w-3.5" aria-hidden />
                                        </button>
                                        <button
                                            type="button"
                                            disabled={revokingId === s.share_id}
                                            onClick={() => handleRevoke(s.share_id)}
                                            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-900/15"
                                        >
                                            {revokingId === s.share_id ? (
                                                <Spin size="small" />
                                            ) : (
                                                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            )}
        </Modal>
    );
};

export default ShareSkillModal;