import React from "react";

const SPINNER_STYLE: React.CSSProperties = {
  width: 32,
  height: 32,
  border: "4px solid #3b82f6",
  borderTopColor: "transparent",
  borderRadius: "50%",
  animation: "drsai-boot-spin 0.7s linear infinite",
};

const ROOT_STYLE: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--drsai-boot-bg, #f8f8fb)",
  color: "var(--drsai-boot-fg, #64748b)",
};

const INNER_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 12,
};

const TEXT_STYLE: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontFamily: 'ui-sans-serif, system-ui, "Segoe UI", sans-serif',
};

export function BootSplash({
  message = "正在加载",
}: {
  message?: string;
}) {
  return (
    <div role="status" aria-live="polite" aria-label={message} style={ROOT_STYLE}>
      <div style={INNER_STYLE}>
        <span style={SPINNER_STYLE} />
        <p style={TEXT_STYLE}>{message}</p>
      </div>
    </div>
  );
}
