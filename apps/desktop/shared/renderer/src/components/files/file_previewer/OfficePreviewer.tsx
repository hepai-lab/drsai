import { FileType2 } from "lucide-react";
import { MetadataPreviewer } from "./MetadataPreviewer";
import type { PreviewerProps } from "./types";

export function OfficePreviewer(props: PreviewerProps): React.JSX.Element {
  const { preview } = props;
  const slideImages = preview.slideImages ?? [];
  if (!preview.content && slideImages.length === 0) return <MetadataPreviewer {...props} />;
  return (
    <div className="files-preview-office">
      <div className="files-preview-subtoolbar">
        <span>
          <FileType2 size={13} />
          {slideImages.length > 0 ? "Presentation" : "Office text"}
        </span>
        {preview.message ? <span>{preview.message}</span> : null}
      </div>
      {slideImages.length > 0 ? (
        <div className="files-preview-slides" data-testid="office-slide-previews">
          {slideImages.map((slide) => (
            <figure key={slide.label} className="files-preview-slide">
              <img src={slide.dataUrl} alt={slide.label} />
              <figcaption>{slide.label}</figcaption>
            </figure>
          ))}
        </div>
      ) : null}
      {preview.content ? <pre className="files-preview-code">{preview.content}</pre> : null}
    </div>
  );
}
