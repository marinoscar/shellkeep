/**
 * The "Add key" picker of the Keyboard shortcuts editor (#169): the key
 * catalog by section (modifiers, keys, navigation, function keys, signals,
 * actions), a custom key (a label plus a sequence with escapes, its bytes
 * shown as hex) and a macro (a label plus 1 to 8 chords). The dialog only
 * builds the entry; the editor adds it and reports a cap it would break.
 */

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import {
  GRID_COLUMNS,
  MAX_KEY_LABEL_LENGTH,
  MAX_KEYS_PER_GROUP,
  MAX_MACRO_CHORDS,
  parseSequenceEscapes,
  type Chord,
  type KeyLayout,
  type LayoutEntry,
} from '../../../../lib/terminal/keys/keyModel';
import { encodeKey } from '../../../../lib/terminal/keys/encodeKey';
import {
  CATALOG_SECTION_LABELS,
  catalogBySection,
  entryName,
  formatHexBytes,
  groupCapError,
  groupCells,
  groupFitError,
  inlineCapError,
  labelError,
  macroLabel,
  newKeyId,
} from '../../../../lib/terminal/keys/layoutEdit';
import { ChordPicker, chordError } from './ChordPicker';

type PickerTab = 'catalog' | 'custom' | 'macro';

export interface AddKeyDialogProps {
  open: boolean;
  /** The group the key joins (0-based), or `'new'` for a new group at the end. */
  target: number | 'new';
  layout: KeyLayout;
  /** Adds the entry; returns why it could not, or `null` (the dialog then closes). */
  onAdd: (entry: LayoutEntry) => string | null;
  onClose: () => void;
}

function targetText(layout: KeyLayout, target: number | 'new'): string {
  if (target === 'new') return 'Adding to a new group at the end.';
  const group = layout.groups[target];
  const free = group ? GRID_COLUMNS - groupCells(group) : 0;
  const keys = group ? MAX_KEYS_PER_GROUP - group.keys.length : 0;
  return `Adding to group ${target + 1}: room for ${keys} more ${keys === 1 ? 'key' : 'keys'}, ${free} free ${free === 1 ? 'cell' : 'cells'}.`;
}

/** Why a catalog key cannot be added at `target`, or `null`. */
function catalogFitError(layout: KeyLayout, target: number | 'new', entry: LayoutEntry): string | null {
  if (target === 'new') return groupCapError(layout);
  const group = layout.groups[target];
  return group ? groupFitError(group, entry, target + 1) : 'No such group.';
}

const EMPTY_CHORD: Chord = { modifiers: [], key: '' };

