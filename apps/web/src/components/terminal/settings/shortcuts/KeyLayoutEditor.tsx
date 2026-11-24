/**
 * The groups of a key layout, editable (#169): each group in order with its
 * keys as chips sized by their span, and its controls (move up and down, add
 * a key, delete). A key's chip opens a menu to move it within its group or to
 * another group, widen or narrow it, or delete it. With the chip focused,
 * Alt+Left/Right reorders it, Alt+Up/Down moves it to the group above or
 * below and Delete removes it; on a pointer device it can also be dragged onto
 * another key (it goes before it) or onto a group (it goes at the end). Every
 * edit that would break a cap is refused with a message under the group.
 */

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ArrowDownward as GroupDownIcon,
  ArrowUpward as GroupUpIcon,
  ChevronLeft as LeftIcon,
  ChevronRight as RightIcon,
  DeleteOutlined as DeleteIcon,
  SouthOutlined as ToGroupBelowIcon,
  NorthOutlined as ToGroupAboveIcon,
  WidthNormalOutlined as SpanIcon,
} from '@mui/icons-material';
import {
  GRID_COLUMNS,
  MAX_KEYS_PER_GROUP,
  entrySpan,
  type KeyLayout,
} from '../../../../lib/terminal/keys/keyModel';
import {
  deleteGroup,
  entryKindLabel,
  entryLabel,
  entryName,
  groupCapError,
  groupCells,
  moveEntryToGroup,
  moveEntryWithin,
  moveGroup,
  removeEntry,
  toggleSpan,
  type EditResult,
  type KeyPosition,
} from '../../../../lib/terminal/keys/layoutEdit';

/** The drag payload type of a key chip. */
const DRAG_TYPE = 'application/x-shellkeep-key';

/** The smallest touch target, in px. */
const TARGET = 44;

export interface KeyLayoutEditorProps {
  layout: KeyLayout;
  onChange: (layout: KeyLayout) => void;
  /** The group's "Add key" button (0-based group index). */
  onAddKey: (group: number) => void;
  /** The "Add group" button: opens the picker for a key in a new group. */
  onAddGroup: () => void;
}

interface EditError {
  group: number;
  message: string;
}

const posKey = (p: KeyPosition) => `${p.group}:${p.index}`;

