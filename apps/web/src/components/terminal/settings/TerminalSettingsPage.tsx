/**
 * Settings, Terminal (`/settings/terminal`), issues #48 and #80.
 *
 * The terminal domain's card on the per-user settings hub
 * (`config/userSettingsSections.tsx`): every field of the `terminal`
 * namespace (font, size, line height, cursor, scrollback, colour theme, bell,
 * copy-on-select, the scroll buttons and the key bar) with a live preview.
 * Changes save themselves (`PATCH /api/user-settings` through
 * `useTerminalSettings`, debounced and one write at a time, so each write
 * carries the version the previous one returned) and reach every open
 * terminal without reconnecting. The key shortcuts are their own card,
 * `ShortcutsSettingsPage` (`/settings/shortcuts`).
 *
 * No permission gate: the API grants `user_settings:read|write` to every role.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Container,
  FormControl,
  FormControlLabel,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Slider,
  Snackbar,
  Stack,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { LoadingSpinner } from '../../common/LoadingSpinner';
import { useTerminalSettings } from '../../../hooks/useTerminalSettings';
import {
  TERMINAL_FONT_SIZE,
  TERMINAL_LINE_HEIGHT,
  TERMINAL_SCROLLBACK,
  type ResolvedTerminalSettings,
} from '../../../lib/terminal/settings';
import { TERMINAL_FONTS, TERMINAL_THEME_LABELS } from '../../../lib/terminal/appearance';
import {
  TERMINAL_BELL_MODES,
  TERMINAL_CURSOR_STYLES,
  TERMINAL_FONT_FAMILIES,
  TERMINAL_KEY_BAR_MODES,
  TERMINAL_THEMES,
  type TerminalBellMode,
  type TerminalCursorStyle,
  type TerminalFontFamily,
  type TerminalKeyBarMode,
  type TerminalThemeName,
} from '../../../types/terminal';
import { TerminalPreview } from './TerminalPreview';

/** The page title and description; mirror the `Terminal` card. */
export const TERMINAL_SETTINGS_TITLE = 'Terminal';
export const TERMINAL_SETTINGS_DESCRIPTION =
  'Font, colours, cursor, scrollback and bell, and the scroll buttons and key bar on touch screens.';

/** How long the page waits after the last change before it saves. */
export const TERMINAL_SETTINGS_SAVE_DELAY_MS = 400;

const CURSOR_LABELS: Record<TerminalCursorStyle, string> = {
  block: 'Block',
  bar: 'Bar',
  underline: 'Underline',
};

const BELL_LABELS: Record<TerminalBellMode, string> = {
  none: 'Off',
  visual: 'Flash the terminal',
  sound: 'Play a sound',
};

const KEY_BAR_LABELS: Record<TerminalKeyBarMode, string> = {
  auto: 'On touch screens',
  always: 'Always',
  never: 'Never',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="h6" component="h2" gutterBottom>
          {title}
        </Typography>
        <Stack spacing={2.5}>{children}</Stack>
      </CardContent>
    </Card>
  );
}

function LabeledSlider({
  label,
  value,
  format,
  ...slider
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography variant="body2" aria-hidden>
          {label}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {format(value)}
        </Typography>
      </Box>
      <Slider
        value={value}
        min={slider.min}
        max={slider.max}
        step={slider.step}
        onChange={(_, next) => slider.onChange(next as number)}
        getAriaValueText={format}
        aria-label={label}
      />
    </Box>
  );
}

