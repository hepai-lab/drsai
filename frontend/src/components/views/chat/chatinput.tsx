import {
  PaperAirplaneIcon,
  ExclamationTriangleIcon,
  PauseCircleIcon,
} from "@heroicons/react/24/outline";
import * as React from "react";
import { appContext } from "../../../hooks/provider";
import { IStatus } from "../../types/app";
import {
  Upload,
  message,
  Button,
  Tooltip,
  notification,
  Modal,
  Dropdown,
  Menu,
  Progress,
} from "antd";
import type { UploadFile, UploadProps, RcFile } from "antd/es/upload/interface";
import {
  FileTextIcon,
  ImageIcon,
  XIcon,
  UploadIcon,
  PaperclipIcon,
} from "lucide-react";
import { InputRequest } from "../../types/datamodel";
import { debounce } from "lodash";
import { planAPI, fileAPI } from "../api";
import RelevantPlans from "./relevant_plans";
import { IPlan } from "../../types/plan";
import PlanView from "./plan";
import { useConfigStore } from "../../../hooks/store";
import VoiceInput from "../../common/VoiceInput";
import VoiceSettings from "../../common/VoiceSettings";
import { useVoiceSettingsStore } from "../../../store/voiceSettings";

// Maximum file size in bytes (5MB)
const MAX_FILE_SIZE = 5 * 1024 * 1024;
// Allowed file types
const ALLOWED_FILE_TYPES = [
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/svg+xml",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

// Threshold for large text files (in characters)
const LARGE_TEXT_THRESHOLD = 1500;

interface ChatInputProps {
  onSubmit: (
    text: string,
    files: RcFile[],
    accepted?: boolean,
    plan?: IPlan,
    uploadedFileData?: Record<string, any>
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
    const [fileList, setFileList] = React.useState<UploadFile[]>([]);
    const [dragOver, setDragOver] = React.useState(false);
    const [isDragActive, setIsDragActive] = React.useState(false);
    const { darkMode, user } = React.useContext(appContext) as {
      darkMode: string;
      user: { email: string };
    };
    const [notificationApi, notificationContextHolder] =
      notification.useNotification();
    const [isSearching, setIsSearching] = React.useState(false);
    const [relevantPlans, setRelevantPlans] = React.useState<any[]>([]);
    const [allPlans, setAllPlans] = React.useState<any[]>([]);
    const [attachedPlan, setAttachedPlan] = React.useState<IPlan | null>(
      null
    );
    const [isLoading, setIsLoading] = React.useState(false);
    const [isUploading, setIsUploading] = React.useState(false);
    // 新增：存储上传文件时后端返回的数据
    const [uploadedFileData, setUploadedFileData] = React.useState<
      Record<string, any>
    >({});
    const userId = user?.email || "default_user";
    const [isRelevantPlansVisible, setIsRelevantPlansVisible] =
      React.useState(false);
    const [isPlanModalVisible, setIsPlanModalVisible] =
      React.useState(false);
    const { settings: voiceSettings } = useVoiceSettingsStore();
    const textAreaDefaultHeight = "52px";
    const isInputDisabled =
      disabled ||
      runStatus === "active" ||
      runStatus === "pausing" ||
      inputRequest?.input_type === "approval";

    // 从store获取session信息
    const { session: storeSession } = useConfigStore();

    // 获取有效的sessionId
    const getValidSessionId = (): number | null => {
      // 1. 首先检查传入的sessionId
      if (sessionId && typeof sessionId === "number" && sessionId > 0) {
        return sessionId;
      }

      // 2. 如果传入的sessionId无效，从store获取
      if (
        storeSession?.id &&
        typeof storeSession.id === "number" &&
        storeSession.id > 0
      ) {
        console.log("Using sessionId from store:", storeSession.id);
        return storeSession.id;
      }

      // 3. 如果store中也没有，尝试从localStorage获取
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("current_session_id");
        if (stored) {
          const parsedId = parseInt(stored, 10);
          if (!isNaN(parsedId) && parsedId > 0) {
            console.log(
              "Using sessionId from localStorage:",
              parsedId
            );
            return parsedId;
          }
        }
      }

      console.warn("No valid sessionId found");
      return null;
    };

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

    React.useEffect(() => {
      const fetchAllPlans = async () => {
        try {
          setIsLoading(true);

          const response = await planAPI.listPlans(userId);

          if (response) {
            if (Array.isArray(response)) {
              setAllPlans(response);
            } else {
              console.warn(
                "Unexpected response format:",
                response
              );
            }
          } else {
            console.warn("Empty response received");
          }
        } catch (error) {
          console.error("Error fetching plans:", error);
        } finally {
          setIsLoading(false);
        }
      };

      fetchAllPlans();
    }, [userId]);

    // Add paste event listener for images and large text
    const handlePaste = async (
      e: React.ClipboardEvent<HTMLTextAreaElement>
    ) => {
      console.log("Paste event triggered");
      if (isInputDisabled || !enable_upload) return;

      // 检查是否有有效的sessionId
      const validSessionId = getValidSessionId();
      if (!validSessionId) {
        console.warn("No valid sessionId for paste upload");
        notificationApi.error({
          message: <span className="text-sm">No Session</span>,
          description: (
            <span className="text-sm text-secondary">
              Cannot upload files without an active session.
              Please select a session first.
            </span>
          ),
          duration: 5,
        });
        return;
      }

      console.log("Using sessionId for paste upload:", validSessionId);

      // Handle multiple files paste
      if (e.clipboardData?.items) {
        const filesToUpload: File[] = [];
        const uploadFiles: UploadFile[] = [];
        let hasImageItem = false;
        let hasLargeText = false;
        let largeTextContent = "";

        // First pass: collect all files and check for large text
        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];

          // Handle image items
          if (item.type.indexOf("image/") === 0) {
            hasImageItem = true;
            const file = item.getAsFile();

            if (file && file.size <= MAX_FILE_SIZE) {
              // Create a unique file name
              const fileName = `pasted-image-${new Date().getTime()}-${i}.png`;

              // Create a new File with a proper name
              const namedFile = new File([file], fileName, {
                type: file.type,
              });

              filesToUpload.push(namedFile);

              // Convert to the expected UploadFile format
              const uploadFile: UploadFile = {
                uid: `paste-${Date.now()}-${i}`,
                name: fileName,
                status: "uploading",
                size: namedFile.size,
                type: namedFile.type,
                originFileObj: namedFile as RcFile,
              };

              uploadFiles.push(uploadFile);
            } else if (file && file.size > MAX_FILE_SIZE) {
              message.error(
                `Pasted image ${file.name || "image"
                } is too large. Maximum size is 5MB.`
              );
            }
          }

          // Handle text items - only if there's a large amount of text
          if (item.type === "text/plain" && !hasImageItem) {
            item.getAsString((text) => {
              // Only process for large text
              if (text.length > LARGE_TEXT_THRESHOLD) {
                hasLargeText = true;
                largeTextContent = text;
              }
            });
          }
        }

        // If we have files to upload, prevent default paste and process them
        if (filesToUpload.length > 0 || hasLargeText) {
          e.preventDefault();

          // Add all files to file list with uploading status
          setFileList((prev) => [...prev, ...uploadFiles]);

          // Handle large text conversion
          if (hasLargeText) {
            // We need to manually clear the textarea's selection value
            setTimeout(() => {
              if (textAreaRef.current) {
                const currentValue = textAreaRef.current.value;
                const selectionStart =
                  textAreaRef.current.selectionStart || 0;
                const selectionEnd =
                  textAreaRef.current.selectionEnd || 0;

                // Remove the pasted text from the textarea
                const newValue =
                  currentValue.substring(
                    0,
                    selectionStart - largeTextContent.length
                  ) + currentValue.substring(selectionEnd);

                // Update the textarea
                textAreaRef.current.value = newValue;
                // Trigger the onChange event manually
                setText(newValue);
              }
            }, 0);

            // Create a text file from the pasted content
            const blob = new Blob([largeTextContent], {
              type: "text/plain",
            });
            const textFile = new File(
              [blob],
              `pasted-text-${new Date().getTime()}.txt`,
              { type: "text/plain" }
            );

            filesToUpload.push(textFile);

            // Add text file to upload list
            const textUploadFile: UploadFile = {
              uid: `paste-text-${Date.now()}`,
              name: textFile.name,
              status: "uploading",
              size: textFile.size,
              type: textFile.type,
              originFileObj: textFile as RcFile,
            };

            uploadFiles.push(textUploadFile);
            setFileList((prev) => [...prev, textUploadFile]);
          }

          // Upload all files in batch
          if (filesToUpload.length > 0) {
            try {
              // Upload files to server
              const uploadResult = await fileAPI.uploadFiles(
                userId,
                filesToUpload,
                sessionId
              );

              // 保存后端返回的文件数据
              if (
                uploadResult &&
                typeof uploadResult === "object"
              ) {
                console.log(
                  "Paste upload result:",
                  uploadResult
                );
                setUploadedFileData((prev) => {
                  const newData = {
                    ...prev,
                    ...uploadResult,
                  };
                  console.log(
                    "Updated uploadedFileData (paste):",
                    newData
                  );
                  return newData;
                });
              }

              // Update all file statuses to done
              setFileList((prev) =>
                prev.map((f) => {
                  const isUploadedFile = uploadFiles.some(
                    (uf) => uf.uid === f.uid
                  );
                  return isUploadedFile
                    ? { ...f, status: "done" as const }
                    : f;
                })
              );

              // Show successful paste notification
              const fileCount = filesToUpload.length;
              const fileType = fileCount === 1 ? "file" : "files";
              message.success(
                `${fileCount} ${fileType} pasted and uploaded successfully`
              );
            } catch (error) {
              console.error("Files upload failed:", error);

              // Update all file statuses to error
              setFileList((prev) =>
                prev.map((f) => {
                  const isUploadedFile = uploadFiles.some(
                    (uf) => uf.uid === f.uid
                  );
                  return isUploadedFile
                    ? { ...f, status: "error" as const }
                    : f;
                })
              );

              const fileCount = filesToUpload.length;
              const fileType = fileCount === 1 ? "file" : "files";
              message.error(
                `Failed to upload ${fileCount} pasted ${fileType}`
              );
            }
          }
        }
      }
    };

    const resetInput = () => {
      if (textAreaRef.current) {
        textAreaRef.current.value = "";
        textAreaRef.current.style.height = textAreaDefaultHeight;
        setText("");
        setFileList([]);
        setRelevantPlans([]);
        setAttachedPlan(null);
        // 清空上传文件的数据
        setUploadedFileData({});
      }
      if (textAreaDivRef.current) {
        textAreaDivRef.current.style.height = textAreaDefaultHeight;
      }
    };

    const searchableData = React.useMemo(() => {
      return allPlans.map((plan) => ({
        ...plan,
        taskLower: plan.task?.toLowerCase() || "",
        stepTexts:
          plan.steps?.map(
            (step: { title: string; details: string }) =>
              (step.title?.toLowerCase() || "") +
              " " +
              (step.details?.toLowerCase() || "")
          ) || [],
      }));
    }, [allPlans]);

    const searchPlans = React.useCallback(
      debounce((query: string) => {
        console.log("Search request with query:", query);

        // Don't search if query is too short, no plans available, or plan is already attached
        if (
          query.length < 3 ||
          !searchableData ||
          searchableData.length === 0 ||
          attachedPlan
        ) {
          return;
        }

        setIsSearching(true);
        try {
          const searchTerms = query.toLowerCase().split(" ");
          const matchingPlans = searchableData.filter((plan) => {
            if (query.length <= 2) {
              if (
                plan.taskLower.startsWith(query.toLowerCase())
              ) {
                return true;
              }
            }
            const taskMatches = searchTerms.every((term) =>
              plan.taskLower.includes(term)
            );
            if (taskMatches) {
              return true;
            }

            return plan.stepTexts.some(
              (stepText: string | string[]) =>
                searchTerms.every((term) =>
                  stepText.includes(term)
                )
            );
          });

          if (matchingPlans.length > 0) {
            setRelevantPlans(matchingPlans.slice(0, 5));
            setIsRelevantPlansVisible(true);
            // TODO: add sorting
          } else {
            setRelevantPlans([]);
            setAttachedPlan(null);
            setIsRelevantPlansVisible(false);
          }
        } catch (error) {
          console.error("Error searching plans:", error);
        } finally {
          setIsSearching(false);
        }
      }, 1000),
      [searchableData, runStatus, isPlanMessage, attachedPlan]
    );

    const handleTextChange = (
      event: React.ChangeEvent<HTMLTextAreaElement>
    ) => {
      const newText = event.target.value;
      setText(newText);

      // Clear relevant plans and attached plan as soon as the query changes
      setRelevantPlans([]);

      const shouldSearch = !(
        runStatus === "connected" || runStatus === "awaiting_input"
      );
      if (shouldSearch) {
        searchPlans(newText);
      } else if (relevantPlans.length > 0) {
        // Clear any relevant plans if not in the right state
        setRelevantPlans([]);
        setAttachedPlan(null);
      }
    };

    const submitInternal = (
      query: string,
      files: RcFile[],
      accepted: boolean,
      doResetInput: boolean = true
    ) => {
      console.log(
        "ChatInput submitInternal - uploadedFileData:",
        uploadedFileData
      );

      if (attachedPlan) {
        onSubmit(
          query,
          files,
          accepted,
          attachedPlan,
          uploadedFileData
        );
      } else {
        onSubmit(query, files, accepted, undefined, uploadedFileData);
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
        const query = textAreaRef.current?.value || "";

        // Get all valid RcFile objects
        const files = fileList
          .filter((file) => file.originFileObj)
          .map((file) => file.originFileObj as RcFile);

        submitInternal(query, files, false);
      }
    };

    const handleVoiceTranscript = (transcript: string) => {
      setText(transcript);
      if (textAreaRef.current) {
        textAreaRef.current.value = transcript;
        // 调整文本框高度
        const scrollHeight = textAreaRef.current.scrollHeight;
        const newHeight = Math.min(scrollHeight, 120);
        textAreaRef.current.style.height = `${newHeight}px`;
      }
    };

    const handleVoiceError = (error: string) => {
      notificationApi.error({
        message: <span className="text-sm">语音识别错误</span>,
        description: (
          <span className="text-sm text-secondary">{error}</span>
        ),
        duration: 5,
      });
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
          // 调整文本框高度
          const scrollHeight = textAreaRef.current.scrollHeight;
          const newHeight = Math.min(scrollHeight, 120);
          textAreaRef.current.style.height = `${newHeight}px`;
          // 聚焦并设置光标位置
          textAreaRef.current.focus();
          textAreaRef.current.setSelectionRange(
            value.length,
            value.length
          );
        }
      },
    }));

    // Add helper function for file validation and addition
    const handleFileValidationAndAdd = async (
      file: File
    ): Promise<boolean> => {
      // 获取有效的sessionId
      const validSessionId = getValidSessionId();

      // Check if sessionId is available
      if (!validSessionId) {
        console.error("No valid sessionId available for file upload");
        notificationApi.error({
          message: <span className="text-sm">No Session</span>,
          description: (
            <span className="text-sm text-secondary">
              Cannot upload files without an active session.
              Please select a session first.
            </span>
          ),
          duration: 5,
        });
        return false;
      }

      console.log("Using sessionId for file upload:", validSessionId);

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        message.error(
          `${file.name} is too large. Maximum size is 5MB.`
        );
        return false;
      }

      // Check file type
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        notificationApi.warning({
          message: (
            <span className="text-sm">Unsupported File Type</span>
          ),
          description: (
            <span className="text-sm text-secondary">
              Please upload only text (.txt), images (.jpg, .png,
              .gif, .svg), PDF (.pdf), or Word documents (.doc,
              .docx) files.
            </span>
          ),
          duration: 8.5,
        });
        return false;
      }

      // Check if file already exists
      const existingFile = fileList.find((f) => f.name === file.name);
      if (existingFile) {
        message.warning(`${file.name} is already attached.`);
        return false;
      }

      // Add file to fileList with uploading status
      const uploadFile: UploadFile = {
        uid: `file-${Date.now()}-${file.name}`,
        name: file.name,
        status: "uploading",
        size: file.size,
        type: file.type,
        originFileObj: file as RcFile,
      };

      setFileList((prev) => [...prev, uploadFile]);

      try {
        setIsUploading(true);

        // Upload file to server
        const uploadResult = await fileAPI.uploadFiles(
          userId,
          [file],
          validSessionId
        );

        // 保存后端返回的文件数据
        if (uploadResult && typeof uploadResult === "object") {
          console.log("File upload result:", uploadResult);
          setUploadedFileData((prev) => {
            const newData = {
              ...prev,
              ...uploadResult,
            };
            console.log("Updated uploadedFileData:", newData);
            return newData;
          });
        }

        // Update file status to done
        setFileList((prev) =>
          prev.map((f) =>
            f.uid === uploadFile.uid
              ? { ...f, status: "done" as const }
              : f
          )
        );

        // Show success notification
        notificationApi.success({
          message: <span className="text-sm">File Uploaded</span>,
          description: (
            <span className="text-sm text-secondary">
              {file.name} has been uploaded successfully.
            </span>
          ),
          duration: 3,
        });

        return true;
      } catch (error) {
        console.error("File upload failed:", error);

        // Update file status to error
        setFileList((prev) =>
          prev.map((f) =>
            f.uid === uploadFile.uid
              ? { ...f, status: "error" as const }
              : f
          )
        );

        // Show error notification
        notificationApi.error({
          message: <span className="text-sm">Upload Failed</span>,
          description: (
            <span className="text-sm text-secondary">
              Failed to upload {file.name}. Please try again.
            </span>
          ),
          duration: 5,
        });

        return false;
      } finally {
        setIsUploading(false);
      }
    };

    // Update the upload props to use the new helper function
    const uploadProps: UploadProps = {
      name: "file",
      multiple: true,
      fileList,
      beforeUpload: async (file: RcFile) => {
        const result = await handleFileValidationAndAdd(file);
        if (result) {
          return false; // Prevent automatic upload since we handle it manually
        }
        return Upload.LIST_IGNORE;
      },
      onRemove: (file: UploadFile) => {
        setFileList(fileList.filter((item) => item.uid !== file.uid));
      },
      showUploadList: false, // We'll handle our own custom file preview
      customRequest: (options: any) => {
        // This is not used since we handle upload manually
        if (options.onSuccess) {
          options.onSuccess("ok", options.file);
        }
      },
    };

    const getFileIcon = (file: UploadFile) => {
      const fileType = file.type || "";
      const fileName = file.name || "";

      // Show upload status
      if (file.status === "uploading") {
        return (
          <Progress
            type="circle"
            size={16}
            percent={50}
            strokeColor={
              darkMode === "dark" ? "#a855f7" : "#7c3aed"
            }
          />
        );
      }

      if (file.status === "error") {
        return (
          <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
        );
      }

      if (fileType.startsWith("image/")) {
        return (
          <ImageIcon
            className={`w-4 h-4 ${darkMode === "dark"
              ? "text-magenta-400"
              : "text-magenta-600"
              }`}
          />
        );
      }

      if (fileType === "application/pdf") {
        return <FileTextIcon className="w-4 h-4 text-red-500" />;
      }

      if (
        fileType.includes("word") ||
        fileName.endsWith(".doc") ||
        fileName.endsWith(".docx")
      ) {
        return (
          <FileTextIcon
            className={`w-4 h-4 ${darkMode === "dark"
              ? "text-magenta-400"
              : "text-magenta-600"
              }`}
          />
        );
      }

      if (fileType === "text/plain" || fileName.endsWith(".txt")) {
        return <FileTextIcon className="w-4 h-4 text-green-500" />;
      }

      return (
        <FileTextIcon
          className={`w-4 h-4 ${darkMode === "dark" ? "text-gray-400" : "text-gray-500"
            }`}
        />
      );
    };

    const formatFileSize = (bytes: number) => {
      if (bytes === 0) return "0 Bytes";
      const k = 1024;
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return (
        parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
      );
    };

    // Add drag and drop handlers
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

    // Update the drop handler to use the new helper function
    const handleDrop = async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      setIsDragActive(false);

      if (isInputDisabled || !enable_upload) return;

      // 检查是否有有效的sessionId
      const validSessionId = getValidSessionId();
      if (!validSessionId) {
        notificationApi.error({
          message: <span className="text-sm">No Session</span>,
          description: (
            <span className="text-sm text-secondary">
              Cannot upload files without an active session.
              Please select a session first.
            </span>
          ),
          duration: 5,
        });
        return;
      }

      const droppedFiles = Array.from(e.dataTransfer.files) as File[];
      for (const file of droppedFiles) {
        await handleFileValidationAndAdd(file);
      }
    };

    const handleUsePlan = (plan: IPlan) => {
      setRelevantPlans([]); // Close the dropdown
      setAttachedPlan(plan);
    };

    const handlePlanClick = () => {
      setIsPlanModalVisible(true);
    };

    const handlePlanModalClose = () => {
      setIsPlanModalVisible(false);
    };

    React.useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        // Only process if dropdown is visible
        if (!isRelevantPlansVisible) return;

        // Get the clicked element
        const target = e.target as Node;

        // Check if click was on textarea or within the plans dropdown
        const textAreaElement = textAreaRef.current;
        const planElement = document.querySelector(
          '[data-component="relevant-plans"]'
        );

        const isClickInsideTextArea =
          textAreaElement && textAreaElement.contains(target);
        const isClickInsidePlans =
          planElement && planElement.contains(target);

        // Hide dropdown if click is outside both elements
        if (!isClickInsideTextArea && !isClickInsidePlans) {
          setIsRelevantPlansVisible(false);
        }
      };

      // Handle escape key
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape" && isRelevantPlansVisible) {
          setIsRelevantPlansVisible(false);
        }
      };

      // Add listeners
      document.addEventListener("click", handleClickOutside);
      document.addEventListener("keydown", handleKeyDown);

      return () => {
        document.removeEventListener("click", handleClickOutside);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [isRelevantPlansVisible]);

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
        {isDragActive && enable_upload && (
          <div
            className={`absolute inset-0 border-2 border-dashed rounded-lg flex items-center justify-center z-10 ${darkMode === "dark"
              ? "bg-magenta-500 bg-opacity-10 border-magenta-500"
              : "bg-magenta-500 bg-opacity-5 border-magenta-500"
              }`}
          >
            <div className="text-center">
              <UploadIcon
                className={`w-12 h-12 mx-auto mb-2 ${darkMode === "dark"
                  ? "text-magenta-400"
                  : "text-magenta-600"
                  }`}
              />
              <p
                className={`font-medium ${darkMode === "dark"
                  ? "text-magenta-300"
                  : "text-magenta-700"
                  }`}
              >
                Drop files here to upload
              </p>
              <p
                className={`text-sm ${darkMode === "dark"
                  ? "text-magenta-400"
                  : "text-magenta-600"
                  }`}
              >
                Supported: Images, PDF, Word, Text files
              </p>
            </div>
          </div>
        )}

        {/* Attached Items Preview */}
        {(attachedPlan || fileList.length > 0) && (
          <div
            className={`-mb-2 mx-1 ${darkMode === "dark"
              ? "bg-[#333333]"
              : "bg-magenta-50"
              } rounded-t border-b-0 p-2 flex border flex-wrap gap-2`}
          >
            {/* Attached Plan */}
            {attachedPlan && (
              <div
                className={`flex items-center gap-1 ${darkMode === "dark"
                  ? "bg-[#444444] text-white"
                  : "bg-white text-magenta-800 border border-magenta-200"
                  } rounded px-2 py-1 text-xs cursor-pointer hover:opacity-80 transition-opacity shadow-sm`}
                onClick={handlePlanClick}
              >
                <span
                  className={`truncate max-w-[150px] ${darkMode === "dark"
                    ? "text-white"
                    : "text-magenta-800"
                    }`}
                >
                  📋 {attachedPlan.task}
                </span>
                <Button
                  type="text"
                  size="small"
                  className="p-0 ml-1 flex items-center justify-center"
                  onClick={(e: {
                    stopPropagation: () => void;
                  }) => {
                    e.stopPropagation();
                    setAttachedPlan(null);
                  }}
                  icon={
                    <XIcon
                      className={`w-3 h-3 ${darkMode === "dark"
                        ? "text-gray-400"
                        : "text-magenta-600"
                        }`}
                    />
                  }
                />
              </div>
            )}

            {/* Attached Files */}
            {fileList.map((file) => (
              <div
                key={file.uid}
                className={`flex items-center gap-2 ${darkMode === "dark"
                  ? "bg-[#444444] text-white border border-gray-600"
                  : "bg-white text-magenta-800 border border-magenta-200"
                  } rounded-lg px-3 py-2 text-xs shadow-sm hover:shadow-md transition-shadow ${file.status === "error"
                    ? "border-red-500"
                    : ""
                  }`}
              >
                {getFileIcon(file)}
                <div className="flex flex-col min-w-0 flex-1">
                  <span
                    className={`truncate font-medium ${darkMode === "dark"
                      ? "text-white"
                      : "text-magenta-800"
                      }`}
                  >
                    {file.name}
                  </span>
                  <span
                    className={`text-xs ${darkMode === "dark"
                      ? "text-gray-400"
                      : "text-magenta-600"
                      }`}
                  >
                    {formatFileSize(file.size || 0)}
                    {file.status === "uploading" &&
                      " - Uploading..."}
                    {file.status === "error" &&
                      " - Upload failed"}
                  </span>
                </div>
                <Button
                  type="text"
                  size="small"
                  className={`p-0 ml-1 flex items-center justify-center rounded-full ${darkMode === "dark"
                    ? "hover:bg-red-500/20 hover:text-red-400"
                    : "hover:bg-red-100 hover:text-red-600"
                    }`}
                  onClick={() =>
                    setFileList((prev) =>
                      prev.filter(
                        (f) => f.uid !== file.uid
                      )
                    )
                  }
                  icon={
                    <XIcon
                      className={`w-3 h-3 ${darkMode === "dark"
                        ? "text-gray-400"
                        : "text-magenta-600"
                        }`}
                    />
                  }
                />
              </div>
            ))}
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

        <div className="mt-4 p-1">
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
                      className={`absolute left-4 top-1/2 transform -translate-y-1/2 z-10 ${isInputDisabled
                        ? "pointer-events-none opacity-50"
                        : ""
                        }`}
                    >
                      <Dropdown
                        overlay={
                          <Menu>
                            <Menu.Item
                              key="attach-file"
                              icon={
                                <PaperclipIcon
                                  className={`w-4 h-4 ${darkMode ===
                                    "dark"
                                    ? "text-gray-300"
                                    : "text-magenta-600"
                                    }`}
                                />
                              }
                            >
                              <Upload
                                {...uploadProps}
                                showUploadList={
                                  false
                                }
                              >
                                <span>
                                  Attach File
                                </span>
                              </Upload>
                            </Menu.Item>
                            <Menu.SubMenu
                              key="attach-plan"
                              title="Attach Plan"
                              icon={
                                <FileTextIcon
                                  className={`w-4 h-4 ${darkMode ===
                                    "dark"
                                    ? "text-gray-300"
                                    : "text-magenta-600"
                                    }`}
                                />
                              }
                            >
                              {allPlans.length ===
                                0 ? (
                                <Menu.Item
                                  disabled
                                  key="no-plans"
                                >
                                  No plans
                                  available
                                </Menu.Item>
                              ) : (
                                allPlans.map(
                                  (
                                    plan: any
                                  ) => (
                                    <Menu.Item
                                      key={
                                        plan.id ||
                                        plan.task
                                      }
                                      onClick={() =>
                                        handleUsePlan(
                                          plan
                                        )
                                      }
                                    >
                                      {
                                        plan.task
                                      }
                                    </Menu.Item>
                                  )
                                )
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
                            disabled={
                              isInputDisabled
                            }
                            className={`flex justify-center items-center w-8 h-8 rounded-xl transition-smooth hover-lift relative ${fileList.length > 0
                              ? "text-accent bg-accent/10"
                              : darkMode ===
                                "dark"
                                ? "text-secondary hover:text-accent hover:bg-accent/10"
                                : "text-secondary hover:text-accent hover:bg-accent/10"
                              }`}
                          >
                            <PaperclipIcon className="h-4 w-4" />
                            {fileList.length >
                              0 && (
                                <span className="absolute -top-1 -right-1 bg-accent text-white text-xs rounded-full w-4 h-4 flex items-center justify-center animate-bounce-in">
                                  {
                                    fileList.length
                                  }
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
                    onPaste={handlePaste}
                    ref={textAreaRef}
                    defaultValue={""}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    className={`input-enhanced flex items-center w-full resize-none p-4 ${enable_upload ? "pl-14" : "pl-6"
                      } ${runStatus === "active"
                        ? "pr-32"
                        : "pr-24"
                      } rounded-full transition-smooth border-2 ${darkMode === "dark"
                        ? "bg-tertiary/50 border-border-primary backdrop-blur-sm hover:bg-tertiary/70 focus:bg-tertiary/80 focus:border-accent"
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
                        ? "Type your response here and let Dr. Sai know of any changes in the browser."
                        : enable_upload
                          ? dragOver
                            ? "Drop files here..."
                            : "Type your message here..."
                          : "Type your message here..."
                    }
                    disabled={isInputDisabled}
                  />
                  {/* 右侧按钮组 */}
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2 flex items-center space-x-2">
                    {/* 语音输入按钮 */}
                    <VoiceInput
                      onTranscript={handleVoiceTranscript}
                      onError={handleVoiceError}
                      disabled={isInputDisabled}
                      language={
                        voiceSettings.inputLanguage
                      }
                      className="transition-smooth hover-lift"
                    />

                    {/* 暂停按钮 - 仅在active状态显示 */}
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

                    {/* 发送按钮 */}
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
              className={`h-5 inline-block mr-2 ${darkMode === "dark"
                ? "text-orange-400"
                : "text-orange-600"
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
