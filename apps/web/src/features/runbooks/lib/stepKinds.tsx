/** How each step kind is shown (issue #65): its icon, its label and a one-line hint. */
import type { ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material';
import TerminalIcon from '@mui/icons-material/Terminal';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import UploadFileOutlinedIcon from '@mui/icons-material/UploadFileOutlined';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import AutoAwesomeOutlinedIcon from '@mui/icons-material/AutoAwesomeOutlined';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import type { RunbookStepKind } from '../api/types';

export interface StepKindMeta {
  label: string;
  hint: string;
  Icon: ComponentType<SvgIconProps>;
}

export const STEP_KIND_META: Record<RunbookStepKind, StepKindMeta> = {
  command: { label: 'Command', hint: 'Run one shell command', Icon: TerminalIcon },
  script: { label: 'Script', hint: 'Run a bash, sh or python3 script', Icon: DescriptionOutlinedIcon },
  package_update: { label: 'Package update', hint: 'Update packages with the server’s package manager', Icon: SystemUpdateAltIcon },
  file_upload: { label: 'File upload', hint: 'Copy an uploaded file to the server', Icon: UploadFileOutlinedIcon },
  collect_logs: { label: 'Collect logs', hint: 'Gather log files and journal units', Icon: ArticleOutlinedIcon },
  ai_task: { label: 'AI task', hint: 'Let the AI agent work toward a goal', Icon: AutoAwesomeOutlinedIcon },
  approval_gate: { label: 'Approval gate', hint: 'Wait for a person to approve', Icon: HowToRegOutlinedIcon },
};

export function stepKindMeta(kind: string): StepKindMeta {
  return STEP_KIND_META[kind as RunbookStepKind] ?? { label: kind, hint: '', Icon: TerminalIcon };
}
