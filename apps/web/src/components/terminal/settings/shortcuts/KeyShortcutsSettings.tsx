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
  AddCircleOutlineOutlined as AddCircleIcon,
  DeleteOutlineOutlined as DeleteIcon,
} from '@mui/icons-material';
import { KeyShortcut, Keystroke } from '../../../../types/terminal';
import { encodeShortcut, formatEncodedBytes } from '../../../../lib/terminal/encodeKeystroke';
import { MAX_KEY_SHORTCUTS as MAX_SHORTCUTS } from '../../../../lib/terminal/settings';
import { KeystrokeEditor } from './KeystrokeEditor';

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

export interface KeyShortcutsSettingsProps {
  /**
   * The saved shortcuts, resolved (the defaults when nothing is stored):
   * `useTerminalSettings().terminal.keyShortcuts`.
   */
  shortcuts: readonly KeyShortcut[];
  /** Saves the edited list; rejects with the reason on failure. */
  onSave: (shortcuts: KeyShortcut[]) => Promise<void>;
  /** True while a save is in flight. */
  isSaving?: boolean;
  disabled?: boolean;
  /**
   * The built-in list. When given, "Restore defaults" puts it in the draft
   * (saved with Save, like any other edit).
   */
  defaults?: readonly KeyShortcut[];
}

/**
 * The key shortcuts editor of the Terminal settings page
 * (`TerminalSettingsPage`). Holds a draft of `shortcuts` and hands the edited
 * list to `onSave`.
 */
export function KeyShortcutsSettings({
  shortcuts: savedShortcuts,
  onSave,
  isSaving = false,
  disabled = false,
  defaults,
}: KeyShortcutsSettingsProps) {
  const [draft, setDraft] = useState<KeyShortcut[]>(() => [...savedShortcuts]);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Sync draft when the saved list changes from outside (after a save, a version conflict refresh)
  useEffect(() => {
    setDraft([...savedShortcuts]);
  }, [savedShortcuts]);

  // Dirty tracking: compare draft to current saved shortcuts
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
      await onSave(draft);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save shortcuts');
    }
  };

  const handleReset = () => {
    setDraft([...savedShortcuts]);
    setSaveError(null);
  };

  const handleRestoreDefaults = () => {
    if (!defaults) return;
    setDraft(defaults.map((shortcut) => ({ ...shortcut, keystrokes: [...shortcut.keystrokes] })));
    setSaveError(null);
  };

  const isDefault = defaults !== undefined && JSON.stringify(draft) === JSON.stringify(defaults);

  return (
    <Card>
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Key Shortcuts
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            marginBottom: "16px"
          }}>
          Configure custom key sequences sent to the terminal. Shortcuts appear
          in the terminal toolbar and can be tapped on mobile.
        </Typography>

        <Stack spacing={2}>
          {draft.map((shortcut, si) => (
            <Box key={shortcut.id}>
              <Stack
                direction="row"
                spacing={1}
                useFlexGap
                sx={{
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                  gap: 1
                }}>
                {/* Label field */}
                <TextField
                  size="small"
                  label="Label"
                  value={shortcut.label}
                  onChange={(e) => updateShortcut(si, { label: e.target.value })}
                  disabled={isDisabled}
                  sx={{ width: { xs: '100%', sm: 140 } }}
                  slotProps={{
                    htmlInput: { 'aria-label': `shortcut ${si + 1} label` }
                  }}
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

                  {/* What the terminal receives, from the same encoder the key bar uses. */}
                  <Typography
                    variant="caption"
                    component="code"
                    aria-label={`shortcut ${si + 1} bytes`}
                    sx={{ fontFamily: 'monospace', color: 'text.secondary', wordBreak: 'break-all' }}
                  >
                    Sends: {formatEncodedBytes(encodeShortcut(shortcut)) || '(nothing)'}
                  </Typography>

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
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1, mt: 3 }}>
          {defaults && (
            <Button
              variant="text"
              onClick={handleRestoreDefaults}
              disabled={isDisabled || isDefault}
              sx={{ mr: 'auto' }}
            >
              Restore defaults
            </Button>
          )}
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
