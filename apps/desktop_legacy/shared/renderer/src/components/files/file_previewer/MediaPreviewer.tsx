import { Film, Music } from "lucide-react";
import { toFileUrl, type PreviewerProps } from "./types";

export function MediaPreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  const isVideo = preview.mime.startsWith("video/");
  const Icon = isVideo ? Film : Music;
  const src = toFileUrl(preview.path);
  return (
    <div className="files-preview-media">
      <div className="files-preview-subtoolbar">
        <span>
          <Icon size={13} />
          {isVideo ? "Video" : "Audio"}
        </span>
      </div>
      {isVideo ? (
        <video controls preload="metadata" src={src} />
      ) : (
        <audio controls preload="metadata" src={src} />
      )}
    </div>
  );
}
