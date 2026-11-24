/**
 * The remote file viewer (issue #154, epic #151): opens one file on a server
 * read-only, in the mode its name calls for, within the files API's
 * guardrails.
 *
 *   - full: the whole file in CodeMirror (`FileEditor`);
 *   - paged: one window at a time (head, previous, next, tail, jump to an
 *     offset or a percentage), search within the loaded window;
 *   - image: a preview through a single-use download token (`<img>`, never
 *     inline SVG);
 *   - download card: binary files and files above the paged cap.
 *
 * Extras by mode: a sanitized Markdown preview, JSON pretty-print with the
 * parse error shown, `.env` values masked until revealed, and for logs ANSI
 * stripping, level highlighting, tail and follow.
 *
 * Reached through `openFile` (`FileViewerProvider`) or the deep link
 * `/servers/:id/files/view?path=` (`FileViewerPage`). Both load this module
 * lazily.
 */
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DownloadIcon from '@mui/icons-material/Download';
import WrapTextIcon from '@mui/icons-material/WrapText';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import DataObjectIcon from '@mui/icons-material/DataObject';
import ArticleOutlinedIcon from '@mui/icons-material/ArticleOutlined';
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayArrow';
import PauseCircleOutlineIcon from '@mui/icons-material/Pause';
import FirstPageIcon from '@mui/icons-material/FirstPage';
import LastPageIcon from '@mui/icons-material/LastPage';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined';
import CodeIcon from '@mui/icons-material/Code';
import RefreshIcon from '@mui/icons-material/Refresh';
import type { EditorView } from '@uiw/react-codemirror';
import { openSearchPanel } from '@codemirror/search';
import {
  createDownloadToken,
  downloadRemoteFile,
  downloadUrl,
  readRemoteFile,
  type RemoteFileStat,
} from '../../../services/files-api';
import { ApiError } from '../../../services/api';
import { useTerminalSettings } from '../../../hooks/useTerminalSettings';
import { ensureTerminalFont, isTerminalFontReady, TERMINAL_FONTS } from '../../../lib/terminal/appearance';
import {
  FILE_LANGUAGE_LABELS,
  fileBaseName,
  pickLanguage,
  type FileLanguage,
} from '../../../lib/files/viewer/language';
import { checkJson, formatSize, maskEnv, parseJumpTarget, stripAnsi } from '../../../lib/files/viewer/text';
import { useFileDocument, type TextDocument } from './useFileDocument';

const FileEditor = lazy(() => import('./FileEditor'));

export interface FileViewerProps {
  profileId: string;
  path: string;
  sessionId?: string;
  /** 1-based line to jump to. */
  line?: number;
  /** Extra actions at the end of the header (close, open in page). */
  headerActions?: ReactNode;
}

function ToolButton({
  label,
  onClick,
  pressed,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip title={label}>
      <span>
        <IconButton
          size="small"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          disabled={disabled}
          color={pressed ? 'primary' : 'default'}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}

/** The terminal's font (the user's `terminal` preferences), once its files are loaded. */
function useViewerFont(): { fontFamily: string; fontSize: number } {
  const { terminal } = useTerminalSettings();
  const id = terminal?.fontFamily ?? 'system';
  const [ready, setReady] = useState(() => isTerminalFontReady(id));
  useEffect(() => {
    let live = true;
    setReady(isTerminalFontReady(id));
    void ensureTerminalFont(id).then(() => {
      if (live) setReady(true);
    });
    return () => {
      live = false;
    };
  }, [id]);
  const font = ready ? (TERMINAL_FONTS[id] ?? TERMINAL_FONTS.system) : TERMINAL_FONTS.system;
  return { fontFamily: font.stack, fontSize: terminal?.fontSize ?? 14 };
}

function useDownload(profileId: string, path: string, sessionId?: string) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const download = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await downloadRemoteFile({ profileId, path, sessionId });
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : 'The download could not start.');
    } finally {
      setPending(false);
    }
  }, [profileId, path, sessionId]);
  return { download, error, pending, clearError: () => setError(null) };
}

