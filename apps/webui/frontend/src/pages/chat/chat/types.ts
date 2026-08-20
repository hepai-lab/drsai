import type { RcFile } from "antd/es/upload/interface";
import type { IStatus } from "../../../components/types/app";
import type { InputRequest } from "../../../components/types/datamodel";
import type { IPlan } from "../../../components/types/plan";
import type { ServerUploadedFileInfo } from "./hooks/useFileUpload";

/** HepAI 技能 ZIP（与 SkillsSquarePage / fileAPI.listHepaiFiles 一致） */
export type HepaiSkillPickRow = { id: string; filename: string; url: string };

export const SKILL_INSTALL_DEFAULT_LINE = "帮我安装这些Skills";

export type UploadedFilePayload = {
  name: string;
  type: string;
  path: string;
  suffix: string;
  size: number;
  uuid: string;
  url?: string;
};

export interface ChatInputProps {
  onSubmit: (
    text: string,
    files: RcFile[] | UploadedFilePayload[],
    accepted?: boolean,
    plan?: IPlan,
    llm?: { label: string; value: string }
  ) => void;
  error: IStatus | null;
  disabled?: boolean;
  onCancel?: () => void;
  runStatus?: string;
  inputRequest?: InputRequest;
  isPlanMessage?: boolean;
  onPause?: () => void;
  enable_upload?: boolean;
  onExecutePlan?: (plan: IPlan) => void;
  sessionId: number;
  onTextChange?: (text: string) => void;
  /** Fired when the user clears the composer via the clear button */
  onClear?: () => void;
  /** Already-uploaded files to show in the composer (e.g. chosen in 库) */
  serverFilesPrefill?: ServerUploadedFileInfo[] | null;
  /** Visible heading id for textarea aria-labelledby */
  composerLabelledBy?: string;
  /** Fallback accessible name when composerLabelledBy is not set */
  composerAriaLabel?: string;
}

export type ChatInputHandle = {
  focus: () => void;
  setValue: (value: string) => void;
};
