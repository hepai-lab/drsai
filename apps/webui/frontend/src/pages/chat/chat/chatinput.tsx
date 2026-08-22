import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { Modal } from "antd";
import * as React from "react";
import { appContext } from "../../../hooks/provider";
import { useLang } from "../../../i18n/useLang";
import PlanView from "../plan";
import RelevantPlans from "../relevant_plans";
import "./chatinput.css";

import { useFileUpload } from "./hooks/useFileUpload";
import { useLlmSelector } from "./hooks/useLlmSelector";
import { usePlanSearch } from "./hooks/usePlanSearch";
import { useSkillAttach } from "./hooks/useSkillAttach";

import AttachDropdown from "./components/AttachDropdown";
import AttachedSkillsPreview from "./components/AttachedSkillsPreview";
import ComposerActionButtons from "./components/ComposerActionButtons";
import DragDropOverlay from "./components/DragDropOverlay";
import FilePreview from "./components/FilePreview";
import LlmSelectorBar from "./components/LlmSelectorBar";
import PlanPreview from "./components/PlanPreview";
import SkillAttachModal from "./components/SkillAttachModal";

import type { ChatInputHandle, ChatInputProps } from "./types";
import { SKILL_INSTALL_DEFAULT_LINE } from "./types";
import { resolveUploadedFiles } from "./utils/resolveUploadedFiles";

const getTextAreaDefaultHeight = () => "52px";