/** The card for a file shown only as a download (binary, too large, failed preview). */
export function DownloadCard({
  stat,
  name,
  reason,
  onDownload,
  pending,
}: {
  stat: RemoteFileStat;
  name: string;
  reason: string;
  onDownload: () => void;
  pending: boolean;
}) {
  return (
    <Box sx={{ p: { xs: 2, sm: 3 }, display: 'flex', justifyContent: 'center' }}>
      <Paper variant="outlined" sx={{ p: 3, maxWidth: 480, width: '100%' }} data-testid="file-download-card">
        <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
          <InsertDriveFileOutlinedIcon color="action" fontSize="large" aria-hidden />
          <Typography variant="h6" component="p" sx={{ wordBreak: 'break-all' }}>
            {name}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {formatSize(stat.size)} · {stat.mime}
          </Typography>
          <Typography variant="body2">{reason}</Typography>
          <Button variant="contained" startIcon={<DownloadIcon />} onClick={onDownload} disabled={pending}>
            Download
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

/** An image through a single-use download token; SVG stays an `<img>`, never inlined. */
function ImagePreview({
  profileId,
  path,
  sessionId,
  name,
  onFailed,
}: {
  profileId: string;
  path: string;
  sessionId?: string;
  name: string;
  onFailed: () => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    createDownloadToken({ profileId, path, sessionId })
      .then(({ token }) => {
        if (live) setSrc(downloadUrl(token));
      })
      .catch(() => {
        if (live) onFailed();
      });
    return () => {
      live = false;
    };
  }, [profileId, path, sessionId, onFailed]);
  if (!src) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
        <CircularProgress aria-label="Loading image" />
      </Box>
    );
  }
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 2, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <Box
        component="img"
        src={src}
        alt={name}
        onError={onFailed}
        sx={{ maxWidth: '100%', height: 'auto', border: 1, borderColor: 'divider', bgcolor: 'background.default' }}
      />
    </Box>
  );
}

/** The sanitized Markdown preview; the renderer is loaded on first use. */
function MarkdownPreview({ source }: { source: string }) {
  const [html, setHtml] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void import('../../../lib/files/viewer/markdown').then(({ renderMarkdown }) => {
      if (live) setHtml(renderMarkdown(source));
    });
    return () => {
      live = false;
    };
  }, [source]);
  if (html === null) return <CircularProgress size={20} aria-label="Rendering preview" sx={{ m: 2 }} />;
  return (
    <Box
      data-testid="markdown-preview"
      sx={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        px: { xs: 2, sm: 3 },
        py: 2,
        typography: 'body1',
        wordBreak: 'break-word',
        '& pre, & code': { fontFamily: 'monospace', bgcolor: 'action.hover', borderRadius: 1 },
        '& pre': { p: 1.5, overflowX: 'auto' },
        '& code': { px: 0.5 },
        '& pre code': { px: 0 },
        '& a': { color: 'primary.main' },
        '& blockquote': { borderLeft: 4, borderColor: 'divider', m: 0, pl: 2, color: 'text.secondary' },
        '& table': { borderCollapse: 'collapse' },
        '& th, & td': { border: 1, borderColor: 'divider', px: 1, py: 0.5 },
      }}
      // Sanitized by DOMPurify in renderMarkdown (raw HTML escaped, images dropped).
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function PagedBar({
  doc,
  busy,
  onHead,
  onPrevious,
  onNext,
  onTail,
  onJump,
}: {
  doc: TextDocument;
  busy: boolean;
  onHead: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onTail: () => void;
  onJump: (offset: number) => void;
}) {
  const [jump, setJump] = useState('');
  const [jumpError, setJumpError] = useState<string | null>(null);
  const end = doc.offset + doc.length;
  const percent = doc.size > 0 ? Math.round((end / doc.size) * 100) : 100;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const offset = parseJumpTarget(jump, doc.size);
    if (offset === null) {
      setJumpError('Enter a byte offset (1048576, 512k, 3m) or a percentage (50%).');
      return;
    }
    setJumpError(null);
    onJump(offset);
  };
  return (
    <Box
      component="nav"
      aria-label="File windows"
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, px: 1, py: 0.5, borderBottom: 1, borderColor: 'divider' }}
    >
      <Typography variant="caption" color="text.secondary" aria-live="polite" sx={{ mr: 1 }}>
        Bytes {formatSize(doc.offset)} to {formatSize(end)} of {formatSize(doc.size)} ({percent}%)
      </Typography>
      <Stack direction="row" spacing={0.5}>
        <ToolButton label="First window" onClick={onHead} disabled={busy || doc.offset === 0}>
          <FirstPageIcon fontSize="small" />
        </ToolButton>
        <ToolButton label="Previous window" onClick={onPrevious} disabled={busy || doc.offset === 0}>
          <NavigateBeforeIcon fontSize="small" />
        </ToolButton>
        <ToolButton label="Next window" onClick={onNext} disabled={busy || doc.eof}>
          <NavigateNextIcon fontSize="small" />
        </ToolButton>
        <ToolButton label="Last window" onClick={onTail} disabled={busy || doc.eof}>
          <LastPageIcon fontSize="small" />
        </ToolButton>
      </Stack>
      <Box component="form" onSubmit={submit} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
        <TextField
          size="small"
          label="Jump to offset or %"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          error={jumpError !== null}
          helperText={jumpError ?? undefined}
          sx={{ width: { xs: 170, sm: 200 } }}
        />
        <Button type="submit" size="small" variant="outlined" disabled={busy || jump.trim() === ''} sx={{ mt: 0.5 }}>
          Go
        </Button>
      </Box>
      {busy && <CircularProgress size={16} aria-label="Loading window" />}
    </Box>
  );
}

