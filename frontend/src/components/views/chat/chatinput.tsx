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

const ChatInput = React.forwardRef<{ focus: () => void }, ChatInputProps>(
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
    const userId = user?.email || "default_user";
    const [isRelevantPlansVisible, setIsRelevantPlansVisible] =
      React.useState(false);
    const [isPlanModalVisible, setIsPlanModalVisible] =
      React.useState(false);
    const textAreaDefaultHeight = "64px";
    const isInputDisabled =
      disabled ||
      runStatus === "active" ||
      runStatus === "pausing" ||
      inputRequest?.input_type === "approval";

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
      if (isInputDisabled || !enable_upload || !sessionId) return;

      // Handle image paste
      if (e.clipboardData?.items) {
        let hasImageItem = false;

        for (let i = 0; i < e.clipboardData.items.length; i++) {
          const item = e.clipboardData.items[i];

          // Handle image items
          if (item.type.indexOf("image/") === 0) {
            hasImageItem = true;
            const file = item.getAsFile();

            if (file && file.size <= MAX_FILE_SIZE) {
              // Prevent the default paste behavior for images
              e.preventDefault();

              // Create a unique file name
              const fileName = `pasted-image-${new Date().getTime()}.png`;

              // Create a new File with a proper name
              const namedFile = new File([file], fileName, {
                type: file.type,
              });

              // Convert to the expected UploadFile format
              const uploadFile: UploadFile = {
                uid: `paste-${Date.now()}`,
                name: fileName,
                status: "done",
                size: namedFile.size,
                type: namedFile.type,
                originFileObj: namedFile as RcFile,
              };

              // Add to file list with uploading status
              setFileList((prev) => [...prev, uploadFile]);

              try {
                // Upload file to server
                await fileAPI.uploadFiles(
                  userId,
                  [namedFile],
                  sessionId
                );

                // Update file status to done
                setFileList((prev) =>
                  prev.map((f) =>
                    f.uid === uploadFile.uid
                      ? { ...f, status: "done" as const }
                      : f
                  )
                );

                // Show successful paste notification
                message.success(
                  `Image pasted and uploaded successfully`
                );
              } catch (error) {
                console.error("Image upload failed:", error);

                // Update file status to error
                setFileList((prev) =>
                  prev.map((f) =>
                    f.uid === uploadFile.uid
                      ? { ...f, status: "error" as const }
                      : f
                  )
                );

                message.error(`Failed to upload pasted image`);
              }
            } else if (file && file.size > MAX_FILE_SIZE) {
              message.error(
                `Pasted image is too large. Maximum size is 5MB.`
              );
            }
          }

          // Handle text items - only if there's a large amount of text
          if (item.type === "text/plain" && !hasImageItem) {
            item.getAsString(async (text) => {
              // Only process for large text
              if (text.length > LARGE_TEXT_THRESHOLD) {
                // We need to prevent the default paste behavior
                // But since we're in an async callback, we need to
                // manually clear the textarea's selection value
                setTimeout(() => {
                  if (textAreaRef.current) {
                    const currentValue =
                      textAreaRef.current.value;
                    const selectionStart =
                      textAreaRef.current
                        .selectionStart || 0;
                    const selectionEnd =
                      textAreaRef.current.selectionEnd ||
                      0;

                    // Remove the pasted text from the textarea
                    const newValue =
                      currentValue.substring(
                        0,
                        selectionStart - text.length
                      ) +
                      currentValue.substring(
                        selectionEnd
                      );

                    // Update the textarea
                    textAreaRef.current.value = newValue;
                    // Trigger the onChange event manually
                    setText(newValue);
                  }
                }, 0);

                // Prevent default paste for large text
                e.preventDefault();

                // Create a text file from the pasted content
                const blob = new Blob([text], {
                  type: "text/plain",
                });
                const file = new File(
                  [blob],
                  `pasted-text-${new Date().getTime()}.txt`,
                  { type: "text/plain" }
                );

                // Add to file list with uploading status
                const uploadFile: UploadFile = {
                  uid: `paste-${Date.now()}`,
                  name: file.name,
                  status: "uploading",
                  size: file.size,
                  type: file.type,
                  originFileObj: file as RcFile,
                };

                setFileList((prev) => [...prev, uploadFile]);

                try {
                  // Upload file to server
                  await fileAPI.uploadFiles(
                    userId,
                    [file],
                    sessionId
                  );

                  // Update file status to done
                  setFileList((prev) =>
                    prev.map((f) =>
                      f.uid === uploadFile.uid
                        ? {
                          ...f,
                          status: "done" as const,
                        }
                        : f
                    )
                  );

                  // Notify user about the conversion
                  notificationApi.info({
                    message: (
                      <span className="text-sm">
                        Large Text Converted to File
                      </span>
                    ),
                    description: (
                      <span className="text-sm text-secondary">
                        Your pasted text has been
                        uploaded as a file.
                      </span>
                    ),
                    duration: 3,
                  });
                } catch (error) {
                  console.error(
                    "Text file upload failed:",
                    error
                  );

                  // Update file status to error
                  setFileList((prev) =>
                    prev.map((f) =>
                      f.uid === uploadFile.uid
                        ? {
                          ...f,
                          status: "error" as const,
                        }
                        : f
                    )
                  );

                  notificationApi.error({
                    message: (
                      <span className="text-sm">
                        Upload Failed
                      </span>
                    ),
                    description: (
                      <span className="text-sm text-secondary">
                        Failed to upload text file.
                      </span>
                    ),
                    duration: 5,
                  });
                }
              }
            });
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
        const query = textAreaRef.current?.value || "";

        // Get all valid RcFile objects
        const files = fileList
          .filter((file) => file.originFileObj)
          .map((file) => file.originFileObj as RcFile);

        submitInternal(query, files, false);
      }
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

    // Expose focus method via ref
    React.useImperativeHandle(ref, () => ({
      focus: () => {
        textAreaRef.current?.focus();
      },
    }));

    // Add helper function for file validation and addition
    const handleFileValidationAndAdd = async (
      file: File
    ): Promise<boolean> => {
      // Check if sessionId is available
      if (!sessionId) {
        notificationApi.error({
          message: <span className="text-sm">No Session</span>,
          description: (
            <span className="text-sm text-secondary">
              Cannot upload files without an active session.
            </span>
          ),
          duration: 5,
        });
        return false;
      }

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
          sessionId
        );

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
        return <Progress type="circle" size={16} percent={50} />;
      }

      if (file.status === "error") {
        return (
          <ExclamationTriangleIcon className="w-4 h-4 text-red-500" />
        );
      }

      if (fileType.startsWith("image/")) {
        return <ImageIcon className="w-4 h-4 text-blue-500" />;
      }

      if (fileType === "application/pdf") {
        return <FileTextIcon className="w-4 h-4 text-red-500" />;
      }

      if (
        fileType.includes("word") ||
        fileName.endsWith(".doc") ||
        fileName.endsWith(".docx")
      ) {
        return <FileTextIcon className="w-4 h-4 text-blue-600" />;
      }

      if (fileType === "text/plain" || fileName.endsWith(".txt")) {
        return <FileTextIcon className="w-4 h-4 text-green-500" />;
      }

      return <FileTextIcon className="w-4 h-4 text-gray-500" />;
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

      if (isInputDisabled || !enable_upload || !sessionId) return;

      const droppedFiles = Array.from(e.dataTransfer.files);
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
      <div className="mt-2 w-full relative">
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
          <div className="absolute inset-0 bg-blue-500 bg-opacity-10 border-2 border-dashed border-blue-500 rounded-lg flex items-center justify-center z-10">
            <div className="text-center">
              <UploadIcon className="w-12 h-12 text-blue-500 mx-auto mb-2" />
              <p className="text-blue-600 font-medium">
                Drop files here to upload
              </p>
              <p className="text-blue-500 text-sm">
                Supported: Images, PDF, Word, Text files
              </p>
            </div>
          </div>
        )}

        {/* Attached Items Preview */}
        {(attachedPlan || fileList.length > 0) && (
          <div
            className={`-mb-2 mx-1 ${darkMode === "dark" ? "bg-[#333333]" : "bg-gray-100"
              } rounded-t border-b-0 p-2 flex border flex-wrap gap-2`}
          >
            {/* Attached Plan */}
            {attachedPlan && (
              <div
                className={`flex items-center gap-1 ${darkMode === "dark"
                  ? "bg-[#444444] text-white"
                  : "bg-white text-black"
                  } rounded px-2 py-1 text-xs cursor-pointer hover:opacity-80 transition-opacity`}
                onClick={handlePlanClick}
              >
                <span className="truncate max-w-[150px]">
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
                  icon={<XIcon className="w-3 h-3" />}
                />
              </div>
            )}

            {/* Attached Files */}
            {fileList.map((file) => (
              <div
                key={file.uid}
                className={`flex items-center gap-2 ${darkMode === "dark"
                  ? "bg-[#444444] text-white border border-gray-600"
                  : "bg-white text-black border border-gray-200"
                  } rounded-lg px-3 py-2 text-xs shadow-sm hover:shadow-md transition-shadow ${file.status === "error"
                    ? "border-red-500"
                    : ""
                  }`}
              >
                {getFileIcon(file)}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="truncate font-medium">
                    {file.name}
                  </span>
                  <span className="text-xs opacity-70">
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
                  className="p-0 ml-1 flex items-center justify-center hover:bg-red-100 hover:text-red-600 rounded-full"
                  onClick={() =>
                    setFileList((prev) =>
                      prev.filter(
                        (f) => f.uid !== file.uid
                      )
                    )
                  }
                  icon={<XIcon className="w-3 h-3" />}
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

        <div className="mt-2 rounded shadow-sm flex">
          <div
            className={`flex w-full transition-all duration-200 ${isDragActive
              ? "ring-2 ring-blue-500 ring-opacity-50 bg-blue-50 dark:bg-blue-900/20"
              : ""
              }`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="flex w-full">
              <div className="flex-1">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleSubmit();
                  }}
                >
                  <textarea
                    id="queryInput"
                    name="queryInput"
                    onPaste={handlePaste}
                    ref={textAreaRef}
                    defaultValue={""}
                    onChange={handleTextChange}
                    onKeyDown={handleKeyDown}
                    className={`flex items-center w-full resize-none border-l border-t border-b border-accent p-2 pl-5 rounded-l-lg ${darkMode === "dark"
                      ? "bg-[#444444] text-white"
                      : "bg-white text-black"
                      } ${isInputDisabled
                        ? "cursor-not-allowed"
                        : ""
                      } focus:outline-none`}
                    style={{
                      maxHeight: "120px",
                      overflowY: "auto",
                      minHeight: "50px",
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
                </form>
              </div>

              <div
                className={`flex items-center justify-center gap-2 border-t border-r border-b border-accent px-2 rounded-r-lg ${darkMode === "dark"
                  ? "bg-[#444444] text-white"
                  : "bg-white text-black"
                  }`}
              >
                {/* File upload button replaced with Dropdown */}
                {enable_upload && (
                  <div
                    className={`${isInputDisabled
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
                              <PaperclipIcon className="w-4 h-4" />
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
                              <FileTextIcon className="w-4 h-4" />
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
                                (plan: any) => (
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
                          disabled={isInputDisabled}
                          className={`flex justify-center items-center transition duration-300 relative ${fileList.length > 0
                            ? "text-blue-500"
                            : "text-accent"
                            }`}
                        >
                          <PaperclipIcon className="h-5 w-5" />
                          {fileList.length > 0 && (
                            <span className="absolute -top-1 -right-1 bg-blue-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">
                              {fileList.length}
                            </span>
                          )}
                        </button>
                      </Tooltip>
                    </Dropdown>
                  </div>
                )}

                {runStatus === "active" && (
                  <button
                    type="button"
                    onClick={handlePause}
                    className="bg-magenta-800 hover:bg-magenta-900 text-white rounded flex justify-center items-center w-11 h-9 transition duration-300"
                  >
                    <PauseCircleIcon className="h-6 w-6" />
                  </button>
                )}
                {
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={isInputDisabled}
                    className={`bg-magenta-800 transition duration-300 rounded flex justify-center items-center w-11 h-9 ${isInputDisabled
                      ? "cursor-not-allowed"
                      : "hover:bg-magenta-900"
                      }`}
                  >
                    <PaperAirplaneIcon className="h-6 w-6 text-white" />
                  </button>
                }
              </div>
            </div>
          </div>
        </div>

        {error && !error.status && (
          <div className="p-2 border rounded mt-4 text-orange-500 text-sm">
            <ExclamationTriangleIcon className="h-5 text-orange-500 inline-block mr-2" />
            {error.message}
          </div>
        )}
      </div>
    );
  }
);

export default ChatInput;
