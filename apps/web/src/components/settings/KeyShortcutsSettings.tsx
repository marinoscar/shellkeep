import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  FormHelperText,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  AddCircleOutline as AddCircleIcon,
  DeleteOutline as DeleteIcon,
} from '@mui/icons-material';
import { KeyShortcut, Keystroke } from '../../types';
import { useUserSettings } from '../../hooks/useUserSettings';
import { KeystrokeEditor } from './KeystrokeEditor';

const MAX_SHORTCUTS = 50;

function defaultKeystroke(): Keystroke {
  return { modifiers: [], key: 'Escape' };
}

function defaultShortcut(): KeyShortcut {
  return {
    id: crypto.randomUUID(),
    label: 'New',
    keystrokes: [defaultKeystroke()],
  };
}

interface KeyShortcutsSettingsProps {
  disabled?: boolean;
}

export function KeyShortcutsSettings({ disabled = false }: KeyShortcutsSettingsProps) {
  const { settings, updateSettings, isSaving } = useUserSettings();

  const [draft, setDraft] = useState<KeyShortcut[]>(
    settings?.terminal?.keyShortcuts ?? [],
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync draft when settings change from outside (e.g. after save, version conflict refresh)
  useEffect(() => {
    setDraft(settings?.terminal?.keyShortcuts ?? []);
  }, [settings]);

  // Dirty tracking: compare draft to current saved shortcuts
  const savedShortcuts = settings?.terminal?.keyShortcuts ?? [];
  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedShortcuts);

  const isDisabled = disabled || isSaving;

  // --- shortcut-level mutations ---

  const updateShortcut = (index: number, next: Partial<KeyShortcut>) => {
    setDraft((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...next } : s)),
    );
  };

  const deleteShortcut = (index: number) => {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  };

  const addShortcut = () => {
    if (draft.length >= MAX_SHORTCUTS) return;
    setDraft((prev) => [...prev, defaultShortcut()]);
  };

  // --- keystroke-level mutations ---

  const updateKeystroke = (
    shortcutIndex: number,
    keystrokeIndex: number,
    next: Keystroke,
  ) => {
    setDraft((prev) =>
      prev.map((s, si) => {
        if (si !== shortcutIndex) return s;
        return {
          ...s,
          keystrokes: s.keystrokes.map((k, ki) => (ki === keystrokeIndex ? next : k)),
        };
      }),
    );
  };

  const addKeystroke = (shortcutIndex: number) => {
    setDraft((prev) =>
      prev.map((s, si) => {
        if (si !== shortcutIndex) return s;
        if (s.keystrokes.length >= 3) return s;
        return { ...s, keystrokes: [...s.keystrokes, defaultKeystroke()] };
      }),
    );
  };

  const removeKeystroke = (shortcutIndex: number, keystrokeIndex: number) => {
    setDraft((prev) =>
      prev.map((s, si) => {
        if (si !== shortcutIndex) return s;
        return {
          ...s,
          keystrokes: s.keystrokes.filter((_, ki) => ki !== keystrokeIndex),
        };
      }),
    );
  };

  // --- save / reset ---

  const handleSave = async () => {
    setSaveError(null);
    try {
      await updateSettings({
        terminal: {
          ...(settings?.terminal ?? { showScrollButtons: true }),
          keyShortcuts: draft,
        },
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save shortcuts');
    }
  };

  const handleReset = () => {
    setDraft(settings?.terminal?.keyShortcuts ?? []);
    setSaveError(null);
  };

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Key Shortcuts
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Configure custom key sequences sent to the terminal. Shortcuts appear
          in the terminal toolbar and can be tapped on mobile.
        </Typography>

        <Stack spacing={2}>
          {draft.map((shortcut, si) => (
            <Box key={shortcut.id}>
              <Stack
                direction="row"
                spacing={1}
                alignItems="flex-start"
                flexWrap="wrap"
                useFlexGap
                sx={{ gap: 1 }}
              >
                {/* Label field */}
                <TextField
                  size="small"
                  label="Label"
                  value={shortcut.label}
                  onChange={(e) => updateShortcut(si, { label: e.target.value })}
                  disabled={isDisabled}
                  inputProps={{ 'aria-label': `shortcut ${si + 1} label` }}
                  sx={{ width: { xs: '100%', sm: 140 } }}
                />

                {/* Keystrokes */}
                <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
                  {shortcut.keystrokes.map((ks, ki) => (
                    <KeystrokeEditor
                      key={ki}
                      value={ks}
                      onChange={(next) => updateKeystroke(si, ki, next)}
                      onRemove={
                        ki > 0 ? () => removeKeystroke(si, ki) : undefined
                      }
                      disabled={isDisabled}
                    />
                  ))}

                  {shortcut.keystrokes.length < 3 && (
                    <Box>
                      <Button
                        size="small"
                        startIcon={<AddCircleIcon />}
                        onClick={() => addKeystroke(si)}
                        disabled={isDisabled}
                        sx={{ textTransform: 'none' }}
                      >
                        + keystroke
                      </Button>
                    </Box>
                  )}
                </Stack>

                {/* Delete shortcut */}
                <Tooltip title="Delete shortcut">
                  <span>
                    <IconButton
                      onClick={() => deleteShortcut(si)}
                      disabled={isDisabled}
                      aria-label={`delete shortcut ${si + 1}`}
                      size="medium"
                      color="default"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>

              {si < draft.length - 1 && <Divider sx={{ mt: 2 }} />}
            </Box>
          ))}

          {/* Add shortcut button */}
          <Box>
            <Button
              variant="outlined"
              fullWidth
              startIcon={<AddIcon />}
              onClick={addShortcut}
              disabled={isDisabled || draft.length >= MAX_SHORTCUTS}
              sx={{ textTransform: 'none' }}
            >
              Add shortcut
            </Button>
            {draft.length >= MAX_SHORTCUTS && (
              <FormHelperText sx={{ textAlign: 'center', mt: 0.5 }}>
                Maximum of {MAX_SHORTCUTS} shortcuts reached
              </FormHelperText>
            )}
          </Box>
        </Stack>

        {/* Error feedback */}
        {saveError && (
          <Typography variant="body2" color="error" sx={{ mt: 2 }}>
            {saveError}
          </Typography>
        )}

        {/* Save / Reset actions */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 3 }}>
          <Button
            variant="text"
            onClick={handleReset}
            disabled={isDisabled || !isDirty}
          >
            Reset
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={isDisabled || !isDirty}
          >
            {isSaving ? 'Saving...' : 'Save Changes'}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}
