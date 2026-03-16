import {
  ExclamationTriangleIcon,
  PaperAirplaneIcon,
  PauseCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import {
  Dropdown,
  Menu,
  message,
  Modal,
  Tooltip,
  Upload
} from "antd";
import type { RcFile, UploadProps } from "antd/es/upload/interface";
import {
  BotIcon,
  FileTextIcon,
  PaperclipIcon,
  PlusIcon
} from "lucide-react";
import * as React from "react";
import { appContext } from "../../../../hooks/provider";
import { useVoiceSettingsStore } from "../../../../store/voiceSettings";
import VoiceInput from "../../../common/VoiceInput";
import { IStatus } from "../../../types/app";
import { InputRequest } from "../../../types/datamodel";
import { IPlan } from "../../../types/plan";
import PlanView from "../plan";
import RelevantPlans from "../relevant_plans";
import "./chatinput.css";

// Import custom hooks
import { useFileUpload } from "./hooks/useFileUpload";
import { usePlanSearch } from "./hooks/usePlanSearch";

// Import components
import { useAgentInfo } from "@/components/features/Agents/useAgentInfo";
import { agentWorkerAPI } from "@/components/views/api";
import DragDropOverlay from "./components/DragDropOverlay";
import FilePreview from "./components/FilePreview";
import PlanPreview from "./components/PlanPreview";

interface ChatInputProps {
  onSubmit: (
    text: string,
    files: RcFile[] | Array<{
      name: string;
      type: string;
      path: string;
      suffix: string;
      size: number;
      uuid: string;
      url?: string;
    }>,
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
  onTextChange?: (text: string) => void;
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
      onTextChange,
    },
    ref
  ) => {
    const textAreaRef = React.useRef<HTMLTextAreaElement>(null);
    const [text, setText] = React.useState("");
    const [dragOver, setDragOver] = React.useState(false);
    const [isDragActive, setIsDragActive] = React.useState(false);
    const { darkMode, user } = React.useContext(appContext) as {
      darkMode: string;
      user: { email: string };
    };
    const { settings: voiceSettings } = useVoiceSettingsStore();
    const userId = user?.email || "default_user";
    const { agentInfo, agentId } = useAgentInfo();
    const [llmList, setLlmList] = React.useState<{ label: string; value: string }[]>([]);
    const [selectedLlmLabel, setSelectedLlmLabel] = React.useState<string>("");
    React.useEffect(() => {
      if (agentInfo && agentInfo.agent_config) {
        const llmList = Object.entries(agentInfo.agent_config).map(([key, value]) => {
          return {
            label: key,
            value: value,
          };
        });
        setLlmList(llmList);
      } else
        setLlmList([]);

    }, [agentInfo]);

    React.useEffect(() => {
      const defaultConfigName = (agentInfo as any)?.defult_config_name || "";
      if (defaultConfigName && llmList.some((llm) => llm.label === defaultConfigName)) {
        setSelectedLlmLabel(defaultConfigName);
      } else {
        setSelectedLlmLabel("");
      }
    }, [agentInfo, llmList]);

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
      uploadedFilesInfo,
    } = useFileUpload({
      enable_upload,
      isInputDisabled,
      userId,
      sessionId,
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
    const getTextAreaDefaultHeight = () => {
      const baseHeight = 52; // 基础高度 52px
      return `${baseHeight}px`;
    };
    // Handle textarea auto-resize
    React.useEffect(() => {
      if (textAreaRef.current) {
        textAreaRef.current.style.height = getTextAreaDefaultHeight();
        const scrollHeight = textAreaRef.current.scrollHeight;
        textAreaRef.current.style.height = `${scrollHeight}px`;
      }

    }, [text, inputRequest]);

    React.useEffect(() => {
      if (!error) {
        resetInput();
      }
    }, [error]);

    React.useEffect(() => {
      if (!isInputDisabled && textAreaRef.current) {
        // textAreaRef.current.focus();
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
        textAreaRef.current.style.height = getTextAreaDefaultHeight();
        setText("");
        clearFiles();
        setRelevantPlans([]);
        clearAttachedPlan();
      }

      if (onTextChange) {
        onTextChange("");
      }

    };

    const handleTextChange = (
      event: React.ChangeEvent<HTMLTextAreaElement>
    ) => {
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
      files: RcFile[] | Array<{
        name: string;
        type: string;
        path: string;
        suffix: string;
        size: number;
        uuid: string;
        url?: string;
      }>,
      accepted: boolean,
      doResetInput: boolean = true
    ) => {
      if (attachedPlan) {
        onSubmit(query, files as any, accepted, attachedPlan);
      } else {
        onSubmit(query, files as any, accepted);
      }

      if (doResetInput) {
        // 延迟清空文件，确保文件信息已经传递
        setTimeout(() => {
          resetInput();
        }, 100);
      }
      textAreaRef.current?.focus();
    };

    const handleSubmit = async () => {
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

        // 注意：文件上传已经在 handleFileValidationAndAdd 中处理了
        // 这里只需要检查是否有上传失败的文件
        const hasErrorFiles = fileList.some((f) => f.status === "error");
        if (hasErrorFiles) {
          message.warning("部分文件上传失败，请检查后重试");
        }

        // 使用上传后的文件信息（如果已上传），否则使用原始文件
        // 只使用已成功上传的文件信息（status === "done"）
        const successfullyUploadedFiles = fileList.filter(
          (f) => f.status === "done" && f.originFileObj
        );

        // 优先使用 uploadedFilesInfo（这是最可靠的来源，因为它在文件上传成功后立即更新）
        let filesToUse: Array<{
          name: string;
          type: string;
          path: string;
          suffix: string;
          size: number;
          uuid: string;
          url?: string;
        }> = [];

        // 优先级1: 使用 uploadedFilesInfo（最可靠）
        if (uploadedFilesInfo.length > 0) {
          filesToUse = uploadedFilesInfo;
        } else if (successfullyUploadedFiles.length > 0) {
          // 优先级2: 如果 uploadedFilesInfo 为空，尝试从 successfullyUploadedFiles 中提取
          filesToUse = successfullyUploadedFiles
            .map((file) => {
              // 优先使用 file.response（上传时存储的结果）
              if (file.response) {
                return file.response;
              }
              return undefined;
            })
            .filter((info): info is NonNullable<typeof info> => info !== undefined);
        } else if (fileList.length > 0) {
          // 如果文件还没有上传完成，但 fileList 中有文件，检查是否有 response
          const filesWithResponse = fileList
            .filter((f) => f.response)
            .map((f) => f.response)
            .filter((info): info is NonNullable<typeof info> => info !== undefined);

          if (filesWithResponse.length > 0) {
            filesToUse = filesWithResponse;
          } else {
            // 尝试从 fileList 中获取所有文件，即使状态不是 done
            const allFiles = fileList
              .filter((f) => f.response)
              .map((f) => f.response)
              .filter((info): info is NonNullable<typeof info> => info !== undefined);
            if (allFiles.length > 0) {
              filesToUse = allFiles;
            }
          }
        }

        // 如果 filesToUse 仍然为空，但 fileList 中有文件，尝试直接使用 fileList 中的文件信息
        if (filesToUse.length === 0 && fileList.length > 0) {
          const allPossibleFiles = fileList
            .map((f) => {
              // 尝试从 response 获取
              if (f.response) {
                return f.response;
              }
              // 尝试从 uploadedFilesInfo 匹配
              const matched = uploadedFilesInfo?.find((info) => info.name === f.name);
              if (matched) {
                return matched;
              }
              return undefined;
            })
            .filter((info): info is NonNullable<typeof info> => info !== undefined);

          if (allPossibleFiles.length > 0) {
            filesToUse = allPossibleFiles;
          }
        }

        // 如果 filesToUse 为空，但 fileList 中有文件，尝试等待文件上传完成
        if (filesToUse.length === 0 && fileList.length > 0) {
          const uploadingFiles = fileList.filter((f) => f.status === "uploading");
          if (uploadingFiles.length > 0) {
            message.warning("文件正在上传中，请稍候再试");
            return;
          }
        }

        submitInternal(query, filesToUse as any, false, true);
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

      if (onTextChange) {
        onTextChange(transcript);
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

    const handleLLMSelect = async (llm: { label: string; value: string }) => {
      try {
        if (!agentId || !agentInfo) {
          message.warning("请先选择智能体");
          return;
        }

        // 只更新默认模型名：不要把整个 agent_config 列表回传给后端
        // 后端字段拼写为 defult_config_name（与后端保持一致）
        const updatedAgentConfig = {
          id: agentId,
          defult_config_name: llm.label,
        };

        // 调用后端 API 更新 agent
        await agentWorkerAPI.updateUserAgent(userId, updatedAgentConfig);
        setSelectedLlmLabel(llm.label);
        message.success(`已选择模型: ${llm.label}`);
        console.log("Selected LLM:", llm);
      } catch (error) {
        console.error("Failed to update agent LLM:", error);
        const errorMessage = error instanceof Error ? error.message : "更新模型选择失败";
        message.error(errorMessage);
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

        if (onTextChange) {
          onTextChange(value);
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
            className={`-mb-2 mx-1 ${darkMode === "dark" ? "bg-[#333333] border-gray-600" : "bg-magenta-50 border-magenta-200"
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
                ? "bg-[#0f0f0f] backdrop-blur-sm"
                : "bg-white/80 backdrop-blur-sm "
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
                          <Menu className={darkMode === "dark" ? "dark-menu" : ""}>
                            <Menu.Item key="attach-file">
                              <Upload {...uploadProps} showUploadList={false} className="upload-menu-item">
                                <div className="flex items-center gap-2">
                                  <PaperclipIcon
                                    className={`w-4 h-4 flex-shrink-0 ${darkMode === "dark"
                                      ? "text-gray-300"
                                      : "text-magenta-600"
                                      }`}
                                  />
                                  <span className={darkMode === "dark" ? "text-gray-300" : "text-magenta-600"}>Attach File</span>
                                </div>
                              </Upload>
                            </Menu.Item>
                            <Menu.SubMenu
                              key="llm-options"
                              title={<span className={darkMode === "dark" ? "text-gray-300" : "text-magenta-600"}>Agent Mode</span>}
                              icon={
                                <BotIcon
                                  className={`w-4 h-4 flex-shrink-0 ${darkMode === "dark"
                                    ? "text-gray-300"
                                    : "text-magenta-600"
                                    }`}
                                />
                              }
                            >
                              {llmList.length === 0 ? (
                                <Menu.Item
                                  disabled
                                  key="no-llm-options"
                                  className={darkMode === "dark" ? "text-gray-500" : ""}
                                >
                                  <span className={darkMode === "dark" ? "text-gray-500" : ""}>
                                    No Agent Mode
                                  </span>
                                </Menu.Item>
                              ) : (
                                llmList.map((llm) => (
                                  <Menu.Item
                                    key={llm.value}
                                    onClick={() => {
                                      handleLLMSelect(llm);
                                    }}
                                    className={darkMode === "dark" ? "text-gray-300 hover:text-white" : ""}
                                  >
                                    <span className="flex w-full items-center justify-between">
                                      <span className={darkMode === "dark" ? "text-gray-300" : ""}>
                                        {llm.label}
                                      </span>
                                      {llm.label === selectedLlmLabel && (
                                        <span className="ml-2 text-green-500 font-bold">√</span>
                                      )}
                                    </span>
                                  </Menu.Item>
                                ))
                              )}
                            </Menu.SubMenu>
                            <Menu.SubMenu
                              key="attach-plan"
                              title={<span className={darkMode === "dark" ? "text-gray-300" : "text-magenta-600"}>Attach Plan</span>}
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
                                <Menu.Item disabled key="no-plans" className={darkMode === "dark" ? "text-gray-500" : ""}>
                                  <span className={darkMode === "dark" ? "text-gray-500" : ""}>No plans available</span>
                                </Menu.Item>
                              ) : (
                                allPlans.map((plan: any) => (
                                  <Menu.Item
                                    key={plan.id || plan.task}
                                    onClick={() => handleUsePlan(plan)}
                                    className={darkMode === "dark" ? "text-gray-300 hover:text-white" : ""}
                                  >
                                    <span className={darkMode === "dark" ? "text-gray-300" : ""}>{plan.task}</span>
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
                            <PlusIcon className="h-4 w-4" />
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
                    className={`input-enhanced chat-input-scrollbar-hide flex items-center w-full resize-none p-4 ${enable_upload ? "pl-14" : "pl-6"
                      } ${runStatus === "active" ? "pr-36" : "pr-28"
                      } rounded-[28px] transition-smooth border-2 ${darkMode === "dark"
                        ? "bg-[#0f0f0f] border-border-primary backdrop-blur-sm hover:bg-[#1a1a1a] focus:bg-[#1a1a1a] focus:border-accent"
                        : "bg-white/80 border-border-primary backdrop-blur-sm hover:bg-white/90 focus:bg-white focus:border-accent shadow-modern"
                      } ${isInputDisabled
                        ? "cursor-not-allowed opacity-50"
                        : "hover-lift"
                      } focus:outline-none focus:ring-2 focus:ring-accent/20`}
                    style={{
                      maxHeight: "120px",
                      overflowY: "auto",
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
                  <div className="absolute right-2 bottom-2 flex items-center space-x-2">
                    {/* Clear text button */}
                    {text.trim().length > 0 && !isInputDisabled && (
                      <button
                        type="button"
                        onClick={clearText}
                        className="rounded-full flex justify-center items-center h-8 transition-smooth hover-lift text-secondary hover:text-accent hover:bg-accent/10"
                        aria-label="Clear input"
                      >
                        <XMarkIcon className="h-4 w-4" />
                      </button>
                    )}
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
