/**
 * One runbook (issue #65) at `/runbooks/:id`: what it does (steps, parameters, default targets,
 * strategy), who owns it (#71 owner chip), and the actions the viewer has: Run, Edit, Share
 * (`ShareResourceDialog`, the runbook roles of #71), the version history and its recent runs.
 *
 * `/runbooks/:id/run` renders this page with the launcher open (`RunLauncherPage`).
 */
import { useState } from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Link,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import ShareOutlinedIcon from '@mui/icons-material/ShareOutlined';
import HistoryIcon from '@mui/icons-material/History';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';
import { ShareResourceDialog } from '../../components/common/ShareResourceDialog';
import { relativeTime } from '../../components/home/relativeTime';
import { getRunbook, listRuns } from '../../features/runbooks/api/runbooksApi';
import { useAsync } from '../../features/runbooks/hooks/useAsync';
import { stepKindMeta } from '../../features/runbooks/lib/stepKinds';
import { OwnerChip } from '../../features/runbooks/components/OwnerChip';
import { StatusChip } from '../../features/runbooks/components/StatusChip';
import { RunLauncherDialog } from '../../features/runbooks/components/RunLauncherDialog';
import { VersionHistoryDrawer } from '../../features/runbooks/components/VersionHistoryDrawer';

export interface RunbookDetailPageProps {
  /** Open the launcher on arrival (the `/runbooks/:id/run` deep link). */
  launch?: boolean;
  /** Servers the launcher pre-selects. */
  launchServerIds?: readonly string[];
}

