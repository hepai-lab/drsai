import { Button as AntdButton, Input, message, Select, Switch } from "antd";
import { FileText, FolderOpen, Image, Package, Upload, X } from "lucide-react";
import React from "react";
import publishIllustration from "../../assets/publish-illustration.png";
import uploadIllustration from "../../assets/upload-illustration.png";
import { MAX_SKILL_FOLDER_FILES } from "./constants";
import { ICON_LABEL_KEY_MAP, SKILL_ICON_OPTIONS } from "./icons";
import { formatBytes, resolveSkillAssetUrl, type PackPreviewEntry } from "./utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFn = (key: any, ...args: any[]) => string;

export interface SkillPublishFormProps {
  editingSkillId: string | null;
  skillUploading: boolean;
  hepaiPackingFolder: boolean;
  hepaiPickPreview: { name: string; size: number } | null;
  packPreviewEntries?: PackPreviewEntry[];
  publishDisplayName: string;
  publishSlug: string;
  publishVersion: string;
  publishChangelog: string;
  publishTags: string[];
  publishIcon: string;
  isPublicSkill: boolean;
  publicProfilePreview: string | null;
  availableTags: string[];
  t: TFn;
  setFolderInputRef: (el: HTMLInputElement | null) => void;
  hepaiZipInputRef: React.RefObject<HTMLInputElement | null>;
  publicProfileInputRef: React.RefObject<HTMLInputElement | null>;
  onFolderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onZipPicked: (file: File | null) => void;
  onDisplayNameChange: (value: string) => void;
  onSlugChange: (value: string) => void;
  onVersionChange: (value: string) => void;
  onChangelogChange: (value: string) => void;
  onTagsChange: (value: string[]) => void;
  onIconChange: (value: string) => void;
  onPublicSkillChange: (isPublic: boolean) => void;
  onProfileFileChange: (file: File | null, preview: string | null) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onSelectFolder: () => void;
}

const INPUT_CLS =
  "rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]";
const SELECT_CLS =
  "w-full [&_.ant-select-selector]:rounded-xl [&_.ant-select-selector]:border-tertiary/40 [&_.ant-select-selector]:bg-background/55 dark:[&_.ant-select-selector]:border-white/10 dark:[&_.ant-select-selector]:bg-white/[0.04]";

type PackTreeRow = {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  size: number;
  isSkillMd: boolean;
};

