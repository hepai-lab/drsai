import * as React from "react";
import { message, notification } from "antd";
import type { UploadFile, RcFile } from "antd/es/upload/interface";
import {
  MAX_FILE_SIZE,
  ALLOWED_FILE_TYPES,
  LARGE_TEXT_THRESHOLD,
} from "../constants/fileConfig";
import { fileAPI } from "../../../api";

interface UseFileUploadProps {
  enable_upload: boolean;
  isInputDisabled: boolean;
  userId?: string;
  sessionId?: number;
}

interface UseFileUploadReturn {
  fileList: UploadFile[];
  setFileList: React.Dispatch<React.SetStateAction<UploadFile[]>>;
  isUploading: boolean;
  notificationContextHolder: React.ReactElement;
  handleFileValidationAndAdd: (file: File) => Promise<boolean>;
  handlePaste: (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    textAreaRef: React.RefObject<HTMLTextAreaElement>,
    setText: (text: string) => void
  ) => Promise<void>;
  removeFile: (uid: string) => void;
  clearFiles: () => void;
  uploadedFilesInfo: Array<{
    name: string;
    type: string;
    path: string;
    suffix: string;
    size: number;
    uuid: string;
    url?: string;
  }>;
}

export const useFileUpload = ({
  enable_upload,
  isInputDisabled,
  userId,
  sessionId,
}: UseFileUploadProps): UseFileUploadReturn => {
  const [fileList, setFileList] = React.useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = React.useState(false);
  const [uploadedFilesInfo, setUploadedFilesInfo] = React.useState<Array<{
    name: string;
    type: string;
    path: string;
    suffix: string;
    size: number;
    uuid: string;
    url?: string;
  }>>([]);
  const [notificationApi, notificationContextHolder] =
    notification.useNotification();

  /**
   * Validate and add file to upload list, then upload to server immediately
   */
  const handleFileValidationAndAdd = async (
    file: File
  ): Promise<boolean> => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      message.error(`${file.name} is too large. Maximum size is 5MB.`);
      return false;
    }

    // Check if file already exists
    const existingFile = fileList.find((f) => f.name === file.name);
    if (existingFile) {
      message.warning(`${file.name} is already attached.`);
      return false;
    }

    // Add file to fileList with uploading status
    const fileUid = `file-${Date.now()}-${file.name}`;
    const uploadFile: UploadFile = {
      uid: fileUid,
      name: file.name,
      status: "uploading",
      size: file.size,
      type: file.type,
      originFileObj: file as RcFile,
    };

    setFileList((prev) => [...prev, uploadFile]);

    // Upload file to server immediately if enable_upload is true
    // Note: file upload no longer depends on sessionId
    if (enable_upload && userId) {
      try {
        setIsUploading(true);
        // sessionId is optional, use 0 or -1 if not provided
        const uploadSessionId = sessionId && sessionId > 0 ? sessionId : (sessionId || 0);
        const response = await fileAPI.saveFilesToServer(userId, [file], uploadSessionId);

        // Extract file info from response
        // fileAPI.saveFilesToServer returns data.data which is already the files array
        let fileInfoList: Array<{
          name: string;
          type: string;
          path: string;
          suffix: string;
          size: number;
          uuid: string;
          url?: string;
        }> = [];

        if (response) {
          if (Array.isArray(response)) {
            // Response is directly an array (this is the expected format)
            fileInfoList = response;
          } else if (response.data && Array.isArray(response.data)) {
            // Response has {status, data} format
            fileInfoList = response.data;
          } else if (response.status && response.data) {
            // Response has nested data
            fileInfoList = Array.isArray(response.data) ? response.data : [];
          }
        }

        // Store uploaded file info
        if (fileInfoList.length > 0) {
          const fileInfo = fileInfoList[0]; // Use first file info
          setUploadedFilesInfo((prev) => {
            const newInfo = [...prev, fileInfo];
            return newInfo;
          });

          // Update file status to done after successful upload
          // Also store the uploaded file info in the file's response field for easier matching
          setFileList((prev) => {
            const updated = prev.map((f) =>
              f.uid === fileUid
                ? {
                  ...f,
                  status: "done" as const,
                  response: fileInfo
                }
                : f
            );
            return updated;
          });
        } else {
          // Even if fileInfoList is empty, mark file as done (but without response)
          setFileList((prev) =>
            prev.map((f) =>
              f.uid === fileUid ? { ...f, status: "done" as const } : f
            )
          );
        }

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
      } catch (error) {
        // Update file status to error
        setFileList((prev) =>
          prev.map((f) =>
            f.uid === fileUid ? { ...f, status: "error" as const } : f
          )
        );

        const errorMessage = error instanceof Error ? error.message : "文件上传失败";
        message.error(`${file.name}: ${errorMessage}`);
        console.error("File upload error:", error);

        // Remove file from list on error (optional, you can keep it if you want to retry)
        // setFileList((prev) => prev.filter((f) => f.uid !== fileUid));
      } finally {
        setIsUploading(false);
      }
    } else {
      // If upload is disabled or missing credentials, just mark as done
      setFileList((prev) =>
        prev.map((f) =>
          f.uid === fileUid ? { ...f, status: "done" as const } : f
        )
      );

      // Show success notification
      notificationApi.success({
        message: <span className="text-sm">File Added</span>,
        description: (
          <span className="text-sm text-secondary">
            {file.name} will be sent with your message.
          </span>
        ),
        duration: 3,
      });
    }

    return true;
  };

  /**
   * Handle paste event for images and large text
   */
  const handlePaste = async (
    e: React.ClipboardEvent<HTMLTextAreaElement>,
    textAreaRef: React.RefObject<HTMLTextAreaElement>,
    setText: (text: string) => void
  ) => {
    if (isInputDisabled || !enable_upload) return;

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
            const fileName = `pasted-image-${new Date().getTime()}-${i}.png`;
            const namedFile = new File([file], fileName, {
              type: file.type,
            });

            filesToUpload.push(namedFile);

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
          setTimeout(() => {
            if (textAreaRef.current) {
              const currentValue = textAreaRef.current.value;
              const selectionStart =
                textAreaRef.current.selectionStart || 0;
              const selectionEnd = textAreaRef.current.selectionEnd || 0;

              const newValue =
                currentValue.substring(
                  0,
                  selectionStart - largeTextContent.length
                ) + currentValue.substring(selectionEnd);

              textAreaRef.current.value = newValue;
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

        // Upload files to server immediately if enable_upload is true
        if (filesToUpload.length > 0) {
          if (enable_upload && userId && sessionId !== undefined) {
            // Upload all files
            setIsUploading(true);
            Promise.all(
              filesToUpload.map(async (file) => {
                const fileUid = uploadFiles.find(
                  (uf) => uf.name === file.name
                )?.uid;
                if (!fileUid) return;

                try {
                  const result = await fileAPI.saveFilesToServer(userId, [file], sessionId);
                  // Store uploaded file info
                  if (result && result.length > 0) {
                    setUploadedFilesInfo((prev) => {
                      const newInfo = [...prev, ...result];
                      return newInfo;
                    });
                  }
                  // Update file status to done after successful upload
                  // Also store the uploaded file info in the file's response field for easier matching
                  setFileList((prev) =>
                    prev.map((f) =>
                      f.uid === fileUid
                        ? {
                          ...f,
                          status: "done" as const,
                          response: result && result.length > 0 ? result[0] : undefined
                        }
                        : f
                    )
                  );
                } catch (error) {
                  // Update file status to error
                  setFileList((prev) =>
                    prev.map((f) =>
                      f.uid === fileUid ? { ...f, status: "error" as const } : f
                    )
                  );
                  const errorMessage =
                    error instanceof Error ? error.message : "文件上传失败";
                  message.error(`${file.name}: ${errorMessage}`);
                }
              })
            ).finally(() => {
              setIsUploading(false);
            });

            const fileCount = filesToUpload.length;
            const fileType = fileCount === 1 ? "file" : "files";
            message.success(
              `${fileCount} ${fileType} pasted and uploading...`
            );
          } else {
            // If upload is disabled or missing credentials, just mark as done
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

            const fileCount = filesToUpload.length;
            const fileType = fileCount === 1 ? "file" : "files";
            message.success(
              `${fileCount} ${fileType} pasted and will be sent with your message`
            );
          }
        }
      }
    }
  };

  /**
   * Remove file from list
   */
  const removeFile = (uid: string) => {
    const fileToRemove = fileList.find((item) => item.uid === uid);
    setFileList(fileList.filter((item) => item.uid !== uid));
    // Also remove from uploadedFilesInfo if it exists
    if (fileToRemove) {
      setUploadedFilesInfo((prev) =>
        prev.filter((info) => info.name !== fileToRemove.name)
      );
    }
  };

  /**
   * Clear all files
   */
  const clearFiles = () => {
    setFileList([]);
    setUploadedFilesInfo([]);
  };

  return {
    fileList,
    setFileList,
    isUploading,
    notificationContextHolder,
    handleFileValidationAndAdd,
    handlePaste,
    removeFile,
    clearFiles,
    uploadedFilesInfo,
  };
};