export function AddKeyDialog({ open, target, layout, onAdd, onClose }: AddKeyDialogProps) {
  const [tab, setTab] = useState<PickerTab>('catalog');
  const [error, setError] = useState<string | null>(null);
  // Custom key
  const [customLabel, setCustomLabel] = useState('');
  const [sequence, setSequence] = useState('');
  const [customTouched, setCustomTouched] = useState(false);
  // Macro
  const [macroName, setMacroName] = useState('');
  const [chords, setChords] = useState<Chord[]>([{ modifiers: ['ctrl'], key: 'b' }]);

  const reset = () => {
    setTab('catalog');
    setError(null);
    setCustomLabel('');
    setSequence('');
    setCustomTouched(false);
    setMacroName('');
    setChords([{ modifiers: ['ctrl'], key: 'b' }]);
  };

  const close = () => {
    reset();
    onClose();
  };

  const add = (entry: LayoutEntry) => {
    const why = onAdd(entry);
    if (why) setError(why);
    else close();
  };

  const inlineError = inlineCapError(layout) ?? (target === 'new' ? groupCapError(layout) : null);

  // Custom key
  const parsed = sequence === '' ? null : parseSequenceEscapes(sequence);
  const sequenceError = customTouched && sequence === '' ? 'Enter a sequence.' : parsed && !parsed.ok ? parsed.error : null;
  const customLabelError = customTouched ? labelError(customLabel) : null;
  const customValid = parsed?.ok === true && labelError(customLabel) === null;

  // Macro
  const chordsValid = chords.every((c) => chordError(c) === null);
  const macroLabelText = macroName.trim() === '' && chordsValid ? macroLabel(chords) : macroName;
  const macroLabelError = macroName === '' ? null : labelError(macroName);
  let macroBytes: string | null = null;
  if (chordsValid) {
    try {
      macroBytes = encodeKey({ kind: 'macro', id: 'preview', label: 'preview', chords });
    } catch {
      macroBytes = null;
    }
  }
  const macroValid = chordsValid && macroBytes !== null && labelError(macroLabelText) === null;

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm" aria-labelledby="add-key-title">
      <DialogTitle id="add-key-title">Add a key</DialogTitle>
      <Box sx={{ px: 3 }}>
        <Typography variant="body2" color="text.secondary">
          {targetText(layout, target)}
        </Typography>
        <Tabs
          value={tab}
          onChange={(_, next: PickerTab) => {
            setTab(next);
            setError(null);
          }}
          variant="scrollable"
          allowScrollButtonsMobile
          aria-label="Kind of key"
        >
          <Tab value="catalog" label="Catalog" sx={{ minHeight: 44 }} />
          <Tab value="custom" label="Custom key" sx={{ minHeight: 44 }} />
          <Tab value="macro" label="Macro" sx={{ minHeight: 44 }} />
        </Tabs>
      </Box>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} role="alert">
            {error}
          </Alert>
        )}

        {tab === 'catalog' && (
          <Stack spacing={2}>
            {catalogBySection().map(({ section, keys }) => (
              <Box key={section} component="section" aria-labelledby={`add-key-${section}`}>
                <Typography id={`add-key-${section}`} variant="subtitle2" component="h3" gutterBottom>
                  {CATALOG_SECTION_LABELS[section]}
                </Typography>
                {section === 'actions' && (
                  <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
                    An action shows only where it can run: the AI key with the assistant, Attach on a server
                    session, Snippets once available.
                  </Typography>
                )}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {keys.map((key) => {
                    const entry: LayoutEntry = { id: key.id };
                    const why = catalogFitError(layout, target, entry);
                    return (
                      <Button
                        key={key.id}
                        variant="outlined"
                        disabled={why !== null}
                        aria-label={`Add ${entryName(entry)}`}
                        title={why ?? undefined}
                        onClick={() => add(entry)}
                        sx={{ minHeight: 44, minWidth: key.span === 2 ? 96 : 44, textTransform: 'none' }}
                      >
                        {key.label}
                      </Button>
                    );
                  })}
                </Box>
              </Box>
            ))}
          </Stack>
        )}

        {tab === 'custom' && (
          <Stack spacing={2}>
            {inlineError && <Alert severity="warning">{inlineError}</Alert>}
            <TextField
              label="Label"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              error={customLabelError !== null}
              helperText={customLabelError ?? `Up to ${MAX_KEY_LABEL_LENGTH} characters.`}
            />
            <TextField
              label="Sequence"
              value={sequence}
              onChange={(e) => {
                setSequence(e.target.value);
                setCustomTouched(true);
              }}
              error={sequenceError !== null}
              helperText={sequenceError ?? 'Escapes: \\e or \\x1b (Esc), \\r, \\n, \\t, \\\\ and \\xNN for any byte.'}
              slotProps={{ htmlInput: { spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off' } }}
            />
            <Typography variant="body2" aria-label="Sequence bytes" role="status">
              {parsed?.ok ? `Bytes (hex): ${formatHexBytes(parsed.value)}` : 'Bytes (hex): none yet'}
            </Typography>
          </Stack>
        )}

        {tab === 'macro' && (
          <Stack spacing={2}>
            {inlineError && <Alert severity="warning">{inlineError}</Alert>}
            <TextField
              label="Label"
              value={macroName}
              placeholder={chordsValid ? macroLabel(chords) : undefined}
              onChange={(e) => setMacroName(e.target.value)}
              error={macroLabelError !== null}
              helperText={macroLabelError ?? 'Leave empty to name the key after its chords.'}
            />
            <Typography variant="body2" color="text.secondary">
              The chords are sent in order, for example the tmux prefix Ctrl+B, then %.
            </Typography>
            {chords.map((chord, i) => (
              <ChordPicker
                key={i}
                number={i + 1}
                value={chord}
                onChange={(next) => setChords((list) => list.map((c, j) => (j === i ? next : c)))}
                onRemove={chords.length > 1 ? () => setChords((list) => list.filter((_, j) => j !== i)) : undefined}
              />
            ))}
            <Box>
              <Button
                startIcon={<AddIcon />}
                onClick={() => setChords((list) => [...list, EMPTY_CHORD])}
                disabled={chords.length >= MAX_MACRO_CHORDS}
                sx={{ minHeight: 44 }}
              >
                Add chord
              </Button>
              {chords.length >= MAX_MACRO_CHORDS && (
                <Typography variant="caption" color="text.secondary" component="p">
                  A macro has at most {MAX_MACRO_CHORDS} chords.
                </Typography>
              )}
            </Box>
            <Typography variant="body2" aria-label="Macro bytes" role="status">
              {macroBytes ? `Bytes (hex): ${formatHexBytes(macroBytes)}` : 'Bytes (hex): none yet'}
            </Typography>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} sx={{ minHeight: 44 }}>
          Cancel
        </Button>
        {tab === 'custom' && (
          <Button
            variant="contained"
            disabled={!customValid || inlineError !== null}
            sx={{ minHeight: 44 }}
            onClick={() =>
              add({ key: { kind: 'custom', id: newKeyId(), label: customLabel.trim(), sequence } })
            }
          >
            Add custom key
          </Button>
        )}
        {tab === 'macro' && (
          <Button
            variant="contained"
            disabled={!macroValid || inlineError !== null}
            sx={{ minHeight: 44 }}
            onClick={() =>
              add({
                key: {
                  kind: 'macro',
                  id: newKeyId(),
                  label: macroLabelText.trim(),
                  chords: chords.map((c) => ({ modifiers: [...c.modifiers], key: c.key })),
                },
              })
            }
          >
            Add macro
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
