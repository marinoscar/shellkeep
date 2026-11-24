/**
 * The Servers page (#79): every server profile the caller may see in the platform `DataTable`
 * (a grid on desktop and tablet, cards below `sm`), with its health, host key, owner and last
 * session; filters in the URL so Home tiles deep-link (`?health=unreachable`, `?hostKey=untrusted`);
 * row actions (connect, test, edit, share, delete), a detail drawer, and bulk actions on the
 * selection (run a runbook, test, tag, delete). Column choice, density and page size persist per
 * user through the table's `DataTablePreferencesPort` (`tableId="servers"`).
 *
 * `?new=1` opens the create dialog (onboarding #70). The API decides every action; the
 * `access.can` flags of a row only hide what would be refused.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Info as DetailsIcon,
  LocalOffer as TagIcon,
  NetworkCheck as TestIcon,
  PlayArrow as RunIcon,
  Share as ShareIcon,
  Terminal as ConnectIcon,
} from '@mui/icons-material';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import type {
  DataTableBulkAction,
  DataTableColumn,
  DataTableRowAction,
  DataTableSortState,
} from '@marinoscar/platform-web/datatable/headless';
import { usePermissions } from '@marinoscar/platform-web/identity/headless';

import type { HostKeyRefusal, ServerProfile, ServerProfileFormData, TestConnectionResult } from '../types';
import {
  createServerProfile,
  createSession,
  deleteServerProfile,
  getServerProfiles,
  getServerProfileTags,
  testServerProfile,
  updateServerProfile,
} from '../services/terminal-api';
import {
  HEALTH_VALUES,
  HOST_KEY_VALUES,
  hasServerListFilters,
  readServerListUrl,
  toServerProfilesQuery,
  writeServerListUrl,
  type ServerListUrlState,
} from '../lib/servers/serverListUrl';
import { relativeTime } from '../lib/servers/relativeTime';
import { factsSummary, hostKeyRefusalFromTest } from '../lib/terminal/host-key';
import { ServerProfileForm } from '../components/server-profiles/ServerProfileForm';
import { HostKeyDialog } from '../components/server-profiles/HostKeyDialog';
import { HostKeyStatus } from '../components/server-profiles/HostKeyStatus';
import { HEALTH_LABELS, ServerHealthStatus } from '../components/server-profiles/ServerHealthStatus';
import { ServerOwnerChip } from '../components/server-profiles/ServerOwnerChip';
import { ServerDetailDrawer } from '../components/server-profiles/ServerDetailDrawer';
import { BulkDeleteDialog, BulkTagDialog, BulkTestDialog } from '../components/server-profiles/ServerBulkDialogs';
import { RunRunbookDialog } from '../components/server-profiles/RunRunbookDialog';
import { ShareResourceDialog } from '../components/common/ShareResourceDialog';

/** The columns the API sorts by, keyed by column id. */
const SORTABLE: Record<string, 'name' | 'health' | 'lastSession'> = {
  name: 'name',
  health: 'health',
  lastSession: 'lastSession',
};

const HOST_KEY_LABELS = { trusted: 'Trusted', untrusted: 'Not trusted', mismatch: 'Mismatch' } as const;

type Bulk = 'run' | 'test' | 'tags' | 'delete' | null;

interface Notice {
  message: string;
  severity: 'success' | 'error' | 'info';
}

/** The host-key prompt a test connection opened (#60). */
interface TestPrompt {
  refusal: HostKeyRefusal;
  hostname: string;
  result: TestConnectionResult;
}

const can = (profile: ServerProfile, action: keyof NonNullable<ServerProfile['access']>['can']) =>
  profile.access ? profile.access.can[action] : true;

function ColorDot({ color }: { color: ServerProfile['color'] }) {
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        flexShrink: 0,
        bgcolor: (theme) => {
          const key = !color || color === 'default' ? 'primary' : color;
          return theme.palette[key].main;
        },
      }}
    />
  );
}

