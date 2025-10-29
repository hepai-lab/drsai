import {
  PaperAirplaneIcon,
  ExclamationTriangleIcon,
  PauseCircleIcon,
} from "@heroicons/react/24/outline";
import * as React from "react";
import { appContext } from "../../../../hooks/provider";
import { IStatus } from "../../../types/app";
import {
  Upload,
  Button,
  Tooltip,
  Modal,
  Dropdown,
  Menu,
} from "antd";
import type { UploadProps, RcFile } from "antd/es/upload/interface";
import {
  FileTextIcon,
  PaperclipIcon,
} from "lucide-react";
import { InputRequest } from "../../../types/datamodel";
import RelevantPlans from "../relevant_plans";
import { IPlan } from "../../../types/plan";
import PlanView from "../plan";
import VoiceInput from "../../../common/VoiceInput";
import { useVoiceSettingsStore } from "../../../../store/voiceSettings";
import "./chatinput.css";

// Import custom hooks
import { useFileUpload } from "./hooks/useFileUpload";
import { usePlanSearch } from "./hooks/usePlanSearch";
import type { UploadFile as AntUploadFile } from "antd/es/upload/interface";

// Import components
import FilePreview from "./components/FilePreview";
import DragDropOverlay from "./components/DragDropOverlay";
import PlanPreview from "./components/PlanPreview";

interface ChatInputProps {
  onSubmit: (
    text: string,
    files: RcFile[],
    accepted?: boolean,
    plan?: IPlan
  ) => void;
  error: IStatus | null;
  disabled?: boolean;
  onCancel?: () => void;
  runStatus?: string;
  inputRequest?: InputRequest;
  isPlanMessage?: boolean;
  onPause?: () => void;
  enable_upload?: boolean;
  onExecutePlan?: (plan: IPlan) => void;
  sessionId: number;
}

const ChatInput = React.forwardRef<
  { focus: () => void; setValue: (value: string) => void },
  ChatInputProps
