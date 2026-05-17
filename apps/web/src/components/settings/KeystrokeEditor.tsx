import {
  Checkbox,
  FormControlLabel,
  IconButton,
  MenuItem,
  Select,
  Stack,
} from '@mui/material';
import { RemoveCircleOutline as RemoveIcon } from '@mui/icons-material';
import { KeyShortcutModifier, Keystroke, KEY_SHORTCUT_BASE_KEYS } from '../../types';

// Friendly display labels for special keys
const KEY_LABELS: Record<string, string> = {
  Escape: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
  Insert: 'Insert',
  Delete: 'Del',
};

function getKeyLabel(key: string): string {
  if (KEY_LABELS[key]) return KEY_LABELS[key];
  // Single lowercase letter → uppercase
  if (key.length === 1 && key >= 'a' && key <= 'z') return key.toUpperCase();
  return key;
}

export interface KeystrokeEditorProps {
  value: Keystroke;
  onChange: (next: Keystroke) => void;
  onRemove?: () => void;
  disabled?: boolean;
}

export function KeystrokeEditor({
  value,
  onChange,
  onRemove,
  disabled = false,
}: KeystrokeEditorProps) {
  const hasModifier = (mod: KeyShortcutModifier) => value.modifiers.includes(mod);

  const toggleModifier = (mod: KeyShortcutModifier) => {
    const next = hasModifier(mod)
      ? value.modifiers.filter((m) => m !== mod)
      : [...value.modifiers, mod];
    onChange({ ...value, modifiers: next });
  };

  return (
    <Stack
      direction="row"
      spacing={0.5}
      alignItems="center"
      flexWrap="wrap"
      useFlexGap
      sx={{ gap: 0.5 }}
    >
      <FormControlLabel
        control={
          <Checkbox
            checked={hasModifier('ctrl')}
            onChange={() => toggleModifier('ctrl')}
            disabled={disabled}
            size="small"
          />
        }
        label="Ctrl"
        sx={{ mr: 0, minWidth: 68 }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={hasModifier('shift')}
            onChange={() => toggleModifier('shift')}
            disabled={disabled}
            size="small"
          />
        }
        label="Shift"
        sx={{ mr: 0, minWidth: 76 }}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={hasModifier('alt')}
            onChange={() => toggleModifier('alt')}
            disabled={disabled}
            size="small"
          />
        }
        label="Alt"
        sx={{ mr: 0, minWidth: 60 }}
      />

      <Select
        size="small"
        value={value.key}
        onChange={(e) =>
          onChange({
            ...value,
            key: e.target.value as Keystroke['key'],
          })
        }
        disabled={disabled}
        sx={{ minWidth: 90 }}
        inputProps={{ 'aria-label': 'key selection' }}
      >
        {KEY_SHORTCUT_BASE_KEYS.map((k) => (
          <MenuItem key={k} value={k}>
            {getKeyLabel(k)}
          </MenuItem>
        ))}
      </Select>

      {onRemove && (
        <IconButton
          onClick={onRemove}
          disabled={disabled}
          aria-label="remove keystroke"
          size="medium"
          color="default"
          sx={{ p: 1 }}
        >
          <RemoveIcon />
        </IconButton>
      )}
    </Stack>
  );
}
