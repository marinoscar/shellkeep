/**
 * The file browser (issue #156, epic #151): one server's directories over the
 * files API, for the terminal workspace's Files panel (with a session) and the
 * server page's Files tab (without one, rooted at `~`).
 *
 * - Breadcrumbs, an editable path (Enter to go), Up and Refresh.
 * - With a session, "Follow terminal directory" lists `.`, which the API
 *   resolves against the session's working directory (tmux
 *   `#{pane_current_path}`); it refreshes when the window or the browser gains
 *   focus, and on demand. Navigating anywhere turns it off.
 * - Hidden files (off by default), a filter, sort by name, size or modified.
 * - A file opens in the viewer (`useOpenFile`), a folder navigates; each row's
 *   menu (the kebab, a right-click, the context-menu key or Shift+F10) offers
 *   Open, Download and Copy path.
 * - Keyboard: arrows, Home and End move between rows, Enter opens, Backspace
 *   goes up.
 * - Size badges are hints from the API's default caps (a non-admin cannot read
 *   the files settings); the viewer asks the API for the real answer.
 *
 * It reads no breakpoint: its container decides the size.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  InputAdornment,
  LinearProgress,
  Link,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ArchiveOutlined as ArchiveIcon,
  ArrowDownward as SortDescIcon,
  ArrowUpward as UpIcon,
  ArrowUpward as SortAscIcon,
  CodeOutlined as CodeIcon,
  ContentCopyOutlined as CopyIcon,
  DescriptionOutlined as TextIcon,
  DownloadOutlined as DownloadIcon,
  FilterList as FilterIcon,
  FolderOutlined as FolderIcon,
  FolderSpecialOutlined as FolderLinkIcon,
  ImageOutlined as ImageIcon,
  InsertDriveFileOutlined as FileIcon,
  LinkOffOutlined as BrokenLinkIcon,
  MoreVert as MoreIcon,
  Refresh as RefreshIcon,
  ReceiptLongOutlined as LogIcon,
  Visibility as ShowHiddenIcon,
  VisibilityOff as HideHiddenIcon,
  VisibilityOutlined as OpenIcon,
  HelpOutlineOutlined as OtherIcon,
} from '@mui/icons-material';
import { useOpenFile } from '../viewer/FileViewerProvider';
import { downloadRemoteFile, type RemoteDirEntry } from '../../../services/files-api';
import {
  breadcrumbsOf,
  DEFAULT_FILE_SORT,
  entryKind,
  fileIconKind,
  joinRemotePath,
  parentRemotePath,
  sizeBadge,
  visibleEntries,
  type FileIconKind,
  type FileSort,
  type FileSortKey,
} from '../../../lib/files/browser';
import { formatSize } from '../../../lib/files/viewer/text';
import { relativeTime } from '../../../lib/servers/relativeTime';
import { useDirectoryListing } from './useDirectoryListing';

/** Rows rendered before "Show more" (a listing holds up to 5000). */
export const FILE_BROWSER_PAGE_ROWS = 500;
/** A focus refresh while following waits at least this long after the last request (ms). */
export const FOLLOW_FOCUS_REFRESH_MS = 2000;

/** Navigate to a folder and select one entry in it ("Show in file browser"). */
export interface FileBrowserReveal {
  dir: string;
  select?: string;
  /** Changes for each new request, so the same target can be revealed twice. */
  seq: number;
}

export interface FileBrowserProps {
  profileId: string;
  /** The terminal session: relative paths resolve against its directory, and Follow is offered. */
  sessionId?: string;
  /** Where to start without a session or with Follow off. Default `~`. */
  initialPath?: string;
  /** Start following the terminal's directory (needs `sessionId`). Default true. */
  defaultFollow?: boolean;
  reveal?: FileBrowserReveal | null;
  /** An accessible name for the whole browser. */
  'aria-label'?: string;
}

const ICONS: Record<FileIconKind, typeof FileIcon> = {
  folder: FolderIcon,
  'folder-link': FolderLinkIcon,
  'link-broken': BrokenLinkIcon,
  image: ImageIcon,
  archive: ArchiveIcon,
  code: CodeIcon,
  text: TextIcon,
  log: LogIcon,
  other: OtherIcon,
  file: FileIcon,
};

