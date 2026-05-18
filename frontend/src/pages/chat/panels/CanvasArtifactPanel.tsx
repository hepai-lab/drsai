import React, { useContext, useMemo } from "react";
import { appContext } from "../../../hooks/provider";
import MarkdownRenderer from "../../../components/common/markdownrender";
import type { ParsedUiCanvasArtifact } from "./canvasArtifactTypes";

interface CanvasArtifactPanelProps {
  artifacts: ParsedUiCanvasArtifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function toneClass(tone: string | undefined, isDark: boolean): string {
  switch (tone) {
    case "success":
      return isDark ? "text-emerald-300" : "text-emerald-700";
    case "warning":
      return isDark ? "text-amber-300" : "text-amber-700";
    case "danger":
      return isDark ? "text-rose-300" : "text-rose-700";
    default:
      return isDark ? "text-primary" : "text-gray-900";
  }
}

const CanvasArtifactPanel: React.FC<CanvasArtifactPanelProps> = ({
  artifacts,
  selectedId,
  onSelect,
}) => {
  const { darkMode } = useContext(appContext);
  const isDark = darkMode === "dark";

  const selected = useMemo(() => {
    if (!artifacts.length) return null;
    const byId = artifacts.find((a) => a.id === selectedId);
    return byId ?? artifacts[artifacts.length - 1];
  }, [artifacts, selectedId]);

  if (!artifacts.length) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-secondary">
        暂无产出物。智能体可在消息中附带 ui_canvas 结构化内容，在此以仪表盘形式展示。
      </div>
    );
  }

  const doc = selected!.doc;

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {artifacts.length > 1 ? (
        <div
          className={`flex-shrink-0 border-b px-2 py-2 ${
            isDark ? "border-white/10 bg-white/[0.02]" : "border-gray-200/80 bg-gray-50/80"
          }`}
        >
          <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto">
            {artifacts.map((a) => {
              const active = a.id === selected?.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSelect(a.id)}
                  className={`max-w-[200px] truncate rounded-lg px-2.5 py-1 text-left text-xs font-medium transition-colors ${
                    active
                      ? isDark
                        ? "bg-violet-500/25 text-violet-100"
                        : "bg-violet-100 text-violet-900"
                      : isDark
                        ? "bg-white/[0.04] text-secondary hover:bg-white/[0.07]"
                        : "bg-white text-gray-600 hover:bg-gray-100"
                  }`}
                  title={a.doc.title}
                >
                  {a.doc.title}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <header className="mb-4">
          <h2 className={`text-base font-semibold leading-tight ${isDark ? "text-primary" : "text-gray-900"}`}>
            {doc.title}
          </h2>
          {doc.subtitle ? (
            <p className={`mt-1 text-xs ${isDark ? "text-secondary" : "text-gray-500"}`}>{doc.subtitle}</p>
          ) : null}
        </header>

        <div className="flex flex-col gap-6">
          {doc.sections.map((sec, i) => {
            if (sec.kind === "markdown") {
              return (
                <section key={i} className="min-w-0">
                  {sec.title ? (
                    <h3
                      className={`mb-2 text-sm font-semibold ${isDark ? "text-primary" : "text-gray-800"}`}
                    >
                      {sec.title}
                    </h3>
                  ) : null}
                  <div className={`prose prose-sm max-w-none dark:prose-invert ${isDark ? "" : ""}`}>
                    <MarkdownRenderer content={sec.body} indented={false} />
                  </div>
                </section>
              );
            }
            if (sec.kind === "stats") {
              return (
                <section key={i}>
                  {sec.title ? (
                    <h3
                      className={`mb-2 text-sm font-semibold ${isDark ? "text-primary" : "text-gray-800"}`}
                    >
                      {sec.title}
                    </h3>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {sec.items.map((it, j) => (
                      <div
                        key={j}
                        className={`rounded-lg border px-3 py-2 ${
                          isDark ? "border-white/10 bg-white/[0.03]" : "border-gray-200/90 bg-white"
                        }`}
                      >
                        <div className={`text-[11px] font-medium uppercase tracking-wide text-secondary`}>
                          {it.label}
                        </div>
                        <div className={`mt-1 text-lg font-semibold tabular-nums ${toneClass(it.tone, isDark)}`}>
                          {it.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            }
            if (sec.kind === "table") {
              return (
                <section key={i} className="min-w-0">
                  {sec.title ? (
                    <h3
                      className={`mb-2 text-sm font-semibold ${isDark ? "text-primary" : "text-gray-800"}`}
                    >
                      {sec.title}
                    </h3>
                  ) : null}
                  <div className="overflow-x-auto rounded-lg border border-border-primary/40">
                    <table className="w-full min-w-[280px] border-collapse text-left text-xs">
                      <thead>
                        <tr className={isDark ? "bg-white/[0.04]" : "bg-gray-50"}>
                          {sec.headers.map((h, hi) => (
                            <th
                              key={hi}
                              className={`border-b px-2 py-2 font-semibold ${
                                isDark ? "border-white/10 text-secondary" : "border-gray-200 text-gray-600"
                              }`}
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {sec.rows.map((row, ri) => (
                          <tr key={ri} className={isDark ? "hover:bg-white/[0.02]" : "hover:bg-gray-50/80"}>
                            {row.map((cell, ci) => (
                              <td
                                key={ci}
                                className={`border-t px-2 py-1.5 ${
                                  isDark ? "border-white/10 text-primary" : "border-gray-100 text-gray-800"
                                }`}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            }
            return null;
          })}
        </div>
      </div>
    </div>
  );
};

export default CanvasArtifactPanel;
