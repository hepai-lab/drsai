import { Spin } from "antd";
import { Package, Upload } from "lucide-react";
import React from "react";
import { Button } from "../../components/common/Button";
import type {
  SkillsPublicItem,
  SkillsUserItem,
} from "../../components/views/api";
import SkillListItem from "../SkillListItem";
import { ENABLE_HEPAI_SKILL_ZIP_UPLOAD, SKILL_GRID_CLS } from "./constants";
import { renderSkillIcon } from "./icons";
import type { PrivateFilter, SkillSquareTab } from "./SkillSquareNav";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TFn = (key: any, ...args: any[]) => string;

interface SkillSquareListProps {
  activeTab: SkillSquareTab;
  privateFilter: PrivateFilter;
  onPrivateFilterChange: (filter: PrivateFilter) => void;
  hepaiLoading: boolean;
  hepaiRows: SkillsUserItem[];
  filteredHepaiRows: SkillsUserItem[];
  publicLoading: boolean;
  publicRows: SkillsPublicItem[];
  publicLoadingMore: boolean;
  publicHasNext: boolean;
  debouncedSearch: string;
  activeCategory: string;
  currentUserEmail?: string;
  t: TFn;
  publicSentinelRef: React.RefObject<HTMLDivElement | null>;
  onOpenDetail: (slug: string) => void;
  onPublishFirst: () => void;
}

const SkillSquareList: React.FC<SkillSquareListProps> = ({
  activeTab,
  privateFilter,
  onPrivateFilterChange,
  hepaiLoading,
  hepaiRows,
  filteredHepaiRows,
  publicLoading,
  publicRows,
  publicLoadingMore,
  publicHasNext,
  debouncedSearch,
  activeCategory,
  currentUserEmail,
  t,
  publicSentinelRef,
  onOpenDetail,
  onPublishFirst,
}) => {
  if (activeTab === "private") {
    // Private filter tab bar — underline tabs
    const privateTabBar = (
      <div className="flex items-center gap-0 mb-5 border-b border-gray-200 dark:border-white/10">
        <button
          type="button"
          onClick={() => onPrivateFilterChange("created")}
          className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors whitespace-nowrap select-none ${
            privateFilter === "created"
              ? "text-purple-600 dark:text-purple-400 border-purple-500 dark:border-purple-400"
              : "text-secondary hover:text-primary border-transparent"
          }`}
        >
          {t("skillSquare.myCreations")}
        </button>
        <button
          type="button"
          onClick={() => onPrivateFilterChange("collected")}
          className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors whitespace-nowrap select-none ${
            privateFilter === "collected"
              ? "text-purple-600 dark:text-purple-400 border-purple-500 dark:border-purple-400"
              : "text-secondary hover:text-primary border-transparent"
          }`}
        >
          {t("skillSquare.myCollections")}
        </button>
      </div>
    );

    if (hepaiLoading) {
      return (
        <div className="flex items-center justify-center py-20">
          <Spin />
        </div>
      );
    }
    if (hepaiRows.length === 0) {
      return (
        <>
          {privateTabBar}
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary/70 bg-tertiary/15 px-6 py-20 text-center dark:border-white/12 dark:bg-white/[0.02]">
          <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border-primary/50 bg-primary shadow-sm dark:border-white/10">
            <Package
              className="h-8 w-8 text-accent"
              strokeWidth={1.75}
              aria-hidden
            />
          </div>
          <p className="text-base font-medium text-primary">
            {t("skillSquare.emptyTitle")}
          </p>
          <p className="mt-2 max-w-xs text-sm leading-relaxed text-secondary">
            {t("skillSquare.emptyDesc")}
          </p>
          {ENABLE_HEPAI_SKILL_ZIP_UPLOAD ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Upload className="h-4 w-4" aria-hidden />}
              className="mt-6"
              onClick={onPublishFirst}
            >
              {t("skillSquare.publishFirst")}
            </Button>
          ) : null}
        </div>
        </>
      );
    }
    if (filteredHepaiRows.length === 0) {
      return (
        <>
          {privateTabBar}
          <div className="flex items-center justify-center rounded-2xl border border-dashed border-border-primary/40 bg-tertiary/10 px-6 py-12 text-center dark:border-white/10 dark:bg-white/[0.02]">
            <p className="text-sm text-secondary">{t("skillSquare.empty")}</p>
          </div>
        </>
      );
    }
    return (
      <>
        {privateTabBar}
        <div className={SKILL_GRID_CLS}>
        {filteredHepaiRows.map((r) => {
          const isUnlisted = r.unlisted === true;
          return (
            <SkillListItem
              key={r.slug}
              slug={r.slug}
              name={r.name || r.slug}
              icon={r.icon}
              version={r.version}
              description={r.description}
              profile={r.profile}
              owner={r.owner?.trim() || currentUserEmail?.trim() || ""}
              tags={r.tags}
              downloads={r.downloads}
              collects={r.collects}
              source={r.source}
              badges={
                isUnlisted ? (
                  <span className="inline-flex items-center rounded-md bg-tertiary/80 px-1.5 py-0.5 text-[10px] font-medium text-secondary dark:bg-white/[0.08]">
                    {t("skillSquare.unlistedBadge")}
                  </span>
                ) : null
              }
              onClick={onOpenDetail}
              renderSkillIcon={renderSkillIcon}
            />
          );
        })}
      </div>
      </>
    );
  }

  if (publicLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spin />
      </div>
    );
  }
  if (publicRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border-primary/70 bg-tertiary/15 px-6 py-20 text-center dark:border-white/12 dark:bg-white/[0.02]">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-border-primary/50 bg-primary shadow-sm dark:border-white/10">
          <Package
            className="h-8 w-8 text-accent"
            strokeWidth={1.75}
            aria-hidden
          />
        </div>
        <p className="text-base font-medium text-primary">
          {debouncedSearch || activeCategory
            ? t("skillSquare.noMatchTitle")
            : t("skillSquare.noPublicTitle")}
        </p>
        <p className="mt-2 max-w-xs text-sm leading-relaxed text-secondary">
          {debouncedSearch || activeCategory
            ? t("skillSquare.noMatchDesc")
            : t("skillSquare.noPublicDesc")}
        </p>
      </div>
    );
  }
  return (
    <>
      <div className={SKILL_GRID_CLS}>
        {publicRows.map((r) => (
          <SkillListItem
            key={r.slug}
            slug={r.slug}
            name={r.name}
            icon={r.icon}
            version={r.version}
            description={r.description}
            profile={r.profile}
            owner={r.owner}
            tags={r.tags}
            downloads={r.downloads}
            collects={r.collects}
            source={r.source}
            badges={
              r.academicGroupId === "lhaaso" ? (
                <span className="inline-flex items-center rounded-md bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  {t("skillSquare.higrafOnlyBadge")}
                </span>
              ) : null
            }
            onClick={onOpenDetail}
            renderSkillIcon={renderSkillIcon}
          />
        ))}
      </div>
      <div ref={publicSentinelRef} className="h-8" aria-hidden />
      <div className="flex items-center justify-center py-4">
        {publicLoadingMore ? (
          <div className="flex items-center gap-2 text-xs text-secondary">
            <Spin size="small" />
            <span>{t("skillSquare.loadingMore")}</span>
          </div>
        ) : publicHasNext ? null : (
          <p className="text-xs text-secondary/60">
            {t("skillSquare.allLoaded")}
          </p>
        )}
      </div>
    </>
  );
};

export default SkillSquareList;
