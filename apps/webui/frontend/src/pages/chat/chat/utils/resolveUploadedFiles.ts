import { message } from "antd";
import type { UploadFile } from "antd/es/upload/interface";
import type { UploadedFilePayload } from "../types";

type ResolveResult =
  | { ok: true; files: UploadedFilePayload[] }
  | { ok: false };

/**
 * Resolve composer fileList / uploadedFilesInfo into payloads ready for onSubmit.
 * Returns ok:false when the user should wait or fix attachments (message already shown).
 */
export function resolveUploadedFiles(params: {
  fileList: UploadFile[];
  uploadedFilesInfo: UploadedFilePayload[];
  enable_upload: boolean;
}): ResolveResult {
  const { fileList, uploadedFilesInfo, enable_upload } = params;

  const hasErrorFiles = fileList.some((f) => f.status === "error");
  if (hasErrorFiles) {
    message.warning("部分文件上传失败，请检查后重试");
  }

  const successfullyUploadedFiles = fileList.filter(
    (f) => f.status === "done" && f.originFileObj
  );

  let filesToUse: UploadedFilePayload[] = [];

  if (uploadedFilesInfo.length > 0) {
    filesToUse = uploadedFilesInfo;
  } else if (successfullyUploadedFiles.length > 0) {
    filesToUse = successfullyUploadedFiles
      .map((file) => (file.response ? file.response : undefined))
      .filter((info): info is NonNullable<typeof info> => info !== undefined);
  } else if (fileList.length > 0) {
    const filesWithResponse = fileList
      .filter((f) => f.response)
      .map((f) => f.response)
      .filter((info): info is NonNullable<typeof info> => info !== undefined);

    if (filesWithResponse.length > 0) {
      filesToUse = filesWithResponse;
    } else {
      const allFiles = fileList
        .filter((f) => f.response)
        .map((f) => f.response)
        .filter((info): info is NonNullable<typeof info> => info !== undefined);
      if (allFiles.length > 0) {
        filesToUse = allFiles;
      }
    }
  }

  if (filesToUse.length === 0 && fileList.length > 0) {
    const allPossibleFiles = fileList
      .map((f) => {
        if (f.response) return f.response;
        const matched = uploadedFilesInfo?.find((info) => info.name === f.name);
        if (matched) return matched;
        return undefined;
      })
      .filter((info): info is NonNullable<typeof info> => info !== undefined);

    if (allPossibleFiles.length > 0) {
      filesToUse = allPossibleFiles;
    }
  }

  if (filesToUse.length === 0 && fileList.length > 0) {
    const uploadingFiles = fileList.filter((f) => f.status === "uploading");
    if (uploadingFiles.length > 0) {
      message.warning("文件正在上传中，请稍候再试");
      return { ok: false };
    }
    const hasLocalAttachments = fileList.some((f) => f.originFileObj);
    if (hasLocalAttachments && enable_upload) {
      message.error(
        "未能获取已上传文件的信息，请移除附件后重新添加，或确认网络与上传服务正常"
      );
      return { ok: false };
    }
  }

  return { ok: true, files: filesToUse };
}
