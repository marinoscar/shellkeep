/**
 * The approvals inbox (issue #65, Subtask F) at `/runbooks/approvals`: pending first, one card
 * each. Notifications (#51) deep-link here; the Runbooks destination's badge counts the pending ones.
 */
import { useMemo, useState } from 'react';
import { Alert, Box, Breadcrumbs, LinearProgress, Link, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useAuth, usePermissions } from '@marinoscar/platform-web/identity/headless';
import { decideApproval, listApprovals } from '../../features/runbooks/api/runbooksApi';
import { refreshPendingApprovalCount } from '../../features/runbooks/hooks/usePendingApprovalCount';
import type { RunbookApproval } from '../../features/runbooks/api/types';
import { useAsync } from '../../features/runbooks/hooks/useAsync';
import { ApprovalCard } from '../../features/runbooks/components/ApprovalCard';

export default function ApprovalsPage() {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('runbooks:approve');
  const [view, setView] = useState<'pending' | 'all'>('pending');
  const inbox = useAsync(() => listApprovals(view, 1, 100), [view]);

  const items = useMemo(() => {
    const list = [...(inbox.data?.items ?? [])];
    // Pending first, then newest first.
    list.sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.createdAt.localeCompare(a.createdAt));
    return list;
  }, [inbox.data]);

  const onDecide = async (approval: RunbookApproval, decision: 'approve' | 'reject', comment: string) => {
    await decideApproval(approval.id, decision, comment || undefined);
    refreshPendingApprovalCount();
    await inbox.reload();
  };

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 960, mx: 'auto', minWidth: 0 }}>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/runbooks" underline="hover">
          Runbooks
        </Link>
        <Typography color="text.primary">Approvals</Typography>
      </Breadcrumbs>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 2 }}>
        <Box>
          <Typography variant="h4" component="h1">
            Approvals
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Runs waiting for a person to let them continue.
          </Typography>
        </Box>
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_e, next) => next && setView(next)} aria-label="Which approvals">
          <ToggleButton value="pending">Pending</ToggleButton>
          <ToggleButton value="all">All</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      {!canApprove && (
        <Alert severity="info" sx={{ mb: 2 }}>
          You can see these requests, but deciding them needs the runbooks approve permission.
        </Alert>
      )}
      {inbox.loading && <LinearProgress aria-label="Loading approvals" sx={{ mb: 2 }} />}
      {inbox.error && <Alert severity="error">{inbox.error}</Alert>}
      {!inbox.loading && !inbox.error && items.length === 0 && (
        <Typography variant="body2" sx={{ color: 'text.secondary', py: 4, textAlign: 'center' }}>
          {view === 'pending' ? 'Nothing is waiting for approval.' : 'No approvals yet.'}
        </Typography>
      )}
      <Stack spacing={2}>
        {items.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            canApprove={canApprove}
            isSelf={Boolean(user?.id && approval.initiatedBy === user.id)}
            allowSelfApproval={inbox.data?.allowSelfApproval ?? false}
            onDecide={onDecide}
          />
        ))}
      </Stack>
    </Box>
  );
}