const SkillPublishForm: React.FC<SkillPublishFormProps> = ({
  editingSkillId,
  skillUploading,
  hepaiPackingFolder,
  hepaiPickPreview,
  packPreviewEntries = [],
  publishDisplayName,
  publishSlug,
  publishVersion,
  publishChangelog,
  publishTags,
  publishIcon,
  isPublicSkill,
  publicProfilePreview,
  availableTags,
  t,
  setFolderInputRef,
  hepaiZipInputRef,
  publicProfileInputRef,
  onFolderChange,
  onZipPicked,
  onDisplayNameChange,
  onSlugChange,
  onVersionChange,
  onChangelogChange,
  onTagsChange,
  onIconChange,
  onPublicSkillChange,
  onProfileFileChange,
  onSubmit,
  onCancel,
  onSelectFolder,
}) => {
  const profilePreviewSrc = resolveSkillAssetUrl(publicProfilePreview);

  const applyProfileFile = (f: File) => {
    if (f.size > 2 * 1024 * 1024) {
      message.warning(t("skillSquare.profileTooLarge"));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => onProfileFileChange(f, reader.result as string);
    reader.readAsDataURL(f);
  };

  const PREVIEW_LIMIT = 80;
  const treeRows = React.useMemo(() => {
    if (!packPreviewEntries.length) return [];
    const dirs = new Set<string>();
    for (const e of packPreviewEntries) {
      const parts = e.path.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        dirs.add(parts.slice(0, i).join("/"));
      }
    }
    const rows: PackTreeRow[] = [
      ...[...dirs].map((path) => {
        const parts = path.split("/");
        return { path, name: parts[parts.length - 1] || path, depth: parts.length - 1, isDir: true, size: 0, isSkillMd: false };
      }),
      ...packPreviewEntries.map((e) => {
        const parts = e.path.split("/").filter(Boolean);
        const name = parts[parts.length - 1] || e.path;
        return {
          path: e.path,
          name,
          depth: Math.max(0, parts.length - 1),
          isDir: false,
          size: e.size,
          isSkillMd: /SKILL\.md$/i.test(name),
        };
      }),
    ];
    rows.sort((a, b) => a.path.localeCompare(b.path));
    return rows;
  }, [packPreviewEntries]);
  const visibleRows = treeRows.slice(0, PREVIEW_LIMIT);
  const hiddenCount = treeRows.length - visibleRows.length;

  return (
    <div
      className="animate-fade-in flex h-full flex-col overflow-hidden rounded-2xl border border-border-primary/20 bg-primary shadow-sm dark:border-white/8 dark:bg-white/[0.01]"
    >
      <div className="sticky top-0 z-10 flex items-center rounded-t-2xl border-b border-border-primary/20 bg-primary px-6 py-3.5 dark:border-white/8">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/12 text-accent dark:bg-accent/16">
          <Upload className="h-4 w-4" aria-hidden />
        </span>
        <div className="ml-3 text-sm font-semibold text-primary">
          {editingSkillId
            ? t("skillSquare.editSkill")
            : t("skillSquare.publishSkillTitle")}
        </div>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-8 px-6 py-5 lg:grid-cols-[380px_1fr]">
        {/* Left column: upload */}
        <div className="flex min-h-0 flex-col">
          <div className="mb-1.5 flex items-center justify-between">
            <div className="text-sm font-medium text-primary">
              {t("skillSquare.skillFile")}
              {editingSkillId ? null : <span className="text-red-500"> *</span>}
              {editingSkillId ? (
                <span className="ml-1 text-xs font-normal text-secondary">
                  {t("skillSquare.optionalKeepZip")}
                </span>
              ) : null}
            </div>
          </div>
          <input
            ref={setFolderInputRef}
            type="file"
            multiple
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={onFolderChange}
          />
          <input
            ref={hepaiZipInputRef}
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => {
              onZipPicked(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          <div
            className={[
              "group relative flex min-h-[120px] flex-1 flex-col gap-2 rounded-2xl border-2 px-4 py-5 transition-all duration-300 bg-purple-50/30 dark:bg-purple-950/20",
              hepaiPickPreview
                ? "border-purple-300 bg-purple-50/30 shadow-sm dark:border-purple-500/40 dark:bg-purple-950/20"
                : "border-purple-200 items-center justify-center dark:border-purple-500/40 hover:border-purple-300 dark:hover:border-purple-400/60",
            ].join(" ")}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f?.name?.toLowerCase().endsWith(".zip")) {
                onZipPicked(f);
              } else {
                message.warning(t("skillSquare.dropZipHint"));
              }
            }}
          >
            {!hepaiPickPreview && (
              <div
                className="pointer-events-none absolute inset-0 rounded-2xl"
                style={{
                  backgroundImage: `url(${uploadIllustration})`,
                  backgroundSize: "40%",
                  backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  opacity: 0.6,
                }}
                aria-hidden
              />
            )}
            {hepaiPickPreview ? (
              <>
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent shadow-sm ring-1 ring-accent/15 dark:bg-accent/16 dark:ring-accent/20">
                    <Package className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-primary" title={hepaiPickPreview.name}>
                      {hepaiPickPreview.name}
                    </div>
                    <div className="text-xs tabular-nums text-secondary">
                      {formatBytes(hepaiPickPreview.size)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-secondary/50 transition-colors hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                    onClick={() => onZipPicked(null)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                {visibleRows.length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-secondary">
                      {t("skillSquare.folderContents", packPreviewEntries.length)}
                    </div>
                    <div className="max-h-56 overflow-auto rounded-xl border border-border-primary/15 bg-primary/60 px-1.5 py-1.5 dark:border-white/8 dark:bg-black/15">
                      {visibleRows.map((row, idx) => (
                        <div
                          key={`${row.isDir ? "d" : "f"}:${row.path}`}
                          className={[
                            "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] leading-5 transition-colors",
                            idx % 2 === 0 ? "bg-transparent" : "bg-black/[0.02] dark:bg-white/[0.02]",
                            "hover:bg-accent/[0.06] dark:hover:bg-accent/[0.08]",
                          ].join(" ")}
                          style={{ paddingLeft: row.depth * 12 + 6 }}
                        >
                          {row.isDir ? (
                            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500/70" aria-hidden />
                          ) : (
                            <FileText
                              className={`h-3.5 w-3.5 shrink-0 ${row.isSkillMd ? "text-accent" : "text-secondary/60"}`}
                              aria-hidden
                            />
                          )}
                          <span
                            className={[
                              "min-w-0 truncate",
                              row.isSkillMd ? "font-semibold text-accent" : row.isDir ? "font-medium text-secondary" : "text-primary",
                            ].join(" ")}
                            title={row.path}
                          >
                            {row.name}
                          </span>
                          {!row.isDir && row.size > 0 ? (
                            <span className="ml-auto shrink-0 tabular-nums text-[11px] text-secondary/50">
                              {formatBytes(row.size)}
                            </span>
                          ) : null}
                        </div>
                      ))}
                      {hiddenCount > 0 ? (
                        <p className="px-1.5 py-1 text-[11px] text-secondary/60">
                          {t("skillSquare.folderContentsMore", hiddenCount)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <p className="text-xs leading-relaxed text-secondary/70">
                  {t("skillSquare.replaceHint")}
                </p>
              </>
            ) : editingSkillId ? (
              <span className="max-w-md text-center text-xs leading-relaxed text-secondary -mt-3">
                {t("skillSquare.keepZipHint")}
              </span>
            ) : (
              <span className="max-w-md text-center text-xs leading-relaxed text-secondary -mt-3">
                {t("skillSquare.dropHintLong", MAX_SKILL_FOLDER_FILES)}
              </span>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <AntdButton
                type="default"
                loading={hepaiPackingFolder}
                disabled={skillUploading}
                icon={<FolderOpen className="h-4 w-4" aria-hidden />}
                className="rounded-xl"
                onClick={onSelectFolder}
              >
                {t("skillSquare.selectFolder")}
              </AntdButton>
              <AntdButton
                type="default"
                disabled={hepaiPackingFolder || skillUploading}
                icon={<Package className="h-4 w-4" aria-hidden />}
                className="rounded-xl"
                onClick={() => hepaiZipInputRef.current?.click()}
              >
                {editingSkillId
                  ? t("skillSquare.replaceZip")
                  : t("skillSquare.selectZip")}
              </AntdButton>
            </div>
          </div>
        </div>

        {/* Right column: form fields + buttons */}
        <div className="relative flex min-h-0 flex-col gap-5 overflow-y-auto">
          <img
            src={publishIllustration}
            alt=""
            className="pointer-events-none absolute bottom-0 right-0 w-40 opacity-25 dark:opacity-15"
            aria-hidden
          />
          <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
            <div className="space-y-4">
              <div>
                <div className="mb-1.5 text-sm font-medium text-primary">
                  {t("skillSquare.displayName")} <span className="text-red-500">*</span>
                </div>
                <Input
                  placeholder={t("skillSquare.displayNamePlaceholder")}
                  value={publishDisplayName}
                  onChange={(e) => onDisplayNameChange(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <div className="mb-1.5 text-sm font-medium text-primary">
                  {t("skillSquare.slugLabel")}
                </div>
                <Input
                  placeholder={t("skillSquare.slugPlaceholder")}
                  value={publishSlug}
                  onChange={(e) => onSlugChange(e.target.value)}
                  className={INPUT_CLS}
                />
                <p className="mt-1 text-xs text-secondary/70">
                  {t("skillSquare.slugHint")}
                </p>
              </div>
              <div>
                <div className="mb-1.5 text-sm font-medium text-primary">
                  {t("skillSquare.versionLabel")} <span className="text-red-500">*</span>
                </div>
                <Input
                  placeholder={t("skillSquare.versionPlaceholder")}
                  value={publishVersion}
                  onChange={(e) => onVersionChange(e.target.value)}
                  className={INPUT_CLS}
                />
              </div>
            </div>
            <div className="space-y-4">
              {!editingSkillId && (
                <div>
                  <div className="mb-1.5 text-sm font-medium text-primary">
                    {t("skillSquare.visibilityLabel")}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className={`text-sm font-medium transition-colors ${isPublicSkill ? "text-accent" : "text-secondary"}`}>
                      {t("skillSquare.publishPublic")}
                    </span>
                    <Switch
                      checked={isPublicSkill}
                      onChange={(v) => onPublicSkillChange(v)}
                      size="small"
                    />
                  </div>
                </div>
              )}
              <div>
                <div className="mb-1.5 text-sm font-medium text-primary">
                  {t("skillSquare.iconLabel")}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {SKILL_ICON_OPTIONS.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={[
                        "flex h-8 w-8 items-center justify-center rounded-lg border transition-all duration-200",
                        publishIcon === o.value
                          ? "border-accent/50 bg-accent/15 text-accent shadow-sm ring-1 ring-accent/20 dark:border-accent/40 dark:bg-accent/20 dark:ring-accent/25"
                          : "border-transparent bg-background/40 text-secondary/50 hover:border-border-primary/30 hover:bg-background/70 hover:text-accent/70 dark:hover:border-white/10 dark:hover:bg-white/[0.06]",
                      ].join(" ")}
                      onClick={() => onIconChange(o.value)}
                      title={t(ICON_LABEL_KEY_MAP[o.value])}
                    >
                      <o.Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
                    </button>
                  ))}
                  <button
                    type="button"
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-lg border border-dashed transition-all duration-200",
                      publishIcon === "__profile__"
                        ? "border-accent/50 bg-accent/15 text-accent shadow-sm ring-1 ring-accent/20 dark:border-accent/40 dark:bg-accent/20 dark:ring-accent/25"
                        : "border-border-primary/30 bg-background/50 text-secondary/40 hover:border-accent/30 hover:text-accent/60 dark:border-white/10 dark:bg-white/[0.04] dark:hover:border-accent/20",
                    ].join(" ")}
                    onClick={() => publicProfileInputRef.current?.click()}
                    title={t("skillSquare.customIcon")}
                  >
                    <Image className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden />
                  </button>
                  {profilePreviewSrc && (
                    <button
                      type="button"
                      className={[
                        "flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border-2 transition-all duration-200",
                        publishIcon === "__profile__"
                          ? "border-accent/50 shadow-sm ring-1 ring-accent/20 dark:border-accent/40 dark:ring-accent/25"
                          : "border-solid border-border-primary/30 hover:border-accent/30 dark:border-white/10 dark:hover:border-accent/20",
                      ].join(" ")}
                      onClick={() => onIconChange("__profile__")}
                      title={t("skillSquare.customIcon")}
                    >
                      <img src={profilePreviewSrc} alt="" className="h-full w-full object-cover" />
                    </button>
                  )}
                  <input
                    ref={publicProfileInputRef}
                    type="file"
                    accept=".png,.jpg,.jpeg,.gif,.webp,.svg"
                    className="sr-only"
                    aria-hidden
                    tabIndex={-1}
                    onChange={(e) => {
                      const f = e.target.files?.[0] ?? null;
                      if (f) {
                        applyProfileFile(f);
                        onIconChange("__profile__");
                        message.success(t("skillSquare.imageUploaded"));
                      }
                      e.target.value = "";
                    }}
                  />
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-sm font-medium text-primary">
                  {t("skillSquare.tagsLabel") || "标签"}
                </div>
                <Select
                  mode="multiple"
                  allowClear
                  maxTagCount="responsive"
                  placeholder={t("skillSquare.tagsPlaceholder") || "选择标签"}
                  value={publishTags.length > 0 ? publishTags : undefined}
                  onChange={(v) => onTagsChange(Array.isArray(v) ? v : [])}
                  className={SELECT_CLS}
                  options={availableTags.map((c) => ({ value: c, label: c }))}
                />
              </div>
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-sm font-medium text-primary">
              {t("skillSquare.changelogLabel")}
            </div>
            <Input.TextArea
              rows={2}
              placeholder={t("skillSquare.changelogPlaceholder")}
              value={publishChangelog}
              onChange={(e) => onChangelogChange(e.target.value)}
              className={INPUT_CLS}
            />
          </div>
          <div className="flex items-center gap-3">
            <AntdButton type="primary" loading={skillUploading} disabled={skillUploading} onClick={onSubmit}>
              {t("skillSquare.publishBtn")}
            </AntdButton>
            <AntdButton disabled={skillUploading} onClick={onCancel}>
              {t("skillSquare.backBtn")}
            </AntdButton>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SkillPublishForm;