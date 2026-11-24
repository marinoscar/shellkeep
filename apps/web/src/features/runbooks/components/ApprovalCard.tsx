/**
 * One approval of the inbox (issue #65, Subtask F): its kind, the run, server and step, the
 * (engine-redacted) message or plan in monospace, who asked and when it expires. Approve and
 * Reject (with an optional comment) show only with `runbooks:approve`; the person who started
 * the run cannot decide unless the organization allows self-approval, and the disabled buttons
 * say why. The API enforces both.
 */
import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardActions, CardContent, Chip, Link, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import type { RunbookApproval } from '../api/types';
import { formatCountdown } from '../lib/format';
import { StatusChip } from './StatusChip';

export const APPROVAL_KIND_LABELS: Record<string, string> = {
  gate: 'Approval gate',
  ai_command: 'AI command',
  ai_plan: 'AI plan',
  destructive_run: 'Destructive run',
};

export const SELF_APPROVAL_REASON = 'You started this run. Your organization requires someone else to approve it.';

export interface ApprovalCardProps {
  approval: RunbookApproval;
  canApprove: boolean;
  isSelf: boolean;
  allowSelfApproval: boolean;
  onDecide: (approval: RunbookApproval, decision: 'approve' | 'reject', comment: string) => Promise<void>;
}

export function ApprovalCard({ approval, canApprove, isSelf, allowSelfApproval, onDecide }: ApprovalCardProps) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const pending = approval.status === 'pending';

  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pending]);

  const blockedSelf = isSelf && !allowSelfApproval;
  const decide = async (decision: 'approve' | 'reject') => {
    setBusy(decision);
    setError(null);
    try {
      await onDecide(approval, decision, comment.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The decision failed');
    } finally {
      setBusy(null);
    }
  };

  const headingId = `approval-${approval.id}`;
  const button = (decision: 'approve' | 'reject') => {
    const control = (
      <span>
        <Button
          variant={decision === 'approve' ? 'contained' : 'outlined'}
          color={decision === 'approve' ? 'primary' : 'error'}
          disabled={blockedSelf || busy !== null}
          onClick={() => void decide(decision)}
        >
          {decision === 'approve' ? 'Approve' : 'Reject'}
        </Button>
      </span>
    );
    return blockedSelf ? (
      <Tooltip key={decision} title={SELF_APPROVAL_REASON}>
        {control}
      </Tooltip>
    ) : (
      <Box key={decision} component="span">
        {control}
      </Box>
    );
  };

  return (
    <Card variant="outlined" component="article" aria-labelledby={headingId}>
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1, mb: 1 }}>
          <Chip size="small" color={approval.kind === 'destructive_run' ? 'error' : 'default'} label={APPROVAL_KIND_LABELS[approval.kind] ?? approval.kind} />
          <StatusChip status={approval.status} />
          {pending && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Expires {formatCountdown(approval.expiresAt, now)}
            </Typography>
          )}
        </Stack>
        <Typography id={headingId} variant="subtitle1" component="h2" sx={{ overflowWrap: 'anywhere' }}>
          {approval.runbookName ?? 'Runbook'} v{approval.runbookVersion} · {approval.stepName}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
          <Link component={RouterLink} to={`/runs/${approval.runId}`}>
            Open the run
          </Link>
          {' · '}
          {approval.targetName ? `Server ${approval.targetName}` : 'Whole run'}
          {' · '}Step {approval.stepIndex >= 0 ? approval.stepIndex + 1 : 'canary'}
          {' · '}Requested by {isSelf ? 'you' : approval.initiatedByName ?? 'another user'}
        </Typography>
        {approval.message && (
          <Box
            component="pre"
            sx={{
              fontFamily: 'monospace',
              fontSize: 13,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              m: 0,
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              maxHeight: 240,
              overflow: 'auto',
            }}
          >
            {approval.message}
          </Box>
        )}
        {approval.comment && (
          <Typography variant="body2" sx={{ mt: 1 }}>
            Comment: {approval.comment}
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </CardContent>
      {pending && canApprove && (
        <CardActions sx={{ px: 2, pb: 2, flexWrap: 'wrap', gap: 1, alignItems: 'flex-start' }}>
          <TextField
            size="small"
            label="Comment (optional)"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 1000 } }}
            disabled={blockedSelf}
            sx={{ flex: '1 1 220px', minWidth: 0 }}
          />
          {button('approve')}
          {button('reject')}
        </CardActions>
      )}
    </Card>
  );
}
