/**
 * The file viewer as a page (issue #154): the deep link
 * `/servers/:id/files/view?path=&sessionId=&line=` (`fileViewerPath`), owned
 * by the `servers` destination. Full-bleed, like the terminal workspace: the
 * viewer fills the shell's `<main>`.
 */
import { Alert, Box, IconButton, Tooltip } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useShellMainVariant } from '@marinoscar/platform-web/shell/headless';
import { FileViewer } from '../components/files/viewer/FileViewer';
import { parseFileViewerSearch } from '../components/files/viewer/FileViewerProvider';

export default function FileViewerPage() {
  useShellMainVariant('full-bleed');
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const target = parseFileViewerSearch(id, search);

  if (!target) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">No file was given. Open a file from a terminal or the file browser.</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <FileViewer
        key={`${target.profileId}:${target.path}:${target.sessionId ?? ''}:${target.line ?? ''}`}
        profileId={target.profileId}
        path={target.path}
        sessionId={target.sessionId}
        line={target.line}
        headerActions={
          <Tooltip title="Back">
            <IconButton aria-label="Back" size="small" onClick={() => navigate(-1)}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        }
      />
    </Box>
  );
}
