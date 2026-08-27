import { Button as AntdButton, Input, message, Select, Switch } from "antd";
import { FileText, FolderOpen, Image, Package, Upload } from "lucide-react";
import React from "react";
import { MAX_SKILL_FOLDER_FILES } from "./constants";
import { ICON_LABEL_KEY_MAP, SKILL_ICON_OPTIONS } from "./icons";
import { formatBytes, type PackPreviewEntry } from "./utils";

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
    <div className="rounded-2xl border border-border-primary/20 bg-primary shadow-sm dark:border-white/8 dark:bg-white/[0.01]">
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-border-primary/20 bg-primary px-6 py-3.5 dark:border-white/8">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/12 text-accent dark:bg-accent/16">
            <Upload className="h-4 w-4" aria-hidden />
          </span>
          <div className="text-sm font-semibold text-primary">
            {editingSkillId
              ? t("skillSquare.editSkill")
              : t("skillSquare.publishSkillTitle")}
          </div>
        </div>
      </div>
      <div className="space-y-4 px-6 py-5">
        <div>
          <div className="mb-1.5 text-sm font-medium text-primary">
            {t("skillSquare.skillFile")}
            {editingSkillId ? null : <span className="text-red-500"> *</span>}
            {editingSkillId ? (
              <span className="ml-1 text-xs font-normal text-secondary">
                {t("skillSquare.optionalKeepZip")}
              </span>
            ) : null}
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
              "flex min-h-[140px] flex-col gap-2 rounded-2xl border-2 px-4 py-5 transition-[border-color,background-color,box-shadow]",
              hepaiPickPreview
                ? "border-accent/35 bg-accent/[0.06] shadow-sm ring-1 ring-accent/10 dark:border-accent/30 dark:bg-accent/[0.08] dark:ring-accent/15"
                : "items-center justify-center border-dashed border-border-primary/70 bg-tertiary/20 dark:border-white/12 dark:bg-white/[0.02]",
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
            {hepaiPickPreview ? (
              <>
                <div className="flex items-center gap-3">
                  <Package className="h-8 w-8 shrink-0 text-accent/90" strokeWidth={1.75} aria-hidden />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-primary" title={hepaiPickPreview.name}>
                      {hepaiPickPreview.name}
                    </div>
                    <div className="text-xs tabular-nums text-secondary">
                      {formatBytes(hepaiPickPreview.size)}
                    </div>
                  </div>
                </div>
                {visibleRows.length > 0 ? (
                  <div>
                    <div className="mb-1.5 text-[11px] font-medium text-secondary">
                      {t("skillSquare.folderContents", packPreviewEntries.length)}
                    </div>
                    <div className="max-h-56 overflow-auto rounded-xl border border-border-primary/25 bg-primary/80 px-2 py-1.5 dark:border-white/10 dark:bg-black/20">
                    {visibleRows.map((row) => (
                      <div
                        key={`${row.isDir ? "d" : "f"}:${row.path}`}
                        className="flex items-center gap-1.5 py-0.5 text-[12px] leading-5"
                        style={{ paddingLeft: row.depth * 12 }}
                      >
                        {row.isDir ? (
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-secondary/70" aria-hidden />
                        ) : (
                          <FileText
                            className={`h-3.5 w-3.5 shrink-0 ${row.isSkillMd ? "text-accent" : "text-secondary/70"}`}
                            aria-hidden
                          />
                        )}
                        <span
                          className={[
                            "min-w-0 truncate",
                            row.isSkillMd ? "font-medium text-accent" : row.isDir ? "text-secondary" : "text-primary",
                          ].join(" ")}
                          title={row.path}
                        >
                          {row.name}
                        </span>
                        {!row.isDir && row.size > 0 ? (
                          <span className="ml-auto shrink-0 tabular-nums text-[11px] text-secondary/70">
                            {formatBytes(row.size)}
                          </span>
                        ) : null}
                      </div>
                    ))}
                    {hiddenCount > 0 ? (
                      <p className="px-1 py-1 text-[11px] text-secondary/70">
                        {t("skillSquare.folderContentsMore", hiddenCount)}
                      </p>
                    ) : null}
                  </div>
                  </div>
                ) : null}
                <p className="text-xs leading-relaxed text-secondary">
                  {t("skillSquare.replaceHint")}
                </p>
              </>
            ) : editingSkillId ? (
              <span className="max-w-md text-center text-xs leading-relaxed text-secondary">
                {t("skillSquare.keepZipHint")}
              </span>
            ) : (
              <span className="max-w-md text-center text-xs leading-relaxed text-secondary">
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

        <div className="grid grid-cols-1 gap-x-5 gap-y-4 sm:grid-cols-2">
          <div className="space-y-4">
            <div>
              <div className="mb-1.5 text-sm font-medium text-primary">
                {t("skillSquare.displayName")}{" "}
                <span className="text-red-500">*</span>
              </div>
              <Input
                placeholder={t("skillSquare.displayNamePlaceholder")}
                value={publishDisplayName}
                onChange={(e) => onDisplayNameChange(e.target.value)}
                className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
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
                className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
              />
              <p className="mt-1 text-xs text-secondary/70">
                {t("skillSquare.slugHint")}
              </p>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-medium text-primary">
                {t("skillSquare.versionLabel")}{" "}
                <span className="text-red-500">*</span>
              </div>
              <Input
                placeholder={t("skillSquare.versionPlaceholder")}
                value={publishVersion}
                onChange={(e) => onVersionChange(e.target.value)}
                className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
              />
            </div>
            {!editingSkillId && (
              <div className="flex items-center gap-3">
                <div className="text-sm font-medium text-primary">
                  {t("skillSquare.publishPublic")}
                </div>
                <Switch
                  checked={!isPublicSkill}
                  onChange={(v) => onPublicSkillChange(!v)}
                  size="small"
                />
                <div className="text-sm font-medium text-primary">
                  {t("skillSquare.publishPrivate")}
                </div>
              </div>
            )}
            <div>
              <div className="mb-1.5 text-sm font-medium text-primary">
                {t("skillSquare.changelogLabel")}
              </div>
              <Input.TextArea
                rows={2}
                placeholder={t("skillSquare.changelogPlaceholder")}
                value={publishChangelog}
                onChange={(e) => onChangelogChange(e.target.value)}
                className="rounded-xl [&_.ant-input]:rounded-xl [&_.ant-input]:border-tertiary/40 [&_.ant-input]:bg-background/55 dark:[&_.ant-input]:border-white/10 dark:[&_.ant-input]:bg-white/[0.04]"
              />
            </div>
          </div>
          <div className="space-y-4">
            {publishIcon === "__profile__" && (
              <div>
                <div className="mb-1.5 text-sm font-medium text-primary">
                  {t("skillSquare.profileLabel")}
                </div>
                <input
                  ref={publicProfileInputRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.gif,.webp,.svg"
                  className="sr-only"
                  aria-hidden
                  tabIndex={-1}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f) applyProfileFile(f);
                    else onProfileFileChange(null, null);
                    e.target.value = "";
                  }}
                />
                <div
                  className={[
                    "group relative flex aspect-square w-full max-w-[200px] cursor-pointer flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border-2 transition-all duration-200",
                    publicProfilePreview
                      ? "border-accent/30 bg-accent/[0.04] shadow-sm"
                      : "border-dashed border-border-primary/60 bg-tertiary/20 hover:border-accent/35 hover:bg-tertiary/30 dark:border-white/12 dark:bg-white/[0.02] dark:hover:border-accent/30",
                  ].join(" ")}
                  onClick={() => publicProfileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const f = e.dataTransfer.files?.[0];
                    if (!f) return;
                    const ext = f.name.split(".").pop()?.toLowerCase();
                    if (
                      ext &&
                      ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)
                    ) {
                      applyProfileFile(f);
                    } else {
                      message.warning(t("skillSquare.profileWrongType"));
                    }
                  }}
                >
                  {publicProfilePreview ? (
                    <>
                      <img
                        src={publicProfilePreview}
                        alt="Cover"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/30" />
                      <div className="relative z-10 flex flex-col items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <span className="rounded-lg bg-black/50 px-2 py-0.5 text-[11px] text-white backdrop-blur-sm">
                          {t("skillSquare.changeCover")}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <Image
                        className="h-6 w-6 text-secondary/50 transition-colors group-hover:text-accent/60"
                        strokeWidth={1.5}
                        aria-hidden
                      />
                      <span className="text-[11px] leading-tight text-secondary/60">
                        {t("skillSquare.selectCover")}
                      </span>
                    </>
                  )}
                </div>
                {publicProfilePreview && (
                  <button
                    type="button"
                    className="mt-1.5 text-xs text-accent transition-colors hover:text-accent/80"
                    onClick={() => onProfileFileChange(null, null)}
                  >
                    {t("skillSquare.removeImage")}
                  </button>
                )}
              </div>
            )}
            <div>
              <div className="mb-1.5 text-sm font-medium text-primary">
                {t("skillSquare.iconLabel")}
              </div>
              <Select
                allowClear
                placeholder={t("skillSquare.iconPlaceholder")}
                value={publishIcon || undefined}
                onChange={(v) => onIconChange(typeof v === "string" ? v : "")}
                className="w-full [&_.ant-select-selector]:rounded-xl [&_.ant-select-selector]:border-tertiary/40 [&_.ant-select-selector]:bg-background/55 dark:[&_.ant-select-selector]:border-white/10 dark:[&_.ant-select-selector]:bg-white/[0.04]"
                options={[
                  ...SKILL_ICON_OPTIONS.map((o) => ({
                    value: o.value,
                    label: (
                      <span className="flex items-center gap-2">
                        <o.Icon className="h-4 w-4 shrink-0" aria-hidden />
                        {t(ICON_LABEL_KEY_MAP[o.value])}
                      </span>
                    ),
                  })),
                  {
                    value: "__profile__",
                    label: (
                      <span className="flex items-center gap-2">
                        <Image className="h-4 w-4 shrink-0" aria-hidden />
                        {t("skillSquare.customIcon")}
                      </span>
                    ),
                  },
                ]}
              />
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
                className="w-full [&_.ant-select-selector]:rounded-xl [&_.ant-select-selector]:border-tertiary/40 [&_.ant-select-selector]:bg-background/55 dark:[&_.ant-select-selector]:border-white/10 dark:[&_.ant-select-selector]:bg-white/[0.04]"
                options={availableTags.map((c) => ({
                  value: c,
                  label: c,
                }))}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <AntdButton
            type="primary"
            loading={skillUploading}
            disabled={skillUploading}
            onClick={onSubmit}
          >
            {t("skillSquare.publishBtn")}
          </AntdButton>
          <AntdButton disabled={skillUploading} onClick={onCancel}>
            {t("skillSquare.backBtn")}
          </AntdButton>
        </div>
      </div>
    </div>
  );
};

export default SkillPublishForm;
