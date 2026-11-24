/**
 * The target picker (issue #65): servers ticked in a `DataTable`, tags any/all, an exclude list,
 * and a live count from `POST /api/runbooks/targets/preview` (debounced), which also flags the
 * servers whose host key is not trusted yet (#60) with a link to fix them on the Servers page.
 *
 * Groups of servers (`groupIds`) are not offered: the API still answers
 * `422 RUNBOOK_TARGET_GROUPS_UNAVAILABLE` for them.
 */
import { useEffect, useMemo, useState } from 'react';
import { Alert, Autocomplete, Box, Chip, Link, Stack, TextField, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { DataTable } from '@marinoscar/platform-web/datatable/ui';
import type { DataTableColumn } from '@marinoscar/platform-web/datatable/headless';
import { getServerProfiles } from '../../../services/terminal-api';
import type { ServerProfile } from '../../../types';
import { previewTargets } from '../api/runbooksApi';
import type { TargetPreview, TargetSelector } from '../api/types';
import { errorMessage } from '../hooks/useAsync';

export type TargetValue = Pick<TargetSelector, 'serverIds' | 'exclude'> & { tags: TargetSelector['tags'] };

export const EMPTY_TARGETS: TargetValue = { serverIds: [], tags: { any: [], all: [] }, exclude: [] };

/** A selector of any shape (a definition's, a deep link's) as the picker's full value. */
export function toTargetValue(selector?: Partial<TargetSelector> | null): TargetValue {
  return {
    serverIds: [...(selector?.serverIds ?? [])],
    tags: { any: [...(selector?.tags?.any ?? [])], all: [...(selector?.tags?.all ?? [])] },
    exclude: [...(selector?.exclude ?? [])],
  };
}

export const isEmptyTargets = (value: TargetValue): boolean =>
  value.serverIds.length === 0 && value.tags.any.length === 0 && value.tags.all.length === 0;

export const PREVIEW_DEBOUNCE_MS = 300;

export interface TargetPickerProps {
  value: TargetValue;
  onChange: (value: TargetValue) => void;
  /** The resolved preview, for a summary line outside the picker. */
  onPreview?: (preview: TargetPreview | null) => void;
  /** Table height; the picker sits in dialogs and panels. */
  height?: number;
}

const columns: DataTableColumn<ServerProfile>[] = [
  { id: 'name', label: 'Name', priority: 'primary', value: (s) => s.name, sortable: true },
  { id: 'host', label: 'Host', priority: 'secondary', value: (s) => `${s.username}@${s.hostname}` },
  {
    id: 'tags',
    label: 'Tags',
    priority: 'secondary',
    value: (s) => s.tags.join(', '),
    render: (s) => (
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {s.tags.map((tag) => (
          <Chip key={tag} size="small" label={tag} />
        ))}
      </Box>
    ),
  },
  {
    id: 'hostKey',
    label: 'Host key',
    priority: 'detail',
    value: (s) => (s.fingerprint ? 'Trusted' : 'Not trusted'),
  },
];

export function TargetPicker({ value, onChange, onPreview, height = 320 }: TargetPickerProps) {
  const [servers, setServers] = useState<ServerProfile[]>([]);
  const [serversError, setServersError] = useState<string | null>(null);
  const [loadingServers, setLoadingServers] = useState(true);
  const [search, setSearch] = useState('');
  const [preview, setPreview] = useState<TargetPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingServers(true);
    getServerProfiles({ pageSize: 100, search: search || undefined })
      .then((page) => {
        if (!cancelled) {
          setServers(page?.items ?? []);
          setServersError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setServersError(errorMessage(err, 'Could not load the servers'));
      })
      .finally(() => {
        if (!cancelled) setLoadingServers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search]);

  // The live count: debounced, and the newest request wins.
  const selectorKey = JSON.stringify(value);
  useEffect(() => {
    if (isEmptyTargets(value)) {
      setPreview(null);
      setPreviewError(null);
      onPreview?.(null);
      return undefined;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewing(true);
      previewTargets(value)
        .then((result) => {
          if (cancelled) return;
          setPreview(result);
          setPreviewError(null);
          onPreview?.(result);
        })
        .catch((err) => {
          if (cancelled) return;
          setPreviewError(errorMessage(err, 'Could not resolve the targets'));
          onPreview?.(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectorKey]);

  const allTags = useMemo(() => [...new Set(servers.flatMap((s) => s.tags))].sort(), [servers]);
  const serverName = useMemo(() => new Map(servers.map((s) => [s.id, s.name])), [servers]);
  const selectedIds = useMemo(() => new Set(value.serverIds), [value.serverIds]);
  const untrusted = preview?.servers.filter((s) => !s.hostKeyTrusted) ?? [];

  return (
    <Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={allTags}
          value={value.tags.any}
          onChange={(_e, tags) => onChange({ ...value, tags: { ...value.tags, any: tags as string[] } })}
          renderInput={(params) => <TextField {...params} label="Any of these tags" />}
          sx={{ flex: 1, minWidth: 0 }}
        />
        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={allTags}
          value={value.tags.all}
          onChange={(_e, tags) => onChange({ ...value, tags: { ...value.tags, all: tags as string[] } })}
          renderInput={(params) => <TextField {...params} label="All of these tags" />}
          sx={{ flex: 1, minWidth: 0 }}
        />
      </Stack>

      {serversError && <Alert severity="error">{serversError}</Alert>}
      <Box sx={{ minWidth: 0 }}>
        <DataTable<ServerProfile>
          tableId="runbook-target-picker"
          ariaLabel="Servers"
          columns={columns}
          rows={servers}
          rowId={(s) => s.id}
          loading={loadingServers}
          height={height}
          density="compact"
          disableExport
          quickSearch={{ value: search, onChange: setSearch, placeholder: 'Search servers', ariaLabel: 'Search servers' }}
          selection={{
            selectable: true,
            selectedIds,
            onSelectionChange: (next) => onChange({ ...value, serverIds: [...next] }),
          }}
          emptyState={<Typography variant="body2">No servers match.</Typography>}
        />
      </Box>

      <Autocomplete
        multiple
        size="small"
        options={servers.map((s) => s.id)}
        getOptionLabel={(id) => serverName.get(id) ?? id}
        value={value.exclude}
        onChange={(_e, ids) => onChange({ ...value, exclude: ids })}
        renderInput={(params) => <TextField {...params} label="Exclude servers" />}
      />

      <Box aria-live="polite" data-testid="target-count">
        {isEmptyTargets(value) ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Pick servers or tags.
          </Typography>
        ) : previewError ? (
          <Alert severity="error">{previewError}</Alert>
        ) : preview ? (
          <Stack spacing={1}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {preview.servers.length} {preview.servers.length === 1 ? 'server' : 'servers'}
              {preview.capped ? ` (capped at ${preview.limit} of ${preview.total})` : ''}
              {previewing ? ' · updating…' : ''}
            </Typography>
            {preview.skipped.length > 0 && (
              <Alert severity="warning">
                {preview.skipped.length} named {preview.skipped.length === 1 ? 'server is' : 'servers are'} skipped (not found or
                not yours to run on).
              </Alert>
            )}
            {untrusted.length > 0 && (
              <Alert severity="warning">
                Host key not trusted yet, so the run will fail on:{' '}
                {untrusted.map((s, i) => (
                  <span key={s.id}>
                    {i > 0 && ', '}
                    {s.name} (
                    <Link component={RouterLink} to={`/servers?profile=${encodeURIComponent(s.id)}`}>
                      Fix
                    </Link>
                    )
                  </span>
                ))}
              </Alert>
            )}
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Resolving…
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
