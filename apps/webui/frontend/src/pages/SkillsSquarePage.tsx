import { Button as AntdButton, Spin } from "antd";
import React from "react";
import ShareSkillModal from "./ShareSkillModal";
import SkillDetailPanel from "./SkillDetailPanel";
import { ENABLE_HEPAI_SKILL_ZIP_UPLOAD } from "./skills-square/constants";
import SkillFilterBar from "./skills-square/SkillFilterBar";
import SkillPublishForm from "./skills-square/SkillPublishForm";
import SkillSquareList from "./skills-square/SkillSquareList";
import SkillTagModal from "./skills-square/SkillTagModal";
import StatsCards from "./skills-square/StatsCards";
import { useSkillsSquarePage } from "./skills-square/useSkillsSquarePage";

interface SkillsSquarePageProps {
  skillsSubTab?: string;
}

const SkillsSquarePage: React.FC<SkillsSquarePageProps> = ({ skillsSubTab }) => {
  const vm = useSkillsSquarePage(skillsSubTab);

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#f5f6f8] dark:bg-primary">
      {/* Decorative background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {/* Top-right glow */}
        <div className="absolute -top-20 right-0 h-64 w-64 rounded-full bg-violet-400/[0.06] blur-3xl dark:bg-violet-500/[0.08]" />
        {/* Bottom-left glow */}
        <div className="absolute -bottom-16 -left-16 h-56 w-56 rounded-full bg-blue-400/[0.05] blur-3xl dark:bg-blue-500/[0.07]" />
        {/* Center accent */}
        <div className="absolute left-1/2 top-0 h-40 w-[min(560px,90vw)] -translate-x-1/2 rounded-full bg-accent/[0.05] blur-3xl dark:bg-accent/[0.10]" />
        {/* Subtle grid pattern overlay */}
        <div
          className="absolute inset-0 opacity-[0.03] dark:opacity-[0.04]"
          style={{
            backgroundImage: "radial-gradient(circle, currentColor 1px, transparent 1px)",
            backgroundSize: "24px 24px",
          }}
        />
      </div>

      <div ref={vm.publicScrollRef} className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto pt-3 pb-6 px-4 lg:px-6">
        <div className="flex w-full flex-col">
          {/* Stats cards */}
          {!vm.skillSlugFromUrl && !vm.skillUploadOpen && (
            <div className="shrink-0 pb-4 pr-4">
              <StatsCards items={vm.statsItems} />
            </div>
          )}

          {!vm.skillSlugFromUrl && !vm.skillUploadOpen && (
            <SkillFilterBar
              activeCategory={vm.activeCategory}
              availableCategories={vm.availableCategories}
              search={vm.search}
              searchExpanded={vm.searchExpanded}
              sortBy={vm.sortBy}
              sortOpen={vm.sortOpen}
              isZh={vm.isZh}
              t={vm.t}
              sortRef={vm.sortRef}
              isPlatformAdmin={vm.isPlatformAdmin}
              onCategoryChange={vm.setActiveCategory}
              onSearchChange={vm.setSearch}
              onSearchExpandedChange={vm.setSearchExpanded}
              onSortOpenChange={vm.setSortOpen}
              onSortByChange={vm.setSortBy}
              onManageTags={() => {
                vm.setTagModalOpen(true);
                void vm.loadTags();
              }}
            />
          )}

          {/* No breadcrumb here — moved to the top bar in Canvas */}

          <div className="flex-1 pr-4">
            {ENABLE_HEPAI_SKILL_ZIP_UPLOAD && vm.skillUploadOpen ? (
              <SkillPublishForm
                editingSkillId={vm.editingSkillId}
                skillUploading={vm.skillUploading}
                hepaiPackingFolder={vm.hepaiPackingFolder}
                hepaiPickPreview={vm.hepaiPickPreview}
                packPreviewEntries={vm.packPreviewEntries}
                publishDisplayName={vm.publishDisplayName}
                publishSlug={vm.publishSlug}
                publishVersion={vm.publishVersion}
                publishChangelog={vm.publishChangelog}
                publishCategory={vm.publishCategory}
                publishIcon={vm.publishIcon}
                isPublicSkill={vm.isPublicSkill}
                publicProfilePreview={vm.publicProfilePreview}
                availableCategories={vm.availableCategories}
                t={vm.t}
                setFolderInputRef={vm.setFolderInputRef}
                hepaiZipInputRef={vm.hepaiZipInputRef}
                publicProfileInputRef={vm.publicProfileInputRef}
                onFolderChange={vm.handleFolderInputChange}
                onZipPicked={vm.syncPickFromFile}
                onDisplayNameChange={vm.setPublishDisplayName}
                onSlugChange={vm.setPublishSlug}
                onVersionChange={vm.setPublishVersion}
                onChangelogChange={vm.setPublishChangelog}
                onCategoryChange={vm.setPublishCategory}
                onIconChange={vm.setPublishIcon}
                onPublicSkillChange={vm.setIsPublicSkill}
                onProfileFileChange={(file, preview) => {
                  vm.setPublicProfileFile(file);
                  vm.setPublicProfilePreview(preview);
                }}
                onSubmit={() => void vm.submitSkillUpload()}
                onCancel={() => {
                  vm.resetPublishForm();
                  vm.setSkillUploadOpen(false);
                }}
                onSelectFolder={() => vm.hepaiFolderInputRef.current?.click()}
              />
            ) : vm.skillSlugFromUrl ? (
              vm.detailPanelProps ? (
                <SkillDetailPanel {...vm.detailPanelProps} />
              ) : vm.skillDetailLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Spin />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4 py-20 text-center">
                  <p className="text-sm text-secondary">
                    {vm.t("skillSquare.notFound")}
                  </p>
                  <AntdButton onClick={vm.closeSkillDetail}>
                    {vm.t("skillSquare.backBtn")}
                  </AntdButton>
                </div>
              )
            ) : (
              <SkillSquareList
                activeTab={vm.activeTab}
                hepaiLoading={vm.hepaiLoading}
                hepaiRows={vm.hepaiRows}
                filteredHepaiRows={vm.filteredHepaiRows}
                publicLoading={vm.publicLoading}
                publicRows={vm.publicRows}
                publicLoadingMore={vm.publicLoadingMore}
                publicHasNext={vm.publicHasNext}
                debouncedSearch={vm.debouncedSearch}
                activeCategory={vm.activeCategory}
                currentUserEmail={vm.user?.email}
                t={vm.t}
                publicSentinelRef={vm.publicSentinelRef}
                onOpenDetail={vm.openSkillDetail}
                onPublishFirst={() =>
                  vm.openSkillPublishModal(undefined, false)
                }
              />
            )}
          </div>
        </div>
      </div>

      {vm.shareSkillSlug && (
        <ShareSkillModal
          open={vm.shareSkillSlug !== null}
          skillSlug={vm.shareSkillSlug}
          skillName={vm.shareSkillName}
          userId={vm.user?.email || ""}
          baseUrl={typeof window !== "undefined" ? window.location.origin : ""}
          t={vm.t}
          onClose={() => vm.setShareSkillSlug(null)}
          onCreateShare={vm.handleCreateShare}
          onRevokeShare={vm.handleRevokeShare}
          onListShares={vm.handleListShares}
        />
      )}

      <SkillTagModal
        open={vm.tagModalOpen}
        loading={vm.tagLoading}
        tags={vm.tagRows}
        editingTag={vm.editingTag}
        editTagName={vm.editTagName}
        editTagOrder={vm.editTagOrder}
        onClose={() => {
          vm.setTagModalOpen(false);
          vm.setEditingTag(null);
        }}
        onEditTagNameChange={vm.setEditTagName}
        onEditTagOrderChange={vm.setEditTagOrder}
        onSave={() => void vm.saveTag()}
        onStartEdit={vm.openTagEditor}
        onDelete={(id) => void vm.deleteTag(id)}
      />
    </div>
  );
};

export default SkillsSquarePage;