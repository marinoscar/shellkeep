import {
  Card,
  CardContent,
  CardActions,
  Typography,
  Chip,
  Box,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  OpenInNew as OpenIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';
import type { TerminalSession } from '../../types';

interface SessionCardProps {
  session: TerminalSession;
  onOpen: (session: TerminalSession) => void;
  onRename: (session: TerminalSession) => void;
  onTerminate: (session: TerminalSession) => void;
}

function getStatusColor(status: string): 'success' | 'warning' | 'default' {
  switch (status) {
    case 'active':
      return 'success';
    case 'detached':
      return 'warning';
    default:
      return 'default';
  }
}

function getRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return `${diffMin} min ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export function SessionCard({ session, onOpen, onRename, onTerminate }: SessionCardProps) {
  const serverInfo = `${session.serverProfile.username}@${session.serverProfile.hostname}:${session.serverProfile.port}`;
  const isTerminated = session.status === 'terminated';

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        opacity: isTerminated ? 0.7 : 1,
      }}
    >
      <CardContent sx={{ flexGrow: 1, pb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
          <Typography variant="h6" component="div" noWrap sx={{ flexGrow: 1, mr: 1 }}>
            {session.name}
          </Typography>
          <Chip
            label={session.status}
            size="small"
            color={getStatusColor(session.status)}
            variant={isTerminated ? 'outlined' : 'filled'}
          />
        </Box>

        <Typography variant="body2" color="text.secondary" noWrap>
          {serverInfo}
        </Typography>

        <Chip
          label={session.serverProfile.name}
          size="small"
          color={session.serverProfile.color === 'default' || !session.serverProfile.color ? 'primary' : session.serverProfile.color}
          variant="filled"
        />

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          Last activity: {getRelativeTime(session.lastActivityAt)}
        </Typography>
      </CardContent>

      <CardActions sx={{ justifyContent: 'flex-end', pt: 0 }}>
        {!isTerminated && (
          <>
            <Tooltip title="Open terminal">
              <IconButton size="small" color="primary" onClick={() => onOpen(session)}>
                <OpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Rename">
              <IconButton size="small" onClick={() => onRename(session)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Terminate">
              <IconButton size="small" color="error" onClick={() => onTerminate(session)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </CardActions>
    </Card>
  );
}