const SORT_LABELS: Record<FileSortKey, string> = { name: 'Name', size: 'Size', mtime: 'Modified' };

interface MenuState {
  entry: RemoteDirEntry;
  anchorEl?: HTMLElement;
  position?: { top: number; left: number };
}

interface Notice {
  message: string;
  severity: 'success' | 'error';
}

function rowLabel(entry: RemoteDirEntry): string {
  const kind = entryKind(entry);
  const what = kind === 'dir' ? 'folder' : kind === 'other' ? 'special file' : 'file';
  const parts = [entry.name, entry.type === 'symlink' ? `link to ${what}` : what];
  if (kind !== 'dir') parts.push(formatSize(entry.size));
  const modified = relativeTime(entry.mtime);
  if (modified) parts.push(`modified ${modified}`);
  return parts.join(', ');
}

export function FileBrowser({
  profileId,
  sessionId,
  initialPath = '~',
  defaultFollow = true,
  reveal = null,
  'aria-label': ariaLabel = 'File browser',
}: FileBrowserProps) {
  const { openFile } = useOpenFile();
  const canFollow = Boolean(sessionId);
  const [follow, setFollow] = useState(() => canFollow && defaultFollow && !reveal);
  const [path, setPath] = useState(() => reveal?.dir ?? initialPath);
  const [pendingSelect, setPendingSelect] = useState<string | null>(reveal?.select ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<FileSort>(DEFAULT_FILE_SORT);
  const [limit, setLimit] = useState(FILE_BROWSER_PAGE_ROWS);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const following = follow && canFollow;
  const requestPath = following ? '.' : path;
  const { listing, loading, error, refresh, lastRequestAt } = useDirectoryListing(profileId, requestPath, sessionId);
  const currentDir = listing?.path ?? (requestPath === '.' ? '' : requestPath);
  const [pathInput, setPathInput] = useState(currentDir);
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  // The path field shows where the listing is, unless the user is typing.
  useEffect(() => {
    if (listing) setPathInput(listing.path);
  }, [listing]);

  // A new reveal after mount ("Show in file browser" again).
  const lastReveal = useRef(reveal?.seq ?? null);
  useEffect(() => {
    if (!reveal || reveal.seq === lastReveal.current) return;
    lastReveal.current = reveal.seq;
    setFollow(false);
    setPath(reveal.dir);
    setPendingSelect(reveal.select ?? null);
    setFilter('');
  }, [reveal]);

  const rows = useMemo(
    () => visibleEntries(listing?.entries ?? [], { showHidden, filter, sort }),
    [listing, showHidden, filter, sort],
  );

  // Select the revealed entry once its folder is listed (a dotfile turns hidden files on).
  useEffect(() => {
    if (!pendingSelect || !listing) return;
    const found = listing.entries.find((e) => e.name === pendingSelect);
    setPendingSelect(null);
    if (!found) return;
    if (found.name.startsWith('.')) setShowHidden(true);
    setSelected(found.name);
    setTimeout(() => rowRefs.current.get(found.name)?.scrollIntoView?.({ block: 'nearest' }), 0);
  }, [pendingSelect, listing]);

  // Follow: the terminal may have changed directory while the user was in it.
  useEffect(() => {
    if (!following) return undefined;
    const onFocus = () => {
      if (Date.now() - lastRequestAt() >= FOLLOW_FOCUS_REFRESH_MS) refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [following, refresh, lastRequestAt]);
  const onRootFocus = (event: FocusEvent<HTMLDivElement>) => {
    const from = event.relatedTarget as Node | null;
    if (!following || (from && event.currentTarget.contains(from))) return;
    if (Date.now() - lastRequestAt() >= FOLLOW_FOCUS_REFRESH_MS) refresh();
  };

  const navigate = useCallback(
    (next: string) => {
      setFollow(false);
      setPath(next);
      setSelected(null);
      setFilter('');
      setLimit(FILE_BROWSER_PAGE_ROWS);
    },
    [],
  );

  const goUp = () => {
    if (!currentDir || currentDir === '/') return;
    const from = currentDir;
    navigate(parentRemotePath(from));
    // Land on the folder we came from.
    setPendingSelect(from.slice(from.lastIndexOf('/') + 1));
  };

  const submitPath = (event: FormEvent) => {
    event.preventDefault();
    const raw = pathInput.trim();
    if (!raw) return;
    const absolute = raw.startsWith('/') || raw.startsWith('~') || !currentDir ? raw : joinRemotePath(currentDir, raw);
    navigate(absolute);
  };

  const pathOf = (entry: RemoteDirEntry) => joinRemotePath(currentDir, entry.name);

  const activate = (entry: RemoteDirEntry) => {
    setSelected(entry.name);
    if (entryKind(entry) === 'dir') navigate(pathOf(entry));
    else openFile({ profileId, path: pathOf(entry), ...(sessionId ? { sessionId } : {}) });
  };

  const download = (entry: RemoteDirEntry) => {
    void downloadRemoteFile({ profileId, path: pathOf(entry), ...(sessionId ? { sessionId } : {}) }).catch(
      (e: unknown) =>
        setNotice({
          message: `Could not download: ${e instanceof Error && e.message ? e.message : 'something went wrong'}`,
          severity: 'error',
        }),
    );
  };

  const copyPath = (entry: RemoteDirEntry) => {
    const write = navigator.clipboard?.writeText(pathOf(entry));
    if (!write) {
      setNotice({ message: 'Could not copy the path', severity: 'error' });
      return;
    }
    void write.then(
      () => setNotice({ message: 'Path copied', severity: 'success' }),
      () => setNotice({ message: 'Could not copy the path', severity: 'error' }),
    );
  };

  const shown = rows.slice(0, limit);
  const focusRow = (name: string) => {
    setSelected(name);
    rowRefs.current.get(name)?.focus();
  };

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea')) return;
    const index = shown.findIndex((e) => e.name === selected);
    const move = (to: number) => {
      const next = shown[Math.max(0, Math.min(shown.length - 1, to))];
      if (next) focusRow(next.name);
    };
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(index < 0 ? 0 : index + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(index < 0 ? 0 : index - 1);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(shown.length - 1);
        break;
      case 'Backspace':
        event.preventDefault();
        goUp();
        break;
      case 'ContextMenu':
      case 'F10': {
        if (event.key === 'F10' && !event.shiftKey) return;
        const entry = shown[index];
        const el = entry ? rowRefs.current.get(entry.name) : undefined;
        if (!entry || !el) return;
        event.preventDefault();
        setMenu({ entry, anchorEl: el });
        break;
      }
      default:
    }
  };

  // Roving tab stop: the selected row, else the first.
  const tabStop = shown.some((e) => e.name === selected) ? selected : (shown[0]?.name ?? null);
  const hiddenCount = (listing?.entries ?? []).filter((e) => e.name.startsWith('.')).length;
  const menuEntry = menu?.entry ?? null;
  const menuIsDir = menuEntry ? entryKind(menuEntry) === 'dir' : false;
  const crumbs = currentDir ? breadcrumbsOf(currentDir) : [];

  return (
    <Box
      ref={rootRef}
      role="region"
      aria-label={ariaLabel}
      data-testid="file-browser"
      onFocus={onRootFocus}
      sx={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%', minWidth: 0 }}
    >
      {/* Location: Up, the editable path, Refresh, then the breadcrumbs. */}
      <Box sx={{ display: 'grid', gap: 1, px: 1.5, pt: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Box component="form" onSubmit={submitPath} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Tooltip title="Up one folder">
            <span>
              <IconButton size="small" aria-label="Up one folder" onClick={goUp} disabled={!currentDir || currentDir === '/'}>
                <UpIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <TextField
            size="small"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder={following ? 'Terminal directory' : 'Path'}
            slotProps={{
              htmlInput: { 'aria-label': 'Path', spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off' },
            }}
            sx={{ flex: 1, minWidth: 0, '& input': { fontFamily: 'monospace', fontSize: 13 } }}
          />
          <Tooltip title="Refresh">
            <IconButton size="small" aria-label="Refresh" onClick={refresh}>
              <RefreshIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
        {crumbs.length > 0 && (
          <Breadcrumbs maxItems={5} itemsAfterCollapse={3} aria-label="Current folder" sx={{ typography: 'caption', minWidth: 0 }}>
            {crumbs.map((crumb, i) =>
              i === crumbs.length - 1 ? (
                <Typography key={crumb.path} variant="caption" sx={{ color: 'text.primary', fontWeight: 600 }} aria-current="location">
                  {crumb.label}
                </Typography>
              ) : (
                <Link
                  key={crumb.path}
                  component="button"
                  type="button"
                  variant="caption"
                  underline="hover"
                  color="inherit"
                  onClick={() => navigate(crumb.path)}
                >
                  {crumb.label}
                </Link>
              ),
            )}
          </Breadcrumbs>
        )}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter"
            slotProps={{
              htmlInput: { 'aria-label': 'Filter files' },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <FilterIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ flex: '1 1 120px', minWidth: 0 }}
          />
          <TextField
            select
            size="small"
            value={sort.key}
            onChange={(e) => setSort((s) => ({ ...s, key: e.target.value as FileSortKey }))}
            slotProps={{ select: { inputProps: { 'aria-label': 'Sort by' } } }}
            sx={{ width: 120 }}
          >
            {(Object.keys(SORT_LABELS) as FileSortKey[]).map((key) => (
              <MenuItem key={key} value={key}>
                {SORT_LABELS[key]}
              </MenuItem>
            ))}
          </TextField>
          <Tooltip title={sort.direction === 'asc' ? 'Ascending' : 'Descending'}>
            <IconButton
              size="small"
              aria-label={sort.direction === 'asc' ? 'Sort ascending' : 'Sort descending'}
              onClick={() => setSort((s) => ({ ...s, direction: s.direction === 'asc' ? 'desc' : 'asc' }))}
            >
              {sort.direction === 'asc' ? <SortAscIcon fontSize="small" /> : <SortDescIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <Tooltip title={showHidden ? 'Hide hidden files' : 'Show hidden files'}>
            <IconButton size="small" aria-label="Show hidden files" aria-pressed={showHidden} onClick={() => setShowHidden((v) => !v)}>
              {showHidden ? <ShowHiddenIcon fontSize="small" /> : <HideHiddenIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        </Box>
        {canFollow && (
          <FormControlLabel
            control={<Switch size="small" checked={following} onChange={(e) => setFollow(e.target.checked)} />}
            label={<Typography variant="caption">Follow terminal directory</Typography>}
            sx={{ ml: 0 }}
          />
        )}
      </Box>

      <Box sx={{ height: 4, flexShrink: 0 }}>{loading && <LinearProgress aria-label="Loading folder" />}</Box>

      {error && (
        <Alert
          severity="error"
          sx={{ mx: 1.5, mb: 1 }}
          data-testid="file-browser-error"
          action={
            <Button color="inherit" size="small" onClick={refresh}>
              Retry
            </Button>
          }
        >
          {error.message}
        </Alert>
      )}
      {listing?.truncated && (
        <Alert severity="info" sx={{ mx: 1.5, mb: 1 }}>
          This folder is too large to list in full; only the first entries are shown.
        </Alert>
      )}

      <Box
        role="list"
        aria-label={currentDir ? `Files in ${currentDir}` : 'Files'}
        onKeyDown={onListKeyDown}
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', pb: 1 }}
      >
        {listing && !error && rows.length === 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary', px: 2, py: 1 }}>
            {filter.trim()
              ? 'No files match the filter.'
              : hiddenCount > 0 && !showHidden
                ? `Only hidden files here (${hiddenCount}).`
                : 'This folder is empty.'}
          </Typography>
        )}
        {shown.map((entry) => {
          const Icon = ICONS[fileIconKind(entry)];
          const kind = entryKind(entry);
          const badge = kind === 'file' ? sizeBadge(entry.size) : null;
          const isSelected = entry.name === selected;
          const isTabStop = entry.name === tabStop;
          const meta = [kind === 'dir' ? null : formatSize(entry.size), relativeTime(entry.mtime) || null]
            .filter(Boolean)
            .join(' · ');
          return (
            <Box
              key={entry.name}
              role="listitem"
              sx={{
                display: 'flex',
                alignItems: 'center',
                pr: 0.5,
                bgcolor: isSelected ? 'action.selected' : undefined,
                '&:hover': { bgcolor: isSelected ? 'action.selected' : 'action.hover' },
              }}
            >
              <Box
                component="button"
                type="button"
                ref={(el: HTMLElement | null) => {
                  if (el) rowRefs.current.set(entry.name, el);
                  else rowRefs.current.delete(entry.name);
                }}
                aria-label={rowLabel(entry)}
                aria-current={isSelected ? 'true' : undefined}
                tabIndex={isTabStop ? 0 : -1}
                onClick={() => activate(entry)}
                onFocus={() => setSelected(entry.name)}
                onContextMenu={(e: MouseEvent) => {
                  e.preventDefault();
                  setSelected(entry.name);
                  setMenu({ entry, position: { top: e.clientY, left: e.clientX } });
                }}
                sx={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.25,
                  px: 1.5,
                  py: 0.75,
                  border: 0,
                  bgcolor: 'transparent',
                  color: 'text.primary',
                  font: 'inherit',
                  textAlign: 'left',
                  cursor: 'pointer',
                  '&:focus-visible': { outline: 2, outlineColor: 'primary.main', outlineStyle: 'solid', outlineOffset: -2 },
                }}
              >
                <Icon fontSize="small" sx={{ color: kind === 'dir' ? 'primary.main' : 'text.secondary', flexShrink: 0 }} />
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body2" noWrap sx={{ fontFamily: 'monospace' }} title={entry.name}>
                    {entry.name}
                    {entry.type === 'symlink' && entry.symlinkTarget ? (
                      <Box component="span" sx={{ color: 'text.secondary' }}>{` → ${entry.symlinkTarget}`}</Box>
                    ) : null}
                  </Typography>
                  {meta && (
                    <Typography variant="caption" noWrap component="div" sx={{ color: 'text.secondary' }}>
                      {meta}
                    </Typography>
                  )}
                </Box>
                {badge && (
                  <Chip
                    size="small"
                    variant="outlined"
                    color={badge === 'download-only' ? 'warning' : 'default'}
                    label={badge === 'download-only' ? 'Download only' : 'Large'}
                    sx={{ flexShrink: 0, height: 20, '& .MuiChip-label': { px: 0.75, typography: 'caption' } }}
                  />
                )}
              </Box>
              <IconButton
                size="small"
                aria-label={`More actions for ${entry.name}`}
                tabIndex={isTabStop ? 0 : -1}
                onClick={(e) => {
                  setSelected(entry.name);
                  setMenu({ entry, anchorEl: e.currentTarget });
                }}
              >
                <MoreIcon fontSize="small" />
              </IconButton>
            </Box>
          );
        })}
        {rows.length > shown.length && (
          <Box sx={{ px: 1.5, py: 1 }}>
            <Button size="small" onClick={() => setLimit((n) => n + FILE_BROWSER_PAGE_ROWS)}>
              Show more ({rows.length - shown.length} left)
            </Button>
          </Box>
        )}
      </Box>

      <Menu
        open={Boolean(menu)}
        onClose={() => setMenu(null)}
        anchorEl={menu?.anchorEl ?? null}
        anchorReference={menu?.position ? 'anchorPosition' : 'anchorEl'}
        anchorPosition={menu?.position}
        slotProps={{ list: { dense: true, 'aria-label': menuEntry ? `Actions for ${menuEntry.name}` : 'File actions' } }}
      >
        <MenuItem
          onClick={() => {
            setMenu(null);
            if (menuEntry) activate(menuEntry);
          }}
        >
          <ListItemIcon>{menuIsDir ? <FolderIcon fontSize="small" /> : <OpenIcon fontSize="small" />}</ListItemIcon>
          <ListItemText>Open</ListItemText>
        </MenuItem>
        {!menuIsDir && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              if (menuEntry) download(menuEntry);
            }}
          >
            <ListItemIcon>
              <DownloadIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Download</ListItemText>
          </MenuItem>
        )}
        {/* TODO(#158): "Download as archive" for a folder, once the archive job lands. */}
        <MenuItem
          onClick={() => {
            setMenu(null);
            if (menuEntry) copyPath(menuEntry);
          }}
        >
          <ListItemIcon>
            <CopyIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Copy path</ListItemText>
        </MenuItem>
      </Menu>
      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {notice ? (
          <Alert severity={notice.severity} onClose={() => setNotice(null)} variant="filled">
            {notice.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
}