export function KeyLayoutEditor({ layout, onChange, onAddKey, onAddGroup }: KeyLayoutEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<EditError | null>(null);
  const [menu, setMenu] = useState<{ anchor: HTMLElement; at: KeyPosition } | null>(null);
  // Where focus goes after an edit: a key chip, or a group's heading.
  const [focus, setFocus] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  useEffect(() => {
    if (!focus) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-focus-id="${focus}"]`);
    el?.focus();
    setFocus(null);
  }, [focus, layout]);

  const apply = (result: EditResult, group: number, focusAfter?: string) => {
    if (!result.ok) {
      setError({ group, message: result.error });
      return;
    }
    setError(null);
    onChange(result.layout);
    if (focusAfter) setFocus(focusAfter);
    else if (result.position) setFocus(`key-${posKey(result.position)}`);
  };

  const groupCount = layout.groups.length;

  const keyActions = (at: KeyPosition) => {
    const group = layout.groups[at.group];
    const entry = group.keys[at.index];
    const last = at.group === groupCount - 1;
    return {
      left: { disabled: at.index === 0, run: () => apply(moveEntryWithin(layout, at, -1), at.group) },
      right: {
        disabled: at.index === group.keys.length - 1,
        run: () => apply(moveEntryWithin(layout, at, 1), at.group),
      },
      up: { disabled: at.group === 0, run: () => apply(moveEntryToGroup(layout, at, at.group - 1), at.group) },
      down: {
        // From the last group the key starts a new group, unless it is alone there.
        disabled: last && group.keys.length === 1,
        newGroup: last,
        run: () => apply(moveEntryToGroup(layout, at, at.group + 1), at.group),
      },
      span: {
        wide: entrySpan(entry) === 2,
        run: () => apply(toggleSpan(layout, at), at.group),
      },
      remove: {
        run: () => {
          const leftEmpty = group.keys.length === 1;
          const nextFocus = leftEmpty
            ? undefined
            : `key-${posKey({ group: at.group, index: Math.min(at.index, group.keys.length - 2) })}`;
          apply(removeEntry(layout, at), at.group, nextFocus ?? 'add-group');
        },
      },
    };
  };

  const onChipKeyDown = (event: KeyboardEvent<HTMLElement>, at: KeyPosition) => {
    const actions = keyActions(at);
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      actions.remove.run();
      return;
    }
    if (!event.altKey) return;
    const move = { ArrowLeft: actions.left, ArrowRight: actions.right, ArrowUp: actions.up, ArrowDown: actions.down }[
      event.key
    ];
    if (!move) return;
    event.preventDefault();
    if (move.disabled) {
      setError({ group: at.group, message: 'The key cannot move further.' });
      return;
    }
    move.run();
  };

  const readDrag = (event: DragEvent): KeyPosition | null => {
    const raw = event.dataTransfer.getData(DRAG_TYPE);
    const [group, index] = raw.split(':').map(Number);
    return Number.isInteger(group) && Number.isInteger(index) ? { group, index } : null;
  };

  const drop = (event: DragEvent, toGroup: number, beforeIndex?: number) => {
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const from = readDrag(event);
    if (!from) return;
    apply(moveEntryToGroup(layout, from, toGroup, beforeIndex), toGroup);
  };

  const menuActions = menu ? keyActions(menu.at) : null;
  const closeMenu = () => setMenu(null);
  const runFromMenu = (run: () => void) => {
    closeMenu();
    run();
  };

  return (
    <Box ref={rootRef} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {layout.groups.length === 0 && (
        <Typography color="text.secondary">No keys yet: add a group to start.</Typography>
      )}
      {layout.groups.map((group, g) => {
        const cells = groupCells(group);
        const full = group.keys.length >= MAX_KEYS_PER_GROUP || cells >= GRID_COLUMNS;
        const headingId = `key-group-${g}-heading`;
        return (
          <Card
            key={g}
            component="section"
            aria-labelledby={headingId}
            variant="outlined"
            data-testid={`key-group-${g + 1}`}
            onDragOver={(e: DragEvent) => {
              if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
              e.preventDefault();
              setDropTarget(`group-${g}`);
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={(e: DragEvent) => drop(e, g)}
            sx={{ borderColor: dropTarget === `group-${g}` ? 'primary.main' : undefined }}
          >
            <CardContent sx={{ '&:last-child': { pb: 2 } }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Box sx={{ flex: '1 1 140px', minWidth: 0 }}>
                  <Typography
                    id={headingId}
                    variant="subtitle1"
                    component="h3"
                    tabIndex={-1}
                    data-focus-id={`group-${g}`}
                    sx={{ outline: 'none' }}
                  >
                    Group {g + 1}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {group.keys.length} of {MAX_KEYS_PER_GROUP} keys, {cells} of {GRID_COLUMNS} cells
                  </Typography>
                </Box>
                <Tooltip title="Move group up">
                  <span>
                    <IconButton
                      aria-label={`Move group ${g + 1} up`}
                      disabled={g === 0}
                      onClick={() => apply(moveGroup(layout, g, -1), g, `group-${g - 1}`)}
                      sx={{ width: TARGET, height: TARGET }}
                    >
                      <GroupUpIcon />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Move group down">
                  <span>
                    <IconButton
                      aria-label={`Move group ${g + 1} down`}
                      disabled={g === groupCount - 1}
                      onClick={() => apply(moveGroup(layout, g, 1), g, `group-${g + 1}`)}
                      sx={{ width: TARGET, height: TARGET }}
                    >
                      <GroupDownIcon />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title="Delete group">
                  <IconButton
                    aria-label={`Delete group ${g + 1}`}
                    onClick={() => apply(deleteGroup(layout, g), g, 'add-group')}
                    sx={{ width: TARGET, height: TARGET }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
                <Button
                  startIcon={<AddIcon />}
                  aria-label={`Add key to group ${g + 1}`}
                  disabled={full}
                  onClick={() => onAddKey(g)}
                  sx={{ minHeight: TARGET }}
                >
                  Add key
                </Button>
              </Box>

              <Box
                role="list"
                aria-label={`Keys of group ${g + 1}`}
                sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
              >
                {group.keys.map((entry, i) => {
                  const at = { group: g, index: i };
                  const span = entrySpan(entry);
                  const id = `key-${posKey(at)}`;
                  return (
                    <Box role="listitem" key={i} sx={{ display: 'flex' }}>
                      <Button
                        variant={dropTarget === id ? 'contained' : 'outlined'}
                        draggable
                        data-focus-id={id}
                        data-span={span}
                        aria-label={`${entryName(entry)}, ${span === 2 ? 'wide, ' : ''}key ${i + 1} of ${group.keys.length} in group ${g + 1}`}
                        aria-description={`${entryKindLabel(entry)}. Alt plus arrow keys move it, Delete removes it.`}
                        aria-haspopup="menu"
                        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown Delete"
                        onClick={(e) => setMenu({ anchor: e.currentTarget, at })}
                        onKeyDown={(e) => onChipKeyDown(e, at)}
                        onDragStart={(e: DragEvent) => {
                          e.dataTransfer.setData(DRAG_TYPE, posKey(at));
                          e.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragOver={(e: DragEvent) => {
                          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setDropTarget(id);
                        }}
                        onDrop={(e: DragEvent) => drop(e, g, i)}
                        sx={{
                          minHeight: TARGET,
                          width: span === 2 ? TARGET * 3 + 8 : TARGET * 1.5,
                          textTransform: 'none',
                          cursor: 'grab',
                        }}
                      >
                        {entryLabel(entry)}
                      </Button>
                    </Box>
                  );
                })}
              </Box>

              {error?.group === g && (
                <Alert severity="error" role="alert" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
                  {error.message}
                </Alert>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Box>
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          data-focus-id="add-group"
          disabled={groupCapError(layout) !== null}
          onClick={onAddGroup}
          sx={{ minHeight: TARGET }}
        >
          Add group
        </Button>
        {groupCapError(layout) && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
            {groupCapError(layout)}
          </Typography>
        )}
      </Box>

      <Menu
        open={menu !== null}
        anchorEl={menu?.anchor}
        onClose={() => {
          // Focus is put back by hand: after an edit the chip may have moved.
          if (menu) setFocus(`key-${posKey(menu.at)}`);
          closeMenu();
        }}
        disableRestoreFocus
        slotProps={{
          list: {
            'aria-label': menu ? `${entryName(layout.groups[menu.at.group].keys[menu.at.index])} key` : undefined,
          },
        }}
      >
        {menuActions && [
          <MenuItem key="left" disabled={menuActions.left.disabled} onClick={() => runFromMenu(menuActions.left.run)} sx={{ minHeight: TARGET }}>
            <ListItemIcon><LeftIcon /></ListItemIcon>
            <ListItemText>Move left</ListItemText>
          </MenuItem>,
          <MenuItem key="right" disabled={menuActions.right.disabled} onClick={() => runFromMenu(menuActions.right.run)} sx={{ minHeight: TARGET }}>
            <ListItemIcon><RightIcon /></ListItemIcon>
            <ListItemText>Move right</ListItemText>
          </MenuItem>,
          <MenuItem key="up" disabled={menuActions.up.disabled} onClick={() => runFromMenu(menuActions.up.run)} sx={{ minHeight: TARGET }}>
            <ListItemIcon><ToGroupAboveIcon /></ListItemIcon>
            <ListItemText>Move to group above</ListItemText>
          </MenuItem>,
          <MenuItem key="down" disabled={menuActions.down.disabled} onClick={() => runFromMenu(menuActions.down.run)} sx={{ minHeight: TARGET }}>
            <ListItemIcon><ToGroupBelowIcon /></ListItemIcon>
            <ListItemText>{menuActions.down.newGroup ? 'Move to a new group' : 'Move to group below'}</ListItemText>
          </MenuItem>,
          <MenuItem key="span" onClick={() => runFromMenu(menuActions.span.run)} sx={{ minHeight: TARGET }}>
            <ListItemIcon><SpanIcon /></ListItemIcon>
            <ListItemText>{menuActions.span.wide ? 'Make narrow (1 cell)' : 'Make wide (2 cells)'}</ListItemText>
          </MenuItem>,
          <MenuItem key="delete" onClick={() => runFromMenu(menuActions.remove.run)} sx={{ minHeight: TARGET }}>
            <ListItemIcon><DeleteIcon /></ListItemIcon>
            <ListItemText>Delete key</ListItemText>
          </MenuItem>,
        ]}
      </Menu>
    </Box>
  );
}
