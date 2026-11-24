import { Box, Drawer, IconButton, Tooltip, Typography } from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';
import { SessionSummaryPanel } from './SessionSummaryPanel';

export interface SessionSummaryDrawerProps {
  open: boolean;
  onClose: () => void;
  sessionId: string | null;
  sessionName?: string;
}

/** The summaries drawer opened from a session card (issue #59): the same panel the terminal's AI panel shows. */
export function SessionSummaryDrawer({ open, onClose, sessionId, sessionName }: SessionSummaryDrawerProps) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { 'aria-label': 'Session summaries', sx: { width: { xs: '100%', sm: 420 }, maxWidth: '100%' } } as object }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }} noWrap>
          Summary{sessionName ? `: ${sessionName}` : ''}
        </Typography>
        <Tooltip title="Close summaries">
          <IconButton size="small" aria-label="Close summaries" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ display: 'grid', gap: 1.5, p: 2, overflowY: 'auto', alignContent: 'start' }}>
        <SessionSummaryPanel sessionId={sessionId} sessionName={sessionName} />
      </Box>
    </Drawer>
  );
}
