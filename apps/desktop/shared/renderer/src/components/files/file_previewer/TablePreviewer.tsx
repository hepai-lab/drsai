import { useState } from "react";
import { Table2 } from "lucide-react";
import type { PreviewerProps } from "./types";

export function TablePreviewer({
  preview,
}: PreviewerProps): React.JSX.Element {
  const [page, setPage] = useState(0);
  const pageSize = 12;
  const rows = preview.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const schema = inferDatasetSchema(preview.columns ?? [], rows);
  return (
    <div className="files-preview-table">
      <div className="files-preview-subtoolbar">
        <span>
          <Table2 size={13} />
          {rows.length} rows
        </span>
        <div>
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage((next) => Math.max(0, next - 1))}
          >
            Prev
          </button>
          <small>{currentPage + 1} / {pageCount}</small>
          <button
            type="button"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage((next) => Math.min(pageCount - 1, next + 1))}
          >
            Next
          </button>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            {(preview.columns ?? []).map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageRows.map((row, rowIndex) => (
            <tr key={`${preview.path}-${rowIndex}`}>
              {row.map((cell, cellIndex) => (
                <td key={`${rowIndex}-${cellIndex}`}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <section className="files-preview-dataset-schema" aria-label="Dataset schema">
        <strong>Dataset schema</strong>
        <div>
          {schema.map((column) => (
            <span key={column.name} title={column.sample}>
              {column.name}
              <small>{column.type} · missing {column.missing}</small>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

interface DatasetColumnSchema {
  missing: number;
  name: string;
  sample: string;
  type: "boolean" | "date" | "number" | "string";
}

function inferDatasetSchema(
  columns: string[],
  rows: string[][],
): DatasetColumnSchema[] {
  return columns.map((name, columnIndex) => {
    const values = rows.map((row) => row[columnIndex]?.trim() ?? "");
    const present = values.filter(Boolean);
    return {
      missing: values.length - present.length,
      name,
      sample: present.slice(0, 4).join(", "),
      type: inferDatasetColumnType(present),
    };
  });
}

function inferDatasetColumnType(values: string[]): DatasetColumnSchema["type"] {
  if (values.length === 0) return "string";
  if (values.every((value) => /^(true|false|yes|no)$/i.test(value))) return "boolean";
  if (values.every((value) => value !== "" && Number.isFinite(Number(value)))) return "number";
  if (values.every((value) => !Number.isNaN(Date.parse(value)))) return "date";
  return "string";
}