export function TerminalSettingsPage() {
  const { terminal, isLoading, isSaving, error, updateTerminal } = useTerminalSettings();
  const appMode = useTheme().palette.mode;
  // Edits not saved yet, shown over the stored preferences.
  const [pending, setPending] = useState<Partial<ResolvedTerminalSettings>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const shown = useMemo<ResolvedTerminalSettings | null>(
    () => (terminal ? { ...terminal, ...pending } : null),
    [terminal, pending],
  );

  // Autosave: once the edits settle, one write at a time.
  useEffect(() => {
    if (isSaving || Object.keys(pending).length === 0) return;
    const timer = setTimeout(() => {
      const changes = pending;
      updateTerminal(changes)
        .then(() => {
          // Keep the edits made while this write was in flight.
          setPending((current) => {
            const next = { ...current };
            for (const key of Object.keys(changes) as (keyof ResolvedTerminalSettings)[]) {
              if (next[key] === changes[key]) delete next[key];
            }
            return next;
          });
        })
        .catch((err: unknown) => {
          setPending({});
          setSaveError(err instanceof Error ? err.message : 'Failed to save terminal preferences');
        });
    }, TERMINAL_SETTINGS_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pending, isSaving, updateTerminal]);

  if (isLoading) {
    return <LoadingSpinner />;
  }

  const set = <K extends keyof ResolvedTerminalSettings>(key: K, value: ResolvedTerminalSettings[K]) =>
    setPending((current) => ({ ...current, [key]: value }));

  const dirty = Object.keys(pending).length > 0 || isSaving;

  return (
    <Container maxWidth="md">
      <Box sx={{ py: 4 }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {TERMINAL_SETTINGS_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 1 }}>
          {TERMINAL_SETTINGS_DESCRIPTION}
        </Typography>
        <Typography variant="body2" color="text.secondary" role="status" sx={{ mb: 2, minHeight: 20 }}>
          {shown ? (dirty ? 'Saving…' : 'Changes are saved automatically.') : ''}
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {error}
          </Alert>
        )}

        {shown && (
          <Stack spacing={3}>
            <Section title="Preview">
              <TerminalPreview preferences={shown} appMode={appMode} />
            </Section>

            <Section title="Appearance">
              <TextField
                select
                label="Font"
                value={shown.fontFamily}
                onChange={(e) => set('fontFamily', e.target.value as TerminalFontFamily)}
              >
                {TERMINAL_FONT_FAMILIES.map((id) => (
                  <MenuItem key={id} value={id}>
                    {TERMINAL_FONTS[id].label}
                  </MenuItem>
                ))}
              </TextField>
              <LabeledSlider
                label="Font size"
                value={shown.fontSize}
                min={TERMINAL_FONT_SIZE.min}
                max={TERMINAL_FONT_SIZE.max}
                step={1}
                format={(v) => `${v}px`}
                onChange={(v) => set('fontSize', v)}
              />
              <LabeledSlider
                label="Line height"
                value={shown.lineHeight}
                min={TERMINAL_LINE_HEIGHT.min}
                max={TERMINAL_LINE_HEIGHT.max}
                step={TERMINAL_LINE_HEIGHT.step}
                format={(v) => v.toFixed(1)}
                onChange={(v) => set('lineHeight', Math.round(v * 10) / 10)}
              />
              <TextField
                select
                label="Colour theme"
                value={shown.theme}
                onChange={(e) => set('theme', e.target.value as TerminalThemeName)}
              >
                {TERMINAL_THEMES.map((id) => (
                  <MenuItem key={id} value={id}>
                    {TERMINAL_THEME_LABELS[id]}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Cursor style"
                value={shown.cursorStyle}
                onChange={(e) => set('cursorStyle', e.target.value as TerminalCursorStyle)}
              >
                {TERMINAL_CURSOR_STYLES.map((id) => (
                  <MenuItem key={id} value={id}>
                    {CURSOR_LABELS[id]}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={
                  <Switch
                    checked={shown.cursorBlink}
                    onChange={(e) => set('cursorBlink', e.target.checked)}
                  />
                }
                label="Blinking cursor"
              />
            </Section>

            <Section title="Behaviour">
              <LabeledSlider
                label="Scrollback"
                value={shown.scrollback}
                min={TERMINAL_SCROLLBACK.min}
                max={TERMINAL_SCROLLBACK.max}
                step={TERMINAL_SCROLLBACK.step}
                format={(v) => `${v.toLocaleString('en-US')} lines`}
                onChange={(v) => set('scrollback', v)}
              />
              <TextField
                select
                label="Bell"
                value={shown.bell}
                onChange={(e) => set('bell', e.target.value as TerminalBellMode)}
              >
                {TERMINAL_BELL_MODES.map((id) => (
                  <MenuItem key={id} value={id}>
                    {BELL_LABELS[id]}
                  </MenuItem>
                ))}
              </TextField>
              <FormControlLabel
                control={
                  <Switch
                    checked={shown.copyOnSelect}
                    onChange={(e) => set('copyOnSelect', e.target.checked)}
                  />
                }
                label="Copy selected text to the clipboard"
              />
            </Section>

            <Section title="Touch screens">
              <FormControlLabel
                control={
                  <Switch
                    checked={shown.showScrollButtons}
                    onChange={(e) => set('showScrollButtons', e.target.checked)}
                  />
                }
                label="Show scroll buttons"
              />
              <FormControl>
                <FormLabel id="terminal-key-bar-label">Key bar</FormLabel>
                <Typography variant="body2" color="text.secondary">
                  The row of Esc, Tab, Ctrl and arrow keys under the terminal. The terminal
                  toolbar&apos;s keyboard button changes the same setting.
                </Typography>
                <RadioGroup
                  aria-labelledby="terminal-key-bar-label"
                  value={shown.showKeyBar}
                  onChange={(e) => set('showKeyBar', e.target.value as TerminalKeyBarMode)}
                >
                  {TERMINAL_KEY_BAR_MODES.map((id) => (
                    <FormControlLabel key={id} value={id} control={<Radio />} label={KEY_BAR_LABELS[id]} />
                  ))}
                </RadioGroup>
              </FormControl>
            </Section>
          </Stack>
        )}
      </Box>

      <Snackbar open={!!saveError} autoHideDuration={5000} onClose={() => setSaveError(null)}>
        <Alert severity="error" onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      </Snackbar>
    </Container>
  );
}

export default TerminalSettingsPage;