export default function RunbookDetailPage({ launch = false, launchServerIds }: RunbookDetailPageProps) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const runbook = useAsync(() => getRunbook(id), [id]);
  const runs = useAsync(() => listRuns({ runbookId: id, pageSize: 5 }), [id]);
  const [launcherOpen, setLauncherOpen] = useState(launch);
  const [shareOpen, setShareOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  if (runbook.loading && !runbook.data) return <LinearProgress aria-label="Loading the runbook" />;
  if (!runbook.data) {
    return (
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Alert severity="error">{runbook.error ?? 'Runbook not found'}</Alert>
      </Box>
    );
  }
  const rb = runbook.data;
  const definition = rb.latestVersion?.definition;
  const canRun = hasPermission('runbooks:run') && rb.access.can.run && !rb.archivedAt && Boolean(definition);
  const canEdit = hasPermission('runbooks:write') && rb.access.can.write && !rb.archivedAt;
  const canShare = hasPermission('sharing:write') && rb.access.can.share;
  const targets = definition?.defaultTargets;

  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1200, mx: 'auto', minWidth: 0 }}>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link component={RouterLink} to="/runbooks" underline="hover">
          Runbooks
        </Link>
        <Typography color="text.primary">{rb.name}</Typography>
      </Breadcrumbs>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h4" component="h1" sx={{ overflowWrap: 'anywhere' }}>
              {rb.name}
            </Typography>
            {rb.latestVersion && <Chip size="small" label={`v${rb.latestVersion.version}`} />}
            {rb.archivedAt && <Chip size="small" label="Archived" />}
            <OwnerChip owner={rb.owner} access={rb.access} />
          </Box>
          {rb.description && (
            <Typography variant="body1" sx={{ color: 'text.secondary', mt: 1 }}>
              {rb.description}
            </Typography>
          )}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
            {rb.tags.map((tag) => (
              <Chip key={tag} size="small" variant="outlined" label={tag} />
            ))}
          </Box>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'flex-start' }}>
          {canRun && (
            <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={() => setLauncherOpen(true)}>
              Run
            </Button>
          )}
          {canEdit && (
            <Button variant="outlined" startIcon={<EditOutlinedIcon />} component={RouterLink} to={`/runbooks/${rb.id}/edit`}>
              Edit
            </Button>
          )}
          {canShare && (
            <Button variant="outlined" startIcon={<ShareOutlinedIcon />} onClick={() => setShareOpen(true)}>
              Share
            </Button>
          )}
          <Button startIcon={<HistoryIcon />} onClick={() => setHistoryOpen(true)}>
            History
          </Button>
        </Stack>
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '2fr 1fr' }, minWidth: 0 }}>
        <Card variant="outlined" component="section" aria-labelledby="rb-steps">
          <CardContent>
            <Typography id="rb-steps" variant="h6" component="h2">
              Steps
            </Typography>
            <List dense>
              {(definition?.steps ?? []).map((step, index) => {
                const meta = stepKindMeta(step.kind);
                return (
                  <ListItem key={step.id} disableGutters>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <meta.Icon fontSize="small" aria-label={meta.label} />
                    </ListItemIcon>
                    <ListItemText
                      primary={`${index + 1}. ${step.name}`}
                      secondary={`${meta.label} · runs ${step.when.replace('_', ' ')}${step.continueOnError ? ' · continues on error' : ''} · ${step.timeoutSec}s timeout`}
                    />
                  </ListItem>
                );
              })}
            </List>
          </CardContent>
        </Card>
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Card variant="outlined" component="section" aria-labelledby="rb-params">
            <CardContent>
              <Typography id="rb-params" variant="h6" component="h2">
                Parameters
              </Typography>
              {(definition?.parameters ?? []).length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  None
                </Typography>
              ) : (
                <List dense>
                  {definition!.parameters.map((p) => (
                    <ListItem key={p.name} disableGutters>
                      <ListItemText
                        primary={p.label ? `${p.label} (${p.name})` : p.name}
                        secondary={`${p.type}${p.required ? ', required' : ''}${p.type !== 'secret' && p.default !== undefined ? `, default ${String(p.default)}` : ''}`}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
          <Card variant="outlined" component="section" aria-labelledby="rb-targets">
            <CardContent>
              <Typography id="rb-targets" variant="h6" component="h2">
                Default targets
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {!targets || (targets.serverIds.length === 0 && targets.tags.any.length === 0 && targets.tags.all.length === 0)
                  ? 'None: each run picks its servers.'
                  : [
                      targets.serverIds.length ? `${targets.serverIds.length} named servers` : '',
                      targets.tags.any.length ? `any of ${targets.tags.any.join(', ')}` : '',
                      targets.tags.all.length ? `all of ${targets.tags.all.join(', ')}` : '',
                      targets.exclude.length ? `minus ${targets.exclude.length} excluded` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
              </Typography>
            </CardContent>
          </Card>
          <Card variant="outlined" component="section" aria-labelledby="rb-runs">
            <CardContent>
              <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography id="rb-runs" variant="h6" component="h2">
                  Recent runs
                </Typography>
                <Button size="small" onClick={() => navigate(`/runs?runbookId=${rb.id}`)}>
                  All
                </Button>
              </Stack>
              {(runs.data?.items ?? []).length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  No runs yet.
                </Typography>
              ) : (
                <List dense>
                  {runs.data!.items.map((run) => (
                    <ListItem key={run.id} disableGutters secondaryAction={<StatusChip status={run.status} />}>
                      <ListItemText
                        primary={
                          <Link component={RouterLink} to={`/runs/${run.id}`}>
                            v{run.version} · {relativeTime(run.createdAt)}
                          </Link>
                        }
                        secondary={`${run.targets.total} servers`}
                      />
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Box>

      {launcherOpen && (
        <RunLauncherDialog
          open
          runbookId={rb.id}
          initialServerIds={launchServerIds}
          onClose={() => {
            setLauncherOpen(false);
            if (launch) navigate(`/runbooks/${rb.id}`, { replace: true });
          }}
        />
      )}
      <ShareResourceDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        resourceType="runbook"
        resourceId={rb.id}
        title={rb.name}
        onChanged={() => void runbook.reload()}
      />
      <VersionHistoryDrawer open={historyOpen} onClose={() => setHistoryOpen(false)} runbookId={rb.id} />
    </Box>
  );
}
