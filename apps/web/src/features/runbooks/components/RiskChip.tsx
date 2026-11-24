/**
 * The destructive guard's verdict on one step or a whole runbook (#67): a chip with the level
 * AND a word (never colour alone), the reasons in a tooltip. Findings never carry command text.
 */
import { Alert, Chip, Tooltip } from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ReportGmailerrorredIcon from '@mui/icons-material/ReportGmailerrorred';
import type { RiskFinding, RunbookRisk } from '../api/types';

export function RiskChip({ finding }: { finding: RiskFinding }) {
  if (finding.risk === 'low' && !finding.destructive) return null;
  const label = finding.destructive ? 'Destructive' : finding.risk === 'high' ? 'High risk' : 'Medium risk';
  return (
    <Tooltip title={finding.reasons.join('; ') || label}>
      <Chip
        size="small"
        variant="outlined"
        color={finding.destructive || finding.risk === 'high' ? 'error' : 'warning'}
        icon={finding.destructive ? <ReportGmailerrorredIcon aria-hidden="true" /> : <WarningAmberIcon aria-hidden="true" />}
        label={label}
        aria-label={`${label}: ${finding.reasons.join('; ')}`}
        tabIndex={0}
        data-testid="risk-chip"
      />
    </Tooltip>
  );
}

/** The findings of one step. */
export const findingFor = (risk: RunbookRisk | null | undefined, stepIndex: number): RiskFinding | undefined =>
  risk?.findings.find((f) => f.stepIndex === stepIndex);

/** The runbook-level banner while any step is destructive. */
export function DestructiveBanner({ risk }: { risk: RunbookRisk | null | undefined }) {
  if (!risk?.destructive) return null;
  const steps = risk.findings.filter((f) => f.destructive).map((f) => f.stepIndex + 1);
  return (
    <Alert severity="error" icon={<ReportGmailerrorredIcon />} data-testid="destructive-banner">
      This runbook is destructive (step{steps.length === 1 ? '' : 's'} {steps.join(', ')}). Every run must be confirmed by typing its
      name and the number of servers, and may need a second person to approve it. A dry run changes nothing.
    </Alert>
  );
}
