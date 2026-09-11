import { toFileUrl, type PreviewerProps } from "./types";

export function MediaPreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  const isVideo = preview.mime.startsWith("video/");
  const src = toFileUrl(preview.path);
  return (
    <div className="files-preview-media">
      {isVideo ? (
        <video controls preload="metadata" src={src} />
      ) : (
        <audio controls preload="metadata" src={src} />
      )}
    </div>
  );
}
