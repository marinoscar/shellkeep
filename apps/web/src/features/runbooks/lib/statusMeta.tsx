/**
 * How a run, target or step status is SHOWN (issue #65): an icon AND a text label, never colour
 * alone, and a theme palette key for the colour (`success`, `error`, ...), never a hex literal.
 */
import type { ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutlined';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutlined';
import BlockIcon from '@mui/icons-material/Block';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutlined';
import TimerOffOutlinedIcon from '@mui/icons-material/TimerOffOutlined';
import HowToRegOutlinedIcon from '@mui/icons-material/HowToRegOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import SyncIcon from '@mui/icons-material/Sync';

export type StatusTone = 'success' | 'error' | 'warning' | 'info' | 'default';

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  Icon: ComponentType<SvgIconProps>;
}

const META: Record<string, StatusMeta> = {
  // Shared
  pending: { label: 'Pending', tone: 'default', Icon: HourglassEmptyIcon },
  queued: { label: 'Queued', tone: 'default', Icon: HourglassEmptyIcon },
  running: { label: 'Running', tone: 'info', Icon: PlayCircleOutlineIcon },
  succeeded: { label: 'Succeeded', tone: 'success', Icon: CheckCircleOutlineIcon },
  failed: { label: 'Failed', tone: 'error', Icon: ErrorOutlineIcon },
  skipped: { label: 'Skipped', tone: 'default', Icon: RemoveCircleOutlineIcon },
  cancelled: { label: 'Cancelled', tone: 'default', Icon: BlockIcon },
  // Run
  resolving: { label: 'Resolving', tone: 'info', Icon: SyncIcon },
  paused: { label: 'Paused', tone: 'warning', Icon: PauseCircleOutlineIcon },
  cancelling: { label: 'Cancelling', tone: 'warning', Icon: BlockIcon },
  partially_failed: { label: 'Partially failed', tone: 'warning', Icon: WarningAmberIcon },
  aborted: { label: 'Aborted', tone: 'error', Icon: BlockIcon },
  // Target
  waiting: { label: 'Waiting for approval', tone: 'warning', Icon: HowToRegOutlinedIcon },
  // Step
  waiting_approval: { label: 'Waiting for approval', tone: 'warning', Icon: HowToRegOutlinedIcon },
  timed_out: { label: 'Timed out', tone: 'error', Icon: TimerOffOutlinedIcon },
  // Approval
  approved: { label: 'Approved', tone: 'success', Icon: CheckCircleOutlineIcon },
  rejected: { label: 'Rejected', tone: 'error', Icon: ErrorOutlineIcon },
  expired: { label: 'Expired', tone: 'default', Icon: TimerOffOutlinedIcon },
};

export function statusMeta(status: string): StatusMeta {
  return META[status] ?? { label: status.replace(/_/g, ' '), tone: 'default', Icon: HourglassEmptyIcon };
}

/** The theme colour of a tone, as an `sx` colour path. */
export function toneColor(tone: StatusTone): string {
  return tone === 'default' ? 'text.secondary' : `${tone}.main`;
}
