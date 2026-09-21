import type { PreviewerProps } from "./types";

export function OutlinePreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  return (
    <div className="files-preview-outline">
      <ol>
        {(preview.outline ?? []).map((item, index) => (
          <li key={`${preview.path}-outline-${index}`}>{item}</li>
        ))}
      </ol>
    </div>
  );
}