export default function ServerProfilesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('servers:write');
  const canRunRunbooks = hasPermission('runbooks:run');

  const filters = useMemo(() => readServerListUrl(searchParams), [searchParams]);
  const [paging, setPaging] = useState({ page: 0, pageSize: 20 });
  const [rows, setRows] = useState<ServerProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tagOptions, setTagOptions] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The selected profiles as last seen, so a selection survives a page change.
  const known = useRef(new Map<string, ServerProfile>());

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ServerProfile | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ServerProfile | null>(null);
  const [bulk, setBulk] = useState<Bulk>(null);
  const [bulkProfiles, setBulkProfiles] = useState<ServerProfile[]>([]);
  const [testPrompt, setTestPrompt] = useState<TestPrompt | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const setFilters = useCallback(
    (patch: Partial<ServerListUrlState>) => {
      setSearchParams((prev) => writeServerListUrl(prev, { ...readServerListUrl(prev), ...patch }), { replace: true });
      setPaging((prev) => ({ ...prev, page: 0 }));
    },
    [setSearchParams],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await getServerProfiles(
        toServerProfilesQuery(filters, { page: paging.page + 1, pageSize: paging.pageSize }),
      );
      const items = response?.items ?? [];
      for (const item of items) known.current.set(item.id, item);
      setRows(items);
      setTotal(response?.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the servers');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filters, paging]);

  const loadTags = useCallback(() => {
    getServerProfileTags()
      .then(setTagOptions)
      .catch(() => setTagOptions([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    loadTags();
  }, [loadTags]);

  const reloadAll = useCallback(() => {
    void load();
    loadTags();
  }, [load, loadTags]);

  // `?new=1` (onboarding #70): open the create dialog once, then drop the flag.
  useEffect(() => {
    if (searchParams.get('new') !== '1') return;
    if (canCreate) {
      setEditing(null);
      setFormOpen(true);
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('new');
        return next;
      },
      { replace: true },
    );
  }, [searchParams, setSearchParams, canCreate]);

  const show = (message: string, severity: Notice['severity']) => setNotice({ message, severity });

  // --- row actions -----------------------------------------------------------

  const connect = async (profile: ServerProfile) => {
    try {
      const session = await createSession({ serverProfileId: profile.id });
      navigate(`/sessions/${session.id}`);
    } catch (err) {
      show(err instanceof Error ? err.message : 'Could not open a session', 'error');
    }
  };

  const runTest = async (profile: Pick<ServerProfile, 'id' | 'hostname'>) => {
    let result: TestConnectionResult;
    try {
      result = await testServerProfile(profile.id);
    } catch (err) {
      result = { success: false, error: err instanceof Error ? err.message : 'Failed to test connection' };
    }
    void load();
    // An unknown or changed host key (#60): ask the user, then test again.
    const refusal = hostKeyRefusalFromTest(result, profile.id);
    if (refusal) {
      setTestPrompt({ refusal, hostname: profile.hostname, result });
      return;
    }
    show(result.success ? 'Connection successful' : result.error || 'Connection failed', result.success ? 'success' : 'error');
  };

  const remove = async (profile: ServerProfile) => {
    try {
      await deleteServerProfile(profile.id);
      show('Server profile deleted', 'success');
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(profile.id);
        return next;
      });
      reloadAll();
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to delete the profile', 'error');
    }
  };

  const save = async (data: ServerProfileFormData) => {
    if (editing) await updateServerProfile(editing.id, data);
    else await createServerProfile(data);
    show(editing ? 'Server profile saved' : 'Server profile created', 'success');
    reloadAll();
  };

  const rowActions: DataTableRowAction<ServerProfile>[] = [
    {
      id: 'connect',
      label: 'Connect',
      icon: <ConnectIcon />,
      onClick: (row) => void connect(row),
      disabled: (row) => !can(row, 'connect') || !hasPermission('sessions:write'),
      disabledReason: () => 'You may not open sessions on this server',
    },
    {
      id: 'test',
      label: 'Test connection',
      icon: <TestIcon />,
      onClick: (row) => void runTest(row),
      disabled: (row) => !can(row, 'test'),
      disabledReason: () => 'You may not test this server',
    },
    { id: 'details', label: 'Details', icon: <DetailsIcon />, onClick: (row) => setDetailId(row.id) },
    {
      id: 'edit',
      label: 'Edit',
      icon: <EditIcon />,
      onClick: (row) => {
        setEditing(row);
        setFormOpen(true);
      },
      disabled: (row) => !can(row, 'write'),
      disabledReason: () => 'You may not edit this server',
    },
    {
      id: 'share',
      label: 'Share',
      icon: <ShareIcon />,
      onClick: (row) => setSharing(row),
      disabled: (row) => !can(row, 'share'),
      disabledReason: () => 'Only its owner can share this server',
    },
    {
      id: 'delete',
      label: 'Delete',
      icon: <DeleteIcon />,
      destructive: true,
      onClick: (row) => void remove(row),
      disabled: (row) => !can(row, 'delete'),
      disabledReason: () => 'Only its owner can delete this server',
      confirm: {
        title: 'Delete this server profile?',
        description: (row) => `"${row.name}", its stored credentials and its shares are deleted.`,
        confirmLabel: 'Delete',
      },
    },
  ];

  // --- bulk actions ----------------------------------------------------------

  const openBulk = (kind: Exclude<Bulk, null>) => (ids: string[]) => {
    setBulkProfiles(ids.map((id) => known.current.get(id)).filter((p): p is ServerProfile => !!p));
    setBulk(kind);
  };

  const bulkActions: DataTableBulkAction[] = [
    // Hidden, not disabled, without the permission the run route enforces (#79).
    ...(canRunRunbooks ? [{ id: 'run', label: 'Run runbook on selected…', icon: <RunIcon />, onClick: openBulk('run') }] : []),
    { id: 'test', label: 'Test connection', icon: <TestIcon />, onClick: openBulk('test') },
    ...(canCreate ? [{ id: 'tags', label: 'Add or remove tag', icon: <TagIcon />, onClick: openBulk('tags') }] : []),
    ...(hasPermission('servers:delete')
      ? [{ id: 'delete', label: 'Delete', icon: <DeleteIcon />, destructive: true, onClick: openBulk('delete') }]
      : []),
  ];

  const closeBulk = () => {
    setBulk(null);
    setBulkProfiles([]);
  };

  // --- columns ---------------------------------------------------------------

  const columns: DataTableColumn<ServerProfile>[] = [
    {
      id: 'name',
      label: 'Name',
      priority: 'primary',
      sortable: true,
      hideable: false,
      minWidth: 160,
      flex: 1,
      value: (row) => row.name,
      render: (row) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
          <ColorDot color={row.color} />
          <Link
            component="button"
            type="button"
            underline="hover"
            onClick={(event) => {
              event.stopPropagation();
              setDetailId(row.id);
            }}
            sx={{ textAlign: 'left', overflowWrap: 'anywhere' }}
          >
            {row.name}
          </Link>
        </Box>
      ),
    },
    {
      id: 'host',
      label: 'Host',
      priority: 'secondary',
      minWidth: 160,
      flex: 1,
      value: (row) => `${row.hostname}:${row.port}`,
      render: (row) => (
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {row.hostname}:{row.port}
          </Typography>
          {factsSummary(row.facts).length > 0 && (
            <Typography variant="caption" component="div" data-testid="server-facts-summary" sx={{ color: 'text.secondary' }}>
              {factsSummary(row.facts).join(' · ')}
            </Typography>
          )}
        </Box>
      ),
    },
    { id: 'username', label: 'Username', priority: 'detail', value: (row) => row.username, minWidth: 100 },
    {
      id: 'tags',
      label: 'Tags',
      priority: 'secondary',
      minWidth: 140,
      value: (row) => row.tags.join(', '),
      render: (row) =>
        row.tags.length > 0 ? (
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {row.tags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                size="small"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!filters.tags.includes(tag)) setFilters({ tags: [...filters.tags, tag] });
                }}
              />
            ))}
          </Box>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            -
          </Typography>
        ),
    },
    {
      id: 'owner',
      label: 'Owner',
      priority: 'detail',
      minWidth: 120,
      value: (row) => row.owner?.name ?? '',
      render: (row) => <ServerOwnerChip profile={row} />,
    },
    {
      id: 'health',
      label: 'Health',
      priority: 'secondary',
      sortable: true,
      minWidth: 150,
      value: (row) => HEALTH_LABELS[row.health ?? 'unknown'],
      render: (row) => <ServerHealthStatus profile={row} />,
    },
    {
      id: 'hostKey',
      label: 'Host key',
      priority: 'detail',
      minWidth: 120,
      value: (row) => HOST_KEY_LABELS[row.hostKeyState ?? (row.fingerprint ? 'trusted' : 'untrusted')],
      render: (row) => <HostKeyStatus profile={row} />,
    },
    {
      id: 'lastSession',
      label: 'Last session',
      priority: 'detail',
      sortable: true,
      minWidth: 120,
      value: (row) => row.lastSessionAt ?? '',
      render: (row) => (
        <Typography variant="body2" sx={{ color: row.lastSessionAt ? 'text.primary' : 'text.secondary' }}>
          {row.lastSessionAt ? relativeTime(row.lastSessionAt) : 'Never'}
        </Typography>
      ),
    },
  ];

  const sort: DataTableSortState | null =
    filters.sort && filters.sort in SORTABLE
      ? { field: filters.sort, direction: filters.order ?? (filters.sort === 'lastSession' ? 'desc' : 'asc') }
      : null;

  // The group owners seen on the loaded rows, for the owner filter.
  const groupOwners = useMemo(() => {
    const groups = new Map<string, string>();
    for (const row of rows) if (row.owner?.kind === 'group' && row.owner.id) groups.set(row.owner.id, row.owner.name ?? 'A group');
    if (filters.owner?.startsWith('group:') && !groups.has(filters.owner.slice(6))) groups.set(filters.owner.slice(6), 'Selected group');
    return [...groups.entries()];
  }, [rows, filters.owner]);

  const detail = detailId ? (rows.find((row) => row.id === detailId) ?? known.current.get(detailId) ?? null) : null;

  const emptyState = (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography sx={{ color: 'text.secondary', mb: 2 }}>
        {hasServerListFilters(filters) ? 'No servers match these filters.' : 'No server profiles yet.'}
      </Typography>
      {hasServerListFilters(filters) ? (
        <Button onClick={() => setFilters({ q: '', tags: [], owner: null, health: null, hostKey: null })}>Clear filters</Button>
      ) : (
        canCreate && (
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setFormOpen(true)}>
            Add server
          </Button>
        )
      )}
    </Box>
  );

  return (
    <Container maxWidth="xl" sx={{ px: { xs: 1, sm: 2 } }}>
      <Box sx={{ py: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h4" component="h1">
              Servers
            </Typography>
            <Typography sx={{ color: 'text.secondary' }}>SSH server profiles you own or that are shared with you</Typography>
          </Box>
          {canCreate && (
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              Add server
            </Button>
          )}
        </Box>

        <Box
          role="group"
          aria-label="Filters"
          sx={{ display: 'grid', gap: 1.5, mb: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: '2fr 1fr 1fr 1fr' } }}
        >
          <Autocomplete
            multiple
            size="small"
            options={tagOptions}
            value={filters.tags}
            onChange={(_, next) => setFilters({ tags: next })}
            renderInput={(params) => <TextField {...params} label="Tags" placeholder={filters.tags.length ? '' : 'Every tag must match'} />}
            data-testid="filter-tags"
          />
          <FormControl size="small">
            <InputLabel id="filter-owner-label">Owner</InputLabel>
            <Select
              labelId="filter-owner-label"
              label="Owner"
              value={filters.owner ?? ''}
              onChange={(event) => setFilters({ owner: event.target.value || null })}
              data-testid="filter-owner"
            >
              <MenuItem value="">Anyone</MenuItem>
              <MenuItem value="me">Me</MenuItem>
              <MenuItem value="shared">Shared with me</MenuItem>
              {groupOwners.map(([id, name]) => (
                <MenuItem key={id} value={`group:${id}`}>
                  Group: {name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel id="filter-health-label">Health</InputLabel>
            <Select
              labelId="filter-health-label"
              label="Health"
              value={filters.health ?? ''}
              onChange={(event) => setFilters({ health: (event.target.value || null) as ServerListUrlState['health'] })}
              data-testid="filter-health"
            >
              <MenuItem value="">Any</MenuItem>
              {HEALTH_VALUES.map((value) => (
                <MenuItem key={value} value={value}>
                  {HEALTH_LABELS[value]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small">
            <InputLabel id="filter-hostkey-label">Host key</InputLabel>
            <Select
              labelId="filter-hostkey-label"
              label="Host key"
              value={filters.hostKey ?? ''}
              onChange={(event) => setFilters({ hostKey: (event.target.value || null) as ServerListUrlState['hostKey'] })}
              data-testid="filter-hostkey"
            >
              <MenuItem value="">Any</MenuItem>
              {HOST_KEY_VALUES.map((value) => (
                <MenuItem key={value} value={value}>
                  {HOST_KEY_LABELS[value]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <DataTable<ServerProfile>
          tableId="servers"
          ariaLabel="Servers"
          data-testid="servers-table"
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          loading={loading}
          emptyState={emptyState}
          quickSearch={{
            value: filters.q,
            onChange: (q) => setFilters({ q }),
            placeholder: 'Search name, host or user',
            ariaLabel: 'Search servers',
          }}
          sort={{
            sort,
            onSortChange: (next) =>
              setFilters(
                next && next.field in SORTABLE
                  ? { sort: SORTABLE[next.field], order: next.direction }
                  : { sort: null, order: null },
              ),
          }}
          pagination={{
            page: paging.page,
            pageSize: paging.pageSize,
            total,
            onPaginationChange: setPaging,
            pageSizeOptions: [10, 20, 50, 100],
          }}
          selection={{ selectedIds, onSelectionChange: setSelectedIds }}
          rowActions={rowActions}
          bulkActions={bulkActions}
          csvExport={{ filename: 'servers' }}
        />
      </Box>

      <ServerProfileForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={save}
        profile={editing}
        tagOptions={tagOptions}
        onProfileChanged={() => void load()}
      />

      <ServerDetailDrawer
        profile={detail}
        onClose={() => setDetailId(null)}
        tagOptions={tagOptions}
        onProfileChanged={(updated) => {
          known.current.set(updated.id, updated);
          setRows((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
          loadTags();
        }}
      />

      {sharing && (
        <ShareResourceDialog
          open
          onClose={() => setSharing(null)}
          resourceType="server_profile"
          resourceId={sharing.id}
          title={sharing.name}
          onChanged={() => void load()}
        />
      )}

      <HostKeyDialog
        refusal={testPrompt?.refusal ?? null}
        hostname={testPrompt?.hostname}
        trustLabel="Trust and test"
        onTrusted={(trusted) => {
          setTestPrompt(null);
          void runTest(trusted);
        }}
        onCancel={() => {
          if (testPrompt) show(testPrompt.result.error || 'Connection failed', 'error');
          setTestPrompt(null);
        }}
      />

      {canRunRunbooks && (
        <RunRunbookDialog open={bulk === 'run'} profiles={bulkProfiles} onClose={closeBulk} />
      )}
      <BulkTestDialog open={bulk === 'test'} profiles={bulkProfiles} onClose={closeBulk} onDone={() => void load()} />
      <BulkTagDialog open={bulk === 'tags'} profiles={bulkProfiles} onClose={closeBulk} onDone={reloadAll} tagOptions={tagOptions} />
      <BulkDeleteDialog
        open={bulk === 'delete'}
        profiles={bulkProfiles}
        onClose={() => {
          closeBulk();
          setSelectedIds(new Set());
        }}
        onDone={reloadAll}
      />

      <Snackbar
        open={!!notice}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {notice ? (
          <Alert onClose={() => setNotice(null)} severity={notice.severity} variant="filled" sx={{ width: '100%' }}>
            {notice.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Container>
  );
}
