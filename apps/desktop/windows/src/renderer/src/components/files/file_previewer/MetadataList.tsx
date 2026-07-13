export function MetadataList({
  metadata,
}: {
  metadata?: Record<string, string | number | boolean | null>;
}): React.JSX.Element | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  return (
    <dl className="files-preview-metadata-list">
      {Object.entries(metadata).map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value === null ? "unknown" : String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