>(
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
    },
    ref
  ) => {
    const textAreaRef = React.useRef<HTMLTextAreaElement>(null);
    const textAreaDivRef = React.useRef<HTMLDivElement>(null);
    const [text, setText] = React.useState("");
    const [dragOver, setDragOver] = React.useState(false);
    const [isDragActive, setIsDragActive] = React.useState(false);
    const { darkMode, user } = React.useContext(appContext) as {
      darkMode: string;
      user: { email: string };
    };
    const { settings: voiceSettings } = useVoiceSettingsStore();
    const textAreaDefaultHeight = "52px";
    const userId = user?.email || "default_user";

    const isInputDisabled =
      disabled ||
      runStatus === "active" ||
      runStatus === "pausing" ||
      inputRequest?.input_type === "approval";

    // Use custom hooks
    const {
      fileList,
      notificationContextHolder,
      handleFileValidationAndAdd,
      handlePaste,
      removeFile,
      clearFiles,
    } = useFileUpload({
      enable_upload,
      isInputDisabled,
    });

    const {
      isSearching,
      relevantPlans,
      allPlans,
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

    // Handle textarea auto-resize
    React.useEffect(() => {
      if (textAreaRef.current) {
        textAreaRef.current.style.height = textAreaDefaultHeight;
        const scrollHeight = textAreaRef.current.scrollHeight;
        textAreaRef.current.style.height = `${scrollHeight}px`;
      }
      if (textAreaDivRef.current) {
        textAreaDivRef.current.style.height = textAreaDefaultHeight;
        const scrollHeight = textAreaDivRef.current.scrollHeight;
        textAreaDivRef.current.style.height = `${scrollHeight}px`;
      }
    }, [text, inputRequest]);

    React.useEffect(() => {
      if (!error) {
        resetInput();
      }
    }, [error]);

    React.useEffect(() => {
      if (!isInputDisabled && textAreaRef.current) {
        textAreaRef.current.focus();
      }
    }, [isInputDisabled]);

    // Handle click outside to close relevant plans
    React.useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (!isRelevantPlansVisible) return;

        const target = e.target as Node;
        const textAreaElement = textAreaRef.current;
        const planElement = document.querySelector(
          '[data-component="relevant-plans"]'
        );

        const isClickInsideTextArea =
          textAreaElement && textAreaElement.contains(target);
        const isClickInsidePlans =
          planElement && planElement.contains(target);

        if (!isClickInsideTextArea && !isClickInsidePlans) {
          setIsRelevantPlansVisible(false);
        }
      };

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && isRelevantPlansVisible) {
          setIsRelevantPlansVisible(false);
        }
      };

      document.addEventListener("click", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);

      return () => {
        document.removeEventListener("click", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [isRelevantPlansVisible]);

    const resetInput = () => {
      if (textAreaRef.current) {
        textAreaRef.current.value = "";
        textAreaRef.current.style.height = textAreaDefaultHeight;
        setText("");
        clearFiles();
        setRelevantPlans([]);
        clearAttachedPlan();
      }
      if (textAreaDivRef.current) {
        textAreaDivRef.current.style.height = textAreaDefaultHeight;
      }
    };

    const handleTextChange = (
      event: React.ChangeEvent<HTMLTextAreaElement>
    ) => {
      const newText = event.target.value;
      setText(newText);

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
      files: RcFile[],
      accepted: boolean,
      doResetInput: boolean = true
    ) => {
      if (attachedPlan) {
        onSubmit(query, files, accepted, attachedPlan);
      } else {
        onSubmit(query, files, accepted);
      }

      if (doResetInput) {
        resetInput();
      }
      textAreaRef.current?.focus();
    };

    const handleSubmit = () => {
      if (
        (textAreaRef.current?.value || fileList.length > 0) &&
        !isInputDisabled
      ) {
        let query = textAreaRef.current?.value || "";
        const files = fileList
          .filter((file) => file.originFileObj)
          .map((file) => file.originFileObj as RcFile);

        // 如果只有文件没有文字，添加默认提示
        if (!query.trim() && files.length > 0) {
          query = "请帮我分析这些文件。";
        }

        submitInternal(query, files, false);
      }
    };

    const handleVoiceTranscript = (transcript: string) => {
      setText(transcript);
      if (textAreaRef.current) {
        textAreaRef.current.value = transcript;
        const scrollHeight = textAreaRef.current.scrollHeight;
        const newHeight = Math.min(scrollHeight, 120);
        textAreaRef.current.style.height = `${newHeight}px`;
      }
    };

    const handleVoiceError = (error: string) => {
      // Error handling is done in VoiceInput component
    };

    const handlePause = () => {
      if (onPause) {
        onPause();
      }
    };

    const handleKeyDown = (
      event: React.KeyboardEvent<HTMLTextAreaElement>
    ) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    };

    // Expose focus and setValue methods via ref
    React.useImperativeHandle(ref, () => ({
      focus: () => {
        textAreaRef.current?.focus();
      },
      setValue: (value: string) => {
        setText(value);
        if (textAreaRef.current) {
          textAreaRef.current.value = value;
          const scrollHeight = textAreaRef.current.scrollHeight;
          const newHeight = Math.min(scrollHeight, 120);
          textAreaRef.current.style.height = `${newHeight}px`;
          textAreaRef.current.focus();
          textAreaRef.current.setSelectionRange(value.length, value.length);
        }
      },
    }));

    // Upload props
    const uploadProps: UploadProps = {
      name: "file",
      multiple: true,
      fileList,
      beforeUpload: async (file: RcFile) => {
        const result = await handleFileValidationAndAdd(file);
        if (result) {
          return false;
        }
        return Upload.LIST_IGNORE;
      },
      onRemove: (file: any) => {
        removeFile(file.uid);
      },
      showUploadList: false,
      customRequest: (options: any) => {
        if (options.onSuccess) {
          options.onSuccess("ok", options.file);
        }
      },
    };

    // Drag and drop handlers
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

    return (
      <div className="mt-2 w-full max-w-4xl mx-auto relative">
        {notificationContextHolder}

        {/* Relevant Plans Indicator and Dropdown */}
        {isRelevantPlansVisible && (
          <RelevantPlans
            isSearching={isSearching}
            relevantPlans={relevantPlans}
            darkMode={darkMode}
            onUsePlan={handleUsePlan}
          />
        )}

        {/* Drag Drop Overlay */}
        <DragDropOverlay isDragActive={isDragActive && enable_upload} darkMode={darkMode} />

        {/* Attached Items Preview */}
        {(attachedPlan || fileList.length > 0) && (
          <div
            className={`-mb-2 mx-1 ${darkMode === "dark" ? "bg-[#333333]" : "bg-magenta-50"
              } rounded-t border-b-0 p-2 flex border flex-wrap gap-2`}
          >
            {/* Attached Plan */}
            {attachedPlan && (
              <PlanPreview
                plan={attachedPlan}
                darkMode={darkMode}
                onRemove={clearAttachedPlan}
                onClick={handlePlanClick}
              />
            )}

            {/* Attached Files */}
            <FilePreview
              fileList={fileList}
              darkMode={darkMode}
              onRemove={removeFile}
            />
          </div>
        )}

        {/* Plan View Modal */}
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
              setPlan={() => { }}
            />
          )}
        </Modal>

        <div className="chat-input-wrapper mt-4 p-1">
          <div
            className={`relative w-full transition-smooth rounded-full ${isDragActive
              ? "ring-2 ring-accent ring-opacity-50 bg-accent/5"
              : ""
              } ${darkMode === "dark"
                ? "bg-tertiary/30 backdrop-blur-sm"
                : "bg-white/80 backdrop-blur-sm shadow-modern"
              }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex w-full">
              <div className="flex-1 relative">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSubmit();
                  }}
                  className="relative w-full"
                >
                  {enable_upload && (
                    <div
                      className={`absolute left-4 top-1/2 transform -translate-y-1/2 z-10 ${isInputDisabled ? "pointer-events-none opacity-50" : ""
                        }`}
                    >
                      <Dropdown
                        overlay={
                          <Menu>
                            <Menu.Item
                              key="attach-file"
                              icon={
                                <PaperclipIcon
                                  className={`w-4 h-4 flex-shrink-0 ${darkMode === "dark"
                                    ? "text-gray-300"
                                    : "text-magenta-600"
                                    }`}
                                />
                              }
                            >
                              <Upload {...uploadProps} showUploadList={false}>
                                <span>Attach File</span>
                              </Upload>
                            </Menu.Item>
                            <Menu.SubMenu
                              key="attach-plan"
                              title="Attach Plan"
                              icon={
                                <FileTextIcon
                                  className={`w-4 h-4 flex-shrink-0 ${darkMode === "dark"
                                    ? "text-gray-300"
                                    : "text-magenta-600"
                                    }`}
                                />
                              }
                            >
                              {allPlans.length === 0 ? (
                                <Menu.Item disabled key="no-plans">
                                  No plans available
                                </Menu.Item>
                              ) : (
                                allPlans.map((plan: any) => (
                                  <Menu.Item
                                    key={plan.id || plan.task}
                                    onClick={() => handleUsePlan(plan)}
                                  >
                                    {plan.task}
                                  </Menu.Item>
                                ))
                              )}
                            </Menu.SubMenu>
                          </Menu>
                        }
                        trigger={["click"]}
                      >
                        <Tooltip
                          title={
                            <span className="text-sm">
                              {fileList.length > 0
                                ? `${fileList.length} file(s) attached`
                                : "Attach File or Plan"}
                            </span>
                          }
                          placement="top"
                        >
                          <button
                            type="button"
                            disabled={isInputDisabled}
                            className={`flex justify-center items-center w-8 h-8 rounded-xl transition-smooth hover-lift relative ${fileList.length > 0
                              ? "text-accent bg-accent/10"
                              : darkMode === "dark"
                                ? "text-secondary hover:text-accent hover:bg-accent/10"
                                : "text-secondary hover:text-accent hover:bg-accent/10"
                              }`}
                          >
                            <PaperclipIcon className="h-4 w-4" />
                            {fileList.length > 0 && (
                              <span className="absolute -top-1 -right-1 bg-accent text-white text-xs rounded-full w-4 h-4 flex items-center justify-center animate-bounce-in">
                                {fileList.length}
                              </span>
                            )}
                          </button>
                        </Tooltip>
                      </Dropdown>
                    </div>
                  )}
                  <textarea
                    id="queryInput"
                    name="queryInput"
                    onPaste={(e) => handlePaste(e, textAreaRef, setText)}
                    ref={textAreaRef}
                    defaultValue={""}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    className={`input-enhanced flex items-center w-full resize-none p-4 ${enable_upload ? "pl-14" : "pl-6"
                      } ${runStatus === "active" ? "pr-32" : "pr-24"
                      } rounded-full transition-smooth border-2 ${darkMode === "dark"
                        ? "bg-tertiary/50 border-border-primary backdrop-blur-sm hover:bg-tertiary/70 focus:bg-tertiary/80 focus:border-accent"
                        : "bg-white/80 border-border-primary backdrop-blur-sm hover:bg-white/90 focus:bg-white focus:border-accent shadow-modern"
                      } ${isInputDisabled
                        ? "cursor-not-allowed opacity-50"
                        : "hover-lift"
                      } focus:outline-none focus:ring-2 focus:ring-accent/20`}
                    style={{
                      maxHeight: "120px",
                      overflowY: "hidden",
                      minHeight: "52px",
                    }}
                    placeholder={
                      runStatus === "awaiting_input"
                        ? "Type your response here..."
                        : enable_upload
                          ? dragOver
                            ? "Drop files here..."
                            : "Type your message here..."
                          : "Type your message here..."
                    }
                    disabled={isInputDisabled}
                  />
                  {/* Right button group */}
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                    {/* Voice input button */}
                    <VoiceInput
                      onTranscript={handleVoiceTranscript}
                      onError={handleVoiceError}
                      disabled={isInputDisabled}
                      language={voiceSettings.inputLanguage}
                      className="transition-smooth hover-lift"
                    />

                    {/* Pause button - only show when active */}
                    {runStatus === "active" && (
                      <button
                        type="button"
                        onClick={handlePause}
                        className={`rounded-full flex justify-center items-center w-10 h-10 transition-smooth hover-lift ${darkMode === "dark"
                          ? "bg-warning-primary/20 hover:bg-warning-primary/30 text-warning-primary"
                          : "bg-warning-primary/10 hover:bg-warning-primary/20 text-warning-primary"
                          } shadow-modern`}
                      >
                        <PauseCircleIcon className="h-5 w-5" />
                      </button>
                    )}

                    {/* Submit button */}
                    <button
                      type="button"
                      onClick={handleSubmit}
                      disabled={isInputDisabled}
                      className={`transition-smooth rounded-full flex justify-center items-center w-10 h-10 ${isInputDisabled
                        ? "cursor-not-allowed opacity-50 bg-gray-400"
                        : darkMode === "dark"
                          ? "bg-gradient-primary hover:shadow-modern-lg text-white hover-lift pulse-glow"
                          : "bg-gradient-primary hover:shadow-modern-lg text-white hover-lift pulse-glow"
                        }`}
                    >
                      <PaperAirplaneIcon className="h-5 w-5 transform -rotate-45" />
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>

        {error && !error.status && (
          <div
            className={`p-2 border rounded mt-4 text-sm ${darkMode === "dark"
              ? "border-orange-500/30 text-orange-400 bg-orange-500/10"
              : "border-orange-300 text-orange-600 bg-orange-50"
              }`}
          >
            <ExclamationTriangleIcon
              className={`h-5 inline-block mr-2 ${darkMode === "dark" ? "text-orange-400" : "text-orange-600"
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
