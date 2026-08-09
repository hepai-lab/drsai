import { execFile } from "child_process";
import { existsSync } from "fs";
import { join, resolve } from "path";
import { promisify } from "util";
import type {
  RegressionAttachRunRequest,
  RegressionBeginRequest,
  RegressionCaseDetail,
  RegressionEvaluation,
  RegressionSuiteCatalog,
  RegressionSuiteSummary,
  RegressionTransitionRequest,
} from "../api/regression";

const execFileAsync = promisify(execFile);

export class DesktopRegressionControl {
  constructor(
    private readonly repoRoot: string,
    private readonly dataRoot: string,
    private readonly enabled = process.env.OPENDRSAI_REGRESSION_UI === "1" || process.env.OPENDRSAI_DESKTOP_DEV === "1",
  ) {}

  isEnabled(): boolean { return this.enabled; }

  async listSuites(): Promise<{ schema_version: string; suites: RegressionSuiteSummary[] }> {
    return this.invoke(["list-suites"]);
  }

  async listCases(suiteId: string): Promise<RegressionSuiteCatalog> {
    return this.invoke(["list-cases", "--suite", safeDefinitionId(suiteId)]);
  }

  async getCase(caseId: string): Promise<RegressionCaseDetail> {
    return this.invoke(["get-case", "--case", safeDefinitionId(caseId)]);
  }

  async begin(request: RegressionBeginRequest): Promise<RegressionEvaluation> {
    return this.invoke([
      "begin", "--suite", safeDefinitionId(request.suiteId), "--case", safeDefinitionId(request.caseId),
      "--revision", String(request.caseRevision), "--definition-sha256", safeSha256(request.definitionSha256),
    ]);
  }

  async transition(request: RegressionTransitionRequest): Promise<RegressionEvaluation> {
    return this.invoke([
      "transition", "--evaluation", safeEvaluationId(request.evaluationId), "--status", request.status,
      "--updates-json", JSON.stringify(request.updates ?? {}),
    ]);
  }

  async attachRun(request: RegressionAttachRunRequest): Promise<RegressionEvaluation> {
    return this.invoke([
      "attach-run", "--evaluation", safeEvaluationId(request.evaluationId), "--thread", safeRuntimeId(request.threadId),
      "--run", safeRuntimeId(request.runId), "--input-sha256", safeSha256(request.inputSha256),
    ]);
  }

  async get(evaluationId: string): Promise<RegressionEvaluation> {
    return this.invoke(["get", "--evaluation", safeEvaluationId(evaluationId)]);
  }

  async cancel(evaluationId: string): Promise<RegressionEvaluation> {
    return this.invoke(["cancel", "--evaluation", safeEvaluationId(evaluationId)]);
  }

  async history(limit = 100): Promise<RegressionEvaluation[]> {
    const bounded = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.invoke(["history", "--limit", String(bounded)]);
  }

  private async invoke<T>(args: string[]): Promise<T> {
    if (!this.enabled) throw new Error("regression_feature_disabled");
    const regressionRoot = resolve(this.repoRoot, "eval", "regression");
    const bridge = join(regressionRoot, "control_bridge.py");
    if (!existsSync(bridge)) throw new Error("regression_control_bridge_missing");
    const workspacePython = process.platform === "win32"
      ? join(this.repoRoot, ".venv", "Scripts", "python.exe")
      : join(this.repoRoot, ".venv", "bin", "python");
    const python = existsSync(workspacePython) ? workspacePython : (process.platform === "win32" ? "python" : "python3");
    const outputRoot = join(this.dataRoot, "regression", "p4-desktop");
    const { stdout, stderr } = await execFileAsync(python, [bridge, "--output-root", outputRoot, ...args], {
      cwd: regressionRoot,
      encoding: "utf8",
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    if (stderr.trim()) {
      const parsed = parseJson(stderr);
      if (parsed?.error?.message) throw new Error(String(parsed.error.message));
    }
    const parsed = parseJson(stdout);
    if (!parsed) throw new Error("regression_control_invalid_response");
    return parsed as T;
  }
}

function parseJson(value: string): any | null {
  try { return JSON.parse(value.trim()); } catch { return null; }
}

function safeDefinitionId(value: string): string {
  if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(value)) throw new Error("regression_definition_id_invalid");
  return value;
}

function safeEvaluationId(value: string): string {
  if (!/^eval-[a-z0-9-]+$/.test(value)) throw new Error("regression_evaluation_id_invalid");
  return value;
}

function safeRuntimeId(value: string): string {
  if (!/^[A-Za-z0-9_.:-]{1,160}$/.test(value)) throw new Error("regression_runtime_id_invalid");
  return value;
}

function safeSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("regression_sha256_invalid");
  return value;
}
