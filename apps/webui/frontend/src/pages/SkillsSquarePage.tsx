import { Button as AntdButton, Spin } from "antd";
import React from "react";
import ShareSkillModal from "./ShareSkillModal";
import SkillDetailPanel from "./SkillDetailPanel";
import { ENABLE_HEPAI_SKILL_ZIP_UPLOAD } from "./skills-square/constants";
import SkillFilterBar from "./skills-square/SkillFilterBar";
import SkillPublishForm from "./skills-square/SkillPublishForm";
import SkillSquareList from "./skills-square/SkillSquareList";
import SkillSquareNav from "./skills-square/SkillSquareNav";
import SkillTagModal from "./skills-square/SkillTagModal";
import { useSkillsSquarePage } from "./skills-square/useSkillsSquarePage";

const SkillsSquarePage: React.FC = () => {
  const vm = useSkillsSquarePage();

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-primary">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-48 overflow-hidden"
        aria-hidden
      >
        <div className="absolute left-1/2 top-0 h-40 w-[min(560px,90vw)] -translate-x-1/2 rounded-full bg-accent/[0.07] blur-3xl dark:bg-accent/[0.11]" />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col py-6 px-4 lg:px-6">
        <div className="flex min-h-0 w-full flex-1 flex-row gap-4">
          {!vm.skillSlugFromUrl && (
            <SkillSquareNav
              activeTab={vm.activeTab}
              privateFilter={vm.privateFilter}
              skillUploadOpen={vm.skillUploadOpen}
              t={vm.t}
              onAllSkills={() => {
                vm.switchTab("public");
              }}
              onMyCreations={() => {
                vm.switchTab("private");
                vm.setPrivateFilter("created");
              }}
              onMyCollections={() => {
                vm.switchTab("private");
                vm.setPrivateFilter("collected");
              }}
              onPublish={() => {
                if (vm.activeTab === "public")
                  vm.openSkillPublishModal(undefined, true);
                else vm.openSkillPublishModal(undefined, false);
              }}
            />
          )}

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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

            {vm.skillSlugFromUrl && vm.skillDetail && !vm.skillUploadOpen && (
              <div className="shrink-0 px-6 pt-2">
                <div className="flex items-center gap-1.5 text-sm text-secondary">
                  <button
                    type="button"
                    onClick={vm.closeSkillDetail}
                    className="flex items-center gap-1 transition-colors hover:text-primary"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M15 19l-7-7 7-7"
                      />
                    </svg>
                    {vm.t("skillSquare.title")}
                  </button>
                  <span className="text-secondary/50">/</span>
                  <span className="font-semibold text-primary truncate">
                    {vm.skillDetail.name}
                  </span>
                </div>
              </div>
            )}

            <div
              ref={vm.publicScrollRef}
              className="min-w-0 flex-1 overflow-auto pr-4"
            >
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