const ChatInput = React.forwardRef<ChatInputHandle, ChatInputProps>(
  (
    {
      onSubmit,
      error,
      disabled = false,
      onCancel,
      runStatus,
      inputRequest,
      isPlanMessage = false,
      onPause,
      enable_upload = false,
      onExecutePlan,
      sessionId,
      onTextChange,
      onClear,
      serverFilesPrefill,
      composerLabelledBy,
      composerAriaLabel,
    },
    ref
  ) => {
    const textAreaRef = React.useRef<HTMLTextAreaElement>(null);
    const attachFileInputRef = React.useRef<HTMLInputElement>(null);
    const [text, setText] = React.useState("");
    const [dragOver, setDragOver] = React.useState(false);
    const [isDragActive, setIsDragActive] = React.useState(false);
    const { t } = useLang();
    const { darkMode, user } = React.useContext(appContext) as {
      darkMode: string;
      user: { email: string };
    };
    const userId = user?.email || "default_user";

    const isInputDisabled =
      disabled ||
      runStatus === "active" ||
      runStatus === "pausing" ||
      runStatus === "paused" ||
      inputRequest?.input_type === "approval";

    const {
      fileList,
      notificationContextHolder,
      handleFileValidationAndAdd,
      handlePaste,
      removeFile,
      clearFiles,
      uploadedFilesInfo,
    } = useFileUpload({
      enable_upload,
      isInputDisabled,
      userId,
      sessionId,
      serverFilesPrefill,
    });

    const {
      skillModalOpen,
      setSkillModalOpen,
      skillModalLoading,
      skillModalRows,
      skillModalSearch,
      setSkillModalSearch,
      skillModalTagFilter,
      skillModalSelectedIds,
      setSkillModalSelectedIds,
      attachedSkills,
      filteredSkillModalRows,
      openSkillAttachModal,
      confirmSkillPicker,
      removeAttachedSkill,
      clearAttachedSkills,
      handleSkillModalTagFilter,
    } = useSkillAttach({ isInputDisabled });

    const { llmList, selectedLlmLabel, selectedLlm, handleLLMSelect } = useLlmSelector({
      userId,
      userEmail: user?.email,
      sessionId,
    });

    const {
      isSearching,
      relevantPlans,
      attachedPlan,
      isRelevantPlansVisible,
      isPlanModalVisible,
      searchPlans,
      handleUsePlan,
      clearAttachedPlan,
      handlePlanClick,
      handlePlanModalClose,
      setRelevantPlans,
      setIsRelevantPlansVisible,
    } = usePlanSearch({
      userId,
      runStatus,
      isPlanMessage,
    });

    React.useEffect(() => {
      const ta = textAreaRef.current;
      if (!ta) return;

      if (!text.trim()) {
        ta.style.height = getTextAreaDefaultHeight();
        return;
      }

      ta.style.height = getTextAreaDefaultHeight();
      const scrollHeight = ta.scrollHeight;
      ta.style.height = `${Math.min(scrollHeight, 120)}px`;
    }, [text, inputRequest]);

    React.useEffect(() => {
      if (!error) {
        resetInput();
      }
    }, [error]);

    React.useEffect(() => {
      if (!isRelevantPlansVisible) return;

      const handleClickOutside = (e: MouseEvent) => {
        const target = e.target as Node;
        const textAreaElement = textAreaRef.current;
        const planElement = document.querySelector('[data-component="relevant-plans"]');

        const isClickInsideTextArea =
          textAreaElement && textAreaElement.contains(target);
        const isClickInsidePlans = planElement && planElement.contains(target);

        if (!isClickInsideTextArea && !isClickInsidePlans) {
          setIsRelevantPlansVisible(false);
        }
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setIsRelevantPlansVisible(false);
        }
      };

      document.addEventListener("click", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);

      return () => {
        document.removeEventListener("click", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [isRelevantPlansVisible, setIsRelevantPlansVisible]);

    const resetInput = () => {
      if (textAreaRef.current) {
        textAreaRef.current.value = "";
        textAreaRef.current.style.height = getTextAreaDefaultHeight();
        setText("");
        clearFiles();
        clearAttachedSkills();
        setRelevantPlans([]);
        clearAttachedPlan();
      }

      if (onTextChange) {
        onTextChange("");
      }
    };

    const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newText = event.target.value;
      setText(newText);

      if (onTextChange) {
        onTextChange(newText);
      }

      setRelevantPlans([]);

      const shouldSearch = !(
        runStatus === "connected" || runStatus === "awaiting_input"
      );
      if (shouldSearch) {
        searchPlans(newText);
      } else if (relevantPlans.length > 0) {
        setRelevantPlans([]);
        clearAttachedPlan();
      }
    };

    const submitInternal = (
      query: string,
      files: Parameters<ChatInputProps["onSubmit"]>[1],
      accepted: boolean,
      doResetInput: boolean = true
    ) => {
      if (attachedPlan) {
        onSubmit(query, files as any, accepted, attachedPlan, selectedLlm);
      } else {
        onSubmit(query, files as any, accepted, undefined, selectedLlm);
      }

      if (doResetInput) {
        setTimeout(() => {
          resetInput();
        }, 100);
      }
      textAreaRef.current?.focus();
    };

    const handleSubmit = async () => {
      const trimmedInput = (textAreaRef.current?.value || "").trim();
      if (
        !(trimmedInput || fileList.length > 0 || attachedSkills.length > 0) ||
        isInputDisabled
      ) {
        return;
      }

      let query = textAreaRef.current?.value || "";
      const files = fileList
        .filter((file) => file.originFileObj)
        .map((file) => file.originFileObj!);

      if (!query.trim() && files.length > 0) {
        query = "请帮我分析这些文件。";
      }

      if (attachedSkills.length > 0) {
        const urlBlock = attachedSkills.map((s) => s.url).join("\n");
        const base = query.trim();
        query = base
          ? `${base}\n\n${SKILL_INSTALL_DEFAULT_LINE}\n\n${urlBlock}`
          : `${SKILL_INSTALL_DEFAULT_LINE}\n\n${urlBlock}`;
      }

      const resolved = resolveUploadedFiles({
        fileList,
        uploadedFilesInfo,
        enable_upload,
      });
      if (!resolved.ok) return;

      submitInternal(query, resolved.files as any, false, true);
    };

    const handlePause = () => {
      onPause?.();
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    };

    const applyValue = React.useCallback(
      (value: string) => {
        setText(value);
        if (textAreaRef.current) {
          textAreaRef.current.value = value;
          if (!value.trim()) {
            textAreaRef.current.style.height = getTextAreaDefaultHeight();
          } else {
            const scrollHeight = textAreaRef.current.scrollHeight;
            const newHeight = Math.min(scrollHeight, 120);
            textAreaRef.current.style.height = `${newHeight}px`;
          }
          textAreaRef.current.focus();
          textAreaRef.current.setSelectionRange(value.length, value.length);
        }
        if (onTextChange) {
          onTextChange(value);
        }
      },
      [onTextChange]
    );

    React.useImperativeHandle(ref, () => ({
      focus: () => {
        textAreaRef.current?.focus();
      },
      setValue: applyValue,
    }));

    React.useEffect(() => {
      const handler = (e: Event) => {
        const detail = (e as CustomEvent<{ text?: string; append?: boolean }>).detail;
        if (typeof detail?.text === "string") {
          if (detail.append) {
            const current = textAreaRef.current?.value ?? text;
            const separator = current.trim() ? "\n" : "";
            applyValue(current + separator + detail.text);
          } else {
            applyValue(detail.text);
          }
        }
      };
      window.addEventListener("drsai:chatinput:setValue", handler as EventListener);
      return () => {
        window.removeEventListener("drsai:chatinput:setValue", handler as EventListener);
      };
    }, [applyValue]);

    const handleAttachFileInputChange = async (
      e: React.ChangeEvent<HTMLInputElement>
    ) => {
      const list = e.target.files;
      if (list?.length) {
        for (const f of Array.from(list)) {
          await handleFileValidationAndAdd(f);
        }
      }
      e.target.value = "";
    };

    const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!isInputDisabled && enable_upload) {
        setDragOver(true);
        setIsDragActive(true);
      }
    };

    const handleDragLeave = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      setIsDragActive(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      setIsDragActive(false);

      if (isInputDisabled || !enable_upload) return;

      const droppedFiles = Array.from(e.dataTransfer.files) as File[];
      for (const file of droppedFiles) {
        await handleFileValidationAndAdd(file);
      }
    };

    const clearText = () => {
      setText("");
      if (textAreaRef.current) {
        textAreaRef.current.value = "";
        textAreaRef.current.style.height = getTextAreaDefaultHeight();
        textAreaRef.current.focus();
        textAreaRef.current.setSelectionRange(0, 0);
      }

      setRelevantPlans([]);
      clearAttachedPlan();

      if (onTextChange) {
        onTextChange("");
      }

      onClear?.();
    };

    return (
      <div className="mt-2 w-full max-w-4xl mx-auto relative">
        {notificationContextHolder}

        {isRelevantPlansVisible && (
          <RelevantPlans
            isSearching={isSearching}
            relevantPlans={relevantPlans}
            darkMode={darkMode}
            onUsePlan={handleUsePlan}
          />
        )}

        <DragDropOverlay isDragActive={isDragActive && enable_upload} darkMode={darkMode} />

        {(attachedPlan || fileList.length > 0 || attachedSkills.length > 0) && (
          <div
            className={`-mb-2 mx-1 ${
              darkMode === "dark"
                ? "bg-[#121826]/65 shadow-modern"
                : "bg-violet-50/80 border-violet-200/60"
            } rounded-t-2xl border-b-0 p-2 flex ${
              darkMode === "dark" ? "" : "border"
            } flex-wrap gap-2`}
          >
            {attachedPlan && (
              <PlanPreview
                plan={attachedPlan}
                darkMode={darkMode}
                onRemove={clearAttachedPlan}
                onClick={handlePlanClick}
              />
            )}

            <AttachedSkillsPreview
              skills={attachedSkills}
              darkMode={darkMode}
              onRemove={removeAttachedSkill}
            />

            <FilePreview fileList={fileList} darkMode={darkMode} onRemove={removeFile} />
          </div>
        )}

        <Modal
          title={`Plan: ${attachedPlan?.task || "Untitled Plan"}`}
          open={isPlanModalVisible}
          onCancel={handlePlanModalClose}
          footer={null}
          width={800}
          destroyOnClose
        >
          {attachedPlan && (
            <PlanView
              task={attachedPlan.task || ""}
              plan={attachedPlan.steps || []}
              viewOnly={true}
              setPlan={() => {}}
            />
          )}
        </Modal>

        <SkillAttachModal
          open={skillModalOpen}
          darkMode={darkMode}
          loading={skillModalLoading}
          search={skillModalSearch}
          tagFilter={skillModalTagFilter}
          rows={skillModalRows}
          filteredRows={filteredSkillModalRows}
          selectedIds={skillModalSelectedIds}
          onSearchChange={setSkillModalSearch}
          onTagFilter={handleSkillModalTagFilter}
          onSelectedIdsChange={setSkillModalSelectedIds}
          onCancel={() => setSkillModalOpen(false)}
          onConfirm={confirmSkillPicker}
        />

        <div className="chat-input-wrapper mt-4 p-1">
          <div
            className={`relative w-full transition-smooth rounded-[28px] shadow-modern ${
              isDragActive ? "ring-2 ring-accent ring-opacity-50 bg-accent/5" : ""
            } ${
              darkMode === "dark"
                ? "bg-[#0d1117] backdrop-blur-sm border border-border-primary/50 hover:border-accent/40 focus-within:border-accent/60"
                : "bg-white/95 backdrop-blur-sm border border-gray-200/80 hover:border-violet-300/60 focus-within:border-violet-400/70"
            }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex w-full flex-col">
              <div className="flex-1 relative">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSubmit();
                  }}
                  className="relative w-full"
                >
                  {enable_upload && (
                    <AttachDropdown
                      darkMode={darkMode}
                      isInputDisabled={isInputDisabled}
                      fileCount={fileList.length}
                      skillCount={attachedSkills.length}
                      attachFileInputRef={attachFileInputRef}
                      onAttachFileChange={handleAttachFileInputChange}
                      onOpenSkillModal={openSkillAttachModal}
                    />
                  )}
                  <textarea
                    id="queryInput"
                    name="queryInput"
                    aria-labelledby={composerLabelledBy}
                    aria-label={composerLabelledBy ? undefined : composerAriaLabel}
                    onPaste={(e) => handlePaste(e, textAreaRef, setText)}
                    ref={textAreaRef}
                    defaultValue={""}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    className={`input-enhanced chat-input-scrollbar-hide flex items-center w-full resize-none p-4 ${
                      enable_upload ? "pl-14" : "pl-6"
                    } ${runStatus === "active" ? "pr-36" : "pr-28"} rounded-[28px] transition-smooth border-0 bg-transparent ${
                      isInputDisabled ? "cursor-not-allowed opacity-50" : ""
                    } focus:outline-none`}
                    style={{
                      maxHeight: "120px",
                      overflowY: "auto",
                      minHeight: "52px",
                    }}
                    placeholder={
                      runStatus === "awaiting_input"
                        ? t("chatInput.placeholder.response")
                        : enable_upload
                          ? dragOver
                            ? t("chatInput.placeholder.dropFiles")
                            : t("chatInput.placeholder.message")
                          : t("chatInput.placeholder.message")
                    }
                    disabled={isInputDisabled}
                  />
                  <ComposerActionButtons
                    darkMode={darkMode}
                    text={text}
                    isInputDisabled={isInputDisabled}
                    runStatus={runStatus}
                    onClear={clearText}
                    onPause={handlePause}
                    onSubmit={handleSubmit}
                  />
                </form>
                <LlmSelectorBar
                  darkMode={darkMode}
                  isInputDisabled={isInputDisabled}
                  llmList={llmList}
                  selectedLlmLabel={selectedLlmLabel}
                  onSelect={handleLLMSelect}
                />
              </div>
            </div>
          </div>
        </div>

        {error && !error.status && (
          <div
            className={`p-2 border rounded mt-4 text-sm ${
              darkMode === "dark"
                ? "border-orange-500/30 text-orange-400 bg-orange-500/10"
                : "border-orange-300 text-orange-600 bg-orange-50"
            }`}
          >
            <ExclamationTriangleIcon
              className={`h-5 inline-block mr-2 ${
                darkMode === "dark" ? "text-orange-400" : "text-orange-600"
              }`}
            />
            {error.message}
          </div>
        )}
      </div>
    );
  }
);

export default ChatInput;
