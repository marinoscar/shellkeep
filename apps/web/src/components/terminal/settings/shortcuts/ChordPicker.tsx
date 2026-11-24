/**
 * One chord of a macro key (#169): the modifiers (Ctrl, Alt, Shift) plus a
 * named key (Esc, Tab, an arrow, F1...) or one printable character. The tmux
 * prefix is Ctrl with the character `b`; `%` is a character alone.
 */

import { Box, Checkbox, FormControlLabel, IconButton, MenuItem, TextField } from '@mui/material';
import { RemoveCircleOutlineOutlined as RemoveIcon } from '@mui/icons-material';
import { CHORD_NAMED_KEYS, isChordKey, type Chord, type KeyModifier } from '../../../../lib/terminal/keys/keyModel';
import { chordLabel } from '../../../../lib/terminal/keys/layoutEdit';

/** The Select value meaning "a printable character" rather than a named key. */
const CHARACTER = '__character__';

const MODIFIERS: { id: KeyModifier; label: string }[] = [
  { id: 'ctrl', label: 'Ctrl' },
  { id: 'alt', label: 'Alt' },
  { id: 'shift', label: 'Shift' },
];

const NAMED = CHORD_NAMED_KEYS as readonly string[];

/** Why a chord cannot be saved, or `null`. */
export function chordError(chord: Chord): string | null {
  if (chord.key === '') return 'Type a character.';
  return isChordKey(chord.key) ? null : 'One printable character (not a space; use the Space key).';
}

export interface ChordPickerProps {
  /** 1-based, for the accessible names (`Chord 2 key`). */
  number: number;
  value: Chord;
  onChange: (chord: Chord) => void;
  /** Omitted: the chord cannot be removed (a macro's only chord). */
  onRemove?: () => void;
}

export function ChordPicker({ number, value, onChange, onRemove }: ChordPickerProps) {
  const named = NAMED.includes(value.key);
  const error = chordError(value);
  const toggle = (modifier: KeyModifier) =>
    onChange({
      ...value,
      modifiers: value.modifiers.includes(modifier)
        ? value.modifiers.filter((m) => m !== modifier)
        : [...value.modifiers, modifier],
    });

  return (
    <Box
      role="group"
      aria-label={`Chord ${number}`}
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}
    >
      {MODIFIERS.map((m) => (
        <FormControlLabel
          key={m.id}
          sx={{ mr: 0, minHeight: 44 }}
          control={
            <Checkbox
              checked={value.modifiers.includes(m.id)}
              onChange={() => toggle(m.id)}
              slotProps={{ input: { 'aria-label': `Chord ${number} ${m.label}` } }}
            />
          }
          label={m.label}
        />
      ))}
      <TextField
        select
        size="small"
        label={`Chord ${number} key`}
        value={named ? value.key : CHARACTER}
        onChange={(e) => onChange({ ...value, key: e.target.value === CHARACTER ? '' : e.target.value })}
        sx={{ minWidth: 130 }}
      >
        <MenuItem value={CHARACTER}>Character</MenuItem>
        {NAMED.map((name) => (
          <MenuItem key={name} value={name}>
            {chordLabel({ modifiers: [], key: name })}
          </MenuItem>
        ))}
      </TextField>
      {!named && (
        <TextField
          size="small"
          label="Character"
          value={value.key}
          onChange={(e) => onChange({ ...value, key: e.target.value.slice(-1) })}
          error={error !== null}
          helperText={error ?? ' '}
          sx={{ width: 120 }}
          slotProps={{ htmlInput: { 'aria-label': `Chord ${number} character`, maxLength: 2 } }}
        />
      )}
      {onRemove && (
        <IconButton aria-label={`Remove chord ${number}`} onClick={onRemove} sx={{ width: 44, height: 44 }}>
          <RemoveIcon />
        </IconButton>
      )}
    </Box>
  );
}