export function FileViewer({ profileId, path, sessionId, line, headerActions }: FileViewerProps) {
  const name = fileBaseName(path) || path;
  const [language, setLanguage] = useState<FileLanguage>(() => pickLanguage(path));
  const isLog = language === 'log';
  const transform = isLog ? stripAnsi : undefined;
  const file = useFileDocument(
    { profileId, path, sessionId },
    { transform, startAtTail: isLog && !line },
  );
  const { state } = file;
  const { download, error: downloadError, pending: downloadPending, clearError } = useDownload(profileId, path, sessionId);
  const font = useViewerFont();

  const [wrap, setWrap] = useState(isLog);
  const [lineNumbers, setLineNumbers] = useState(true);
  const [preview, setPreview] = useState(false);
  const [pretty, setPretty] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [view, setView] = useState<EditorView | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setLanguage(pickLanguage(path));
    setImageFailed(false);
    setShowSource(false);
  }, [path]);

  // An extensionless script: a shebang picks shell.
  const firstLine = state.status === 'text' && state.doc.offset === 0 ? state.doc.text.slice(0, 200).split('\n')[0] : undefined;
  useEffect(() => {
    if (firstLine) setLanguage(pickLanguage(path, firstLine));
  }, [firstLine, path]);

  const doc = state.status === 'text' ? state.doc : null;
  const jsonCheck = useMemo(
    () => (doc && language === 'json' && doc.mode === 'full' ? checkJson(doc.text) : null),
    [doc, language],
  );
  const masked = useMemo(() => (doc && language === 'env' ? maskEnv(doc.text) : null), [doc, language]);

  const displayed = useMemo(() => {
    if (!doc) return '';
    if (masked && !revealed) return masked.text;
    if (pretty && jsonCheck?.ok) return jsonCheck.formatted;
    return doc.text;
  }, [doc, masked, revealed, pretty, jsonCheck]);

  const onImageFailed = useCallback(() => setImageFailed(true), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(displayed);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const textTools = doc !== null && !(preview && language === 'markdown');

  let body: ReactNode;
  switch (state.status) {
    case 'loading':
      body = (
        <Box sx={{ display: 'flex', justifyContent: 'center', p: 4 }}>
          <CircularProgress aria-label="Loading file" />
        </Box>
      );
      break;
    case 'error':
      body = (
        <Box sx={{ p: 2 }}>
          <Alert
            severity="error"
            action={
              <Button color="inherit" size="small" startIcon={<RefreshIcon />} onClick={file.reload}>
                Retry
              </Button>
            }
          >
            {state.message}
          </Alert>
        </Box>
      );
      break;
    case 'binary':
      body = (
        <DownloadCard
          stat={state.stat}
          name={name}
          reason="This is a binary file, so it cannot be shown as text."
          onDownload={download}
          pending={downloadPending}
        />
      );
      break;
    case 'too-large':
      body = (
        <DownloadCard
          stat={state.stat}
          name={name}
          reason="This file is too large to view in the browser. Download it instead."
          onDownload={download}
          pending={downloadPending}
        />
      );
      break;
    case 'image':
      body = imageFailed ? (
        <DownloadCard
          stat={state.stat}
          name={name}
          reason="The preview could not be shown."
          onDownload={download}
          pending={downloadPending}
        />
      ) : showSource ? (
        <SvgText profileId={profileId} path={path} sessionId={sessionId} font={font} wrap={wrap} lineNumbers={lineNumbers} />
      ) : (
        <ImagePreview profileId={profileId} path={path} sessionId={sessionId} name={name} onFailed={onImageFailed} />
      );
      break;
    case 'text':
      body = (
        <>
          {state.doc.mode === 'paged' && (
            <PagedBar
              doc={state.doc}
              busy={file.busy}
              onHead={() => void file.head()}
              onPrevious={() => void file.previous()}
              onNext={() => void file.next()}
              onTail={() => void file.tail()}
              onJump={(offset) => void file.loadAt(offset)}
            />
          )}
          {jsonCheck && !jsonCheck.ok && (
            <Alert severity="warning" sx={{ borderRadius: 0 }} data-testid="json-error">
              Invalid JSON: {jsonCheck.message}
              {jsonCheck.line !== null && ` (line ${jsonCheck.line}, column ${jsonCheck.column})`}
            </Alert>
          )}
          {masked && masked.masked > 0 && !revealed && (
            <Alert severity="info" sx={{ borderRadius: 0 }}>
              {masked.masked === 1 ? '1 value is' : `${masked.masked} values are`} hidden. Use Reveal values to show them.
            </Alert>
          )}
          {file.followError && (
            <Alert severity="warning" sx={{ borderRadius: 0 }}>
              Follow stopped: {file.followError}
            </Alert>
          )}
          {preview && language === 'markdown' ? (
            <MarkdownPreview source={state.doc.text} />
          ) : (
            <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }} data-testid="file-editor">
              <Suspense fallback={<CircularProgress size={20} aria-label="Loading editor" sx={{ m: 2 }} />}>
                <FileEditor
                  value={displayed}
                  language={language}
                  wrap={wrap}
                  lineNumbers={lineNumbers}
                  fontFamily={font.fontFamily}
                  fontSize={font.fontSize}
                  line={line}
                  scrollToEndKey={file.endKey > 0 ? file.endKey : undefined}
                  ariaLabel={`Contents of ${name}`}
                  onView={setView}
                />
              </Suspense>
            </Box>
          )}
        </>
      );
      break;
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, bgcolor: 'background.paper' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: { xs: 1, sm: 2 }, pt: 1, minWidth: 0 }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle1" component="h1" noWrap title={path} sx={{ fontWeight: 600 }}>
            {name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap component="p" title={path}>
            {state.status !== 'loading' && state.status !== 'error' ? state.stat.path : path}
          </Typography>
        </Box>
        {headerActions}
      </Box>
      <Box
        role="toolbar"
        aria-label="File viewer tools"
        sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, px: { xs: 0.5, sm: 1.5 }, py: 0.5 }}
      >
        {state.status !== 'loading' && state.status !== 'error' && (
          <Chip size="small" label={formatSize(state.stat.size)} variant="outlined" />
        )}
        {(state.status === 'text' || showSource) && (
          <Chip size="small" label={FILE_LANGUAGE_LABELS[language]} variant="outlined" />
        )}
        {doc?.mode === 'paged' && <Chip size="small" color="info" label="Paged" variant="outlined" />}
        <Box sx={{ flex: 1 }} />
        {textTools && (
          <>
            <ToolButton label="Copy" onClick={() => void copy()}>
              <ContentCopyIcon fontSize="small" />
            </ToolButton>
            <ToolButton label="Search in loaded text" onClick={() => view && openSearchPanel(view)} disabled={!view}>
              <SearchIcon fontSize="small" />
            </ToolButton>
            <ToolButton label="Wrap lines" pressed={wrap} onClick={() => setWrap((w) => !w)}>
              <WrapTextIcon fontSize="small" />
            </ToolButton>
            <ToolButton label="Line numbers" pressed={lineNumbers} onClick={() => setLineNumbers((n) => !n)}>
              <FormatListNumberedIcon fontSize="small" />
            </ToolButton>
          </>
        )}
        {doc && language === 'json' && doc.mode === 'full' && (
          <ToolButton label="Pretty-print" pressed={pretty} disabled={!jsonCheck?.ok} onClick={() => setPretty((p) => !p)}>
            <DataObjectIcon fontSize="small" />
          </ToolButton>
        )}
        {doc && language === 'markdown' && (
          <ToolButton label={preview ? 'Show source' : 'Show preview'} pressed={preview} onClick={() => setPreview((p) => !p)}>
            {preview ? <CodeIcon fontSize="small" /> : <ArticleOutlinedIcon fontSize="small" />}
          </ToolButton>
        )}
        {masked && masked.masked > 0 && (
          <ToolButton label={revealed ? 'Hide values' : 'Reveal values'} pressed={revealed} onClick={() => setRevealed((r) => !r)}>
            {revealed ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
          </ToolButton>
        )}
        {doc && isLog && (
          <>
            <ToolButton label="Tail" onClick={() => void file.tail()} disabled={file.busy}>
              <VerticalAlignBottomIcon fontSize="small" />
            </ToolButton>
            <ToolButton
              label={file.following ? 'Stop following' : 'Follow'}
              pressed={file.following}
              onClick={() => file.setFollowing(!file.following)}
            >
              {file.following ? <PauseCircleOutlineIcon fontSize="small" /> : <PlayCircleOutlineIcon fontSize="small" />}
            </ToolButton>
          </>
        )}
        {state.status === 'image' && !imageFailed && state.stat.mime === 'image/svg+xml' && (
          <ToolButton label={showSource ? 'Show image' : 'Show source'} pressed={showSource} onClick={() => setShowSource((s) => !s)}>
            <CodeIcon fontSize="small" />
          </ToolButton>
        )}
        {state.status !== 'loading' && state.status !== 'error' && (
          <ToolButton label="Download" onClick={() => void download()} disabled={downloadPending}>
            <DownloadIcon fontSize="small" />
          </ToolButton>
        )}
      </Box>
      <Divider />
      {downloadError && (
        <Alert severity="error" onClose={clearError} sx={{ borderRadius: 0 }}>
          {downloadError}
        </Alert>
      )}
      <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{body}</Box>
      <Snackbar
        open={copied}
        autoHideDuration={2000}
        onClose={() => setCopied(false)}
        message="Copied"
      />
    </Box>
  );
}

/** An SVG's markup as XML text (the image itself is never inlined). */
function SvgText({
  profileId,
  path,
  sessionId,
  font,
  wrap,
  lineNumbers,
}: {
  profileId: string;
  path: string;
  sessionId?: string;
  font: { fontFamily: string; fontSize: number };
  wrap: boolean;
  lineNumbers: boolean;
}) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    readRemoteFile({ profileId, path, sessionId }, { offset: 0 })
      .then((content) => {
        if (live) setText(content.text);
      })
      .catch((e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : 'The source could not be read.');
      });
    return () => {
      live = false;
    };
  }, [profileId, path, sessionId]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (text === null) return <CircularProgress size={20} aria-label="Loading source" sx={{ m: 2 }} />;
  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <Suspense fallback={null}>
        <FileEditor
          value={text}
          language="xml"
          wrap={wrap}
          lineNumbers={lineNumbers}
          fontFamily={font.fontFamily}
          fontSize={font.fontSize}
          ariaLabel="SVG source"
        />
      </Suspense>
    </Box>
  );
}

export default FileViewer;
