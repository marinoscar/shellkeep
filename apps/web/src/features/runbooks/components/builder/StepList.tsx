/**
 * The builder's ordered step list (issue #65): a card per step with its kind icon, name, `when`,
 * `continueOnError` and timeout, an error or warning marker, up/down buttons and Alt+↑/↓ on a
 * focused card to reorder (no drag-and-drop dependency), and the "Add step" menu of all 7 kinds.
 */
import { useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { STEP_KINDS, type RunbookStep, type RunbookStepKind } from '../../api/types';
import { STEP_KIND_META } from '../../lib/stepKinds';

export interface StepListProps {
  steps: readonly RunbookStep[];
  selected: number;
  onSelect: (index: number) => void;
  onMove: (index: number, delta: -1 | 1) => void;
  onRemove: (index: number) => void;
  onAdd: (kind: RunbookStepKind) => void;
  errorCount: (index: number) => number;
  warningCount: (index: number) => number;
}

const WHEN_LABEL: Record<string, string> = { on_success: 'on success', on_failure: 'on failure', always: 'always' };

export function StepList({ steps, selected, onSelect, onMove, onRemove, onAdd, errorCount, warningCount }: StepListProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const moveAndFocus = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= steps.length) return;
    onMove(index, delta);
    // Keep the moved card focused, so repeated Alt+arrows keep moving it.
    requestAnimationFrame(() => itemRefs.current[to]?.focus());
  };

  return (
    <Box>
      <List aria-label="Steps" sx={{ p: 0 }}>
        {steps.map((step, index) => {
          const meta = STEP_KIND_META[step.kind];
          const errors = errorCount(index);
          const warnings = warningCount(index);
          return (
            <ListItem
              key={`${step.id}-${index}`}
              disablePadding
              sx={{ mb: 1, border: 1, borderColor: index === selected ? 'primary.main' : 'divider', borderRadius: 1, bgcolor: 'background.paper' }}
              secondaryAction={
                <Box sx={{ display: 'flex' }}>
                  <IconButton size="small" aria-label={`Move ${step.name} up`} disabled={index === 0} onClick={() => moveAndFocus(index, -1)}>
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label={`Move ${step.name} down`} disabled={index === steps.length - 1} onClick={() => moveAndFocus(index, 1)}>
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" aria-label={`Remove ${step.name}`} disabled={steps.length === 1} onClick={() => onRemove(index)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Box>
              }
            >
              <ListItemButton
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                selected={index === selected}
                onClick={() => onSelect(index)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
                    e.preventDefault();
                    moveAndFocus(index, e.key === 'ArrowUp' ? -1 : 1);
                  }
                }}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                sx={{ pr: 15, borderRadius: 1 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>
                  {errors > 0 ? (
                    <Badge color="error" badgeContent={errors}>
                      <meta.Icon aria-label={meta.label} />
                    </Badge>
                  ) : (
                    <meta.Icon aria-label={meta.label} />
                  )}
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                      {index + 1}. {step.name}
                      {warnings > 0 && (
                        <Tooltip title={`${warnings} warning${warnings === 1 ? '' : 's'}`}>
                          <WarningAmberIcon fontSize="small" sx={{ color: 'warning.main' }} aria-label={`${warnings} warnings`} />
                        </Tooltip>
                      )}
                    </Box>
                  }
                  secondary={`${meta.label} · ${WHEN_LABEL[step.when] ?? step.when}${step.continueOnError ? ' · continues on error' : ''} · ${step.timeoutSec}s${errors ? ` · ${errors} error${errors === 1 ? '' : 's'}` : ''}`}
                  slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                />
              </ListItemButton>
            </ListItem>
          );
        })}
      </List>
      <Button
        startIcon={<AddIcon />}
        variant="outlined"
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-haspopup="menu"
        disabled={steps.length >= 50}
        fullWidth
      >
        Add step
      </Button>
      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}>
        {STEP_KINDS.map((kind) => {
          const meta = STEP_KIND_META[kind];
          return (
            <MenuItem
              key={kind}
              onClick={() => {
                setAnchor(null);
                onAdd(kind);
              }}
            >
              <ListItemIcon>
                <meta.Icon fontSize="small" />
              </ListItemIcon>
              <ListItemText primary={meta.label} secondary={meta.hint} />
            </MenuItem>
          );
        })}
      </Menu>
    </Box>
  );
}
