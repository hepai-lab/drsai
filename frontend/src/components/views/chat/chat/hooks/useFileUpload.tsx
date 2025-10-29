import * as React from "react";
import { message, notification } from "antd";
import type { UploadFile, RcFile } from "antd/es/upload/interface";
import {
  MAX_FILE_SIZE,
  ALLOWED_FILE_TYPES,
  LARGE_TEXT_THRESHOLD,
} from "../constants/fileConfig";

interface UseFileUploadProps {
  enable_upload: boolean;
  isInputDisabled: boolean;
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
}

export const useFileUpload = ({
  enable_upload,
  isInputDisabled,
}: UseFileUploadProps): UseFileUploadReturn => {
  const [fileList, setFileList] = React.useState<UploadFile[]>([]);
  const [isUploading, setIsUploading] = React.useState(false);
  const [notificationApi, notificationContextHolder] =
    notification.useNotification();

  /**
   * Validate and add file to upload list (no upload to server, just local validation)
   */
  const handleFileValidationAndAdd = async (
    file: File
  ): Promise<boolean> => {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      message.error(`${file.name} is too large. Maximum size is 5MB.`);
      return false;
    }

    // Check file type
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      notificationApi.warning({
        message: <span className="text-sm">Unsupported File Type</span>,
        description: (
          <span className="text-sm text-secondary">
            Please upload only text (.txt), images (.jpg, .png, .gif,
            .svg), PDF (.pdf), or Word documents (.doc, .docx) files.
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

    // Add file to fileList with done status (no actual upload)
    const uploadFile: UploadFile = {
      uid: `file-${Date.now()}-${file.name}`,
      name: file.name,
      status: "done",
      size: file.size,
      type: file.type,
      originFileObj: file as RcFile,
    };

    setFileList((prev) => [...prev, uploadFile]);

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
    console.log("Paste event triggered");
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

        // Add all files to file list (no upload to server)
        if (filesToUpload.length > 0) {
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

          const fileCount = filesToUpload.length;
          const fileType = fileCount === 1 ? "file" : "files";
          message.success(
            `${fileCount} ${fileType} pasted and will be sent with your message`
          );
        }
      }
    }
  };

  /**
   * Remove file from list
   */
  const removeFile = (uid: string) => {
    setFileList(fileList.filter((item) => item.uid !== uid));
  };

  /**
   * Clear all files
   */
  const clearFiles = () => {
    setFileList([]);
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
  };
};

