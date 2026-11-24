import { beforeEach, describe, it, expect } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { render } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { mockUserSettings } from '../../mocks/data';
import { ShortcutsSettingsPage } from '../../../components/terminal/settings/ShortcutsSettingsPage';
import {
  DEFAULT_KEY_LAYOUT,
  DEFAULT_KEY_OPTIONS,
  type KeyLayout,
  type KeyOptions,
  type LayoutEntry,
} from '../../../lib/terminal/keys/keyModel';

type Body = { shortcuts?: { layout?: KeyLayout; options?: KeyOptions; keyShortcuts?: unknown } };

/** The stored `shortcuts` namespace the mocked API answers with (`storeLayout` sets it). */
let storedShortcuts: Record<string, unknown> | undefined;

beforeEach(() => {
  storedShortcuts = undefined;
});

/** Records every PATCH body and answers like the API (the namespace merged field by field). */
function capturePatches() {
  const bodies: Body[] = [];
  let version = mockUserSettings.version;
  server.use(
    http.patch('*/api/user-settings', async ({ request }) => {
      const body = (await request.json()) as Body;
      bodies.push(body);
      version += 1;
      storedShortcuts = { keyShortcuts: [], ...storedShortcuts, ...body.shortcuts };
      return HttpResponse.json({ data: { ...mockUserSettings, shortcuts: storedShortcuts, version } });
    }),
  );
  return bodies;
}

function storeLayout(layout: KeyLayout, options?: KeyOptions) {
  storedShortcuts = { keyShortcuts: [], layout, ...(options ? { options } : {}) };
  server.use(
    http.get('*/api/user-settings', () =>
      HttpResponse.json({ data: { ...mockUserSettings, shortcuts: storedShortcuts } }),
    ),
  );
}

const small: KeyLayout = {
  groups: [{ keys: [{ id: 'esc' }, { id: 'tab' }] }, { keys: [{ id: 'up' }] }],
};

const group = (n: number) => screen.getByTestId(`key-group-${n}`);
const chipNames = (n: number) =>
  within(within(group(n)).getByRole('list')).getAllByRole('button').map((b) => b.getAttribute('aria-label')?.split(',')[0]);
const preview = () => screen.getByTestId('key-row-preview');
const lastLayout = (bodies: Body[]) => [...bodies].reverse().find((b) => b.shortcuts?.layout)?.shortcuts?.layout;

async function openKeyMenu(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(await screen.findByRole('button', { name }));
  return screen.findByRole('menu');
}

describe('ShortcutsSettingsPage (#169)', () => {
  it('shows the default layout as groups of keys, with a live preview of the row', async () => {
    render(<ShortcutsSettingsPage />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Keyboard shortcuts' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 3, name: /^Group \d+$/ })).toHaveLength(DEFAULT_KEY_LAYOUT.groups.length);
    expect(chipNames(2)).toEqual(['Shift+Tab', 'Esc', 'Ctrl']);
    expect(chipNames(3)).toEqual(['Left arrow', 'Up arrow', 'Down arrow', 'Right arrow']);
    expect(within(group(2)).getByText('3 of 4 keys, 4 of 4 cells')).toBeInTheDocument();
    expect(within(group(2)).getByRole('button', { name: /^Shift\+Tab, wide/ })).toHaveAttribute('data-span', '2');
    // The preview is the real row, sending nothing.
    const row = within(preview()).getByRole('toolbar', { name: 'Terminal keys' });
    expect(within(row).getByRole('button', { name: 'Esc' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /ctrl/i, pressed: false })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /hardware keyboard/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /vibrate/i })).toBeChecked();
  });

  it('adds a key from the catalog in a new group and autosaves only layout', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    render(<ShortcutsSettingsPage />);

    await user.click(await screen.findByRole('button', { name: 'Add group' }));
    const dialog = screen.getByRole('dialog', { name: 'Add a key' });
    expect(within(dialog).getByText('Adding to a new group at the end.')).toBeInTheDocument();
    for (const section of ['Modifiers', 'Keys', 'Navigation', 'Function keys', 'Signals', 'Actions']) {
      expect(within(dialog).getByRole('heading', { name: section })).toBeInTheDocument();
    }
    await user.click(within(dialog).getByRole('button', { name: 'Add Page Up' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(chipNames(11)).toEqual(['Page Up']);
    // The preview follows at once.
    // (the default layout already holds one PgUp)
    expect(within(preview()).getAllByRole('button', { name: 'PgUp' })).toHaveLength(2);

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(Object.keys(bodies[0])).toEqual(['shortcuts']);
    expect(Object.keys(bodies[0].shortcuts!)).toEqual(['layout']);
    expect(bodies[0].shortcuts).not.toHaveProperty('keyShortcuts');
    expect(bodies[0].shortcuts!.layout!.groups.at(-1)).toEqual({ keys: [{ id: 'pgup' }] });
    expect(await screen.findByText('Changes are saved automatically.')).toBeInTheDocument();
  });

  it('validates a custom key sequence and shows its bytes in hex', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    storeLayout(small);
    render(<ShortcutsSettingsPage />);

    await user.click(await screen.findByRole('button', { name: 'Add key to group 2' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: 'Custom key' }));
    await user.type(within(dialog).getByLabelText('Label'), 'Word right');
    const sequence = within(dialog).getByLabelText('Sequence');
    await user.type(sequence, '\\q');
    expect(within(dialog).getByText('Unknown escape \\q.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add custom key' })).toBeDisabled();

    await user.clear(sequence);
    await user.click(sequence);
    await user.paste('\\x1b[1;5C');
    expect(within(dialog).getByLabelText('Sequence bytes')).toHaveTextContent('Bytes (hex): 1b 5b 31 3b 35 43');
    await user.click(within(dialog).getByRole('button', { name: 'Add custom key' }));

    expect(chipNames(2)).toEqual(['Up arrow', 'Word right']);
    await waitFor(() => expect(bodies).toHaveLength(1));
    const added = bodies[0].shortcuts!.layout!.groups[1].keys[1] as Extract<LayoutEntry, { key: unknown }>;
    expect(added.key).toMatchObject({ kind: 'custom', label: 'Word right', sequence: '\\x1b[1;5C' });
    expect(added.key.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('builds a macro from chords (tmux prefix, then %)', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    storeLayout(small);
    render(<ShortcutsSettingsPage />);

    await user.click(await screen.findByRole('button', { name: 'Add group' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: 'Macro' }));
    // The first chord starts as Ctrl+B.
    expect(within(dialog).getByRole('checkbox', { name: 'Chord 1 Ctrl' })).toBeChecked();
    expect(within(dialog).getByLabelText('Chord 1 character')).toHaveValue('b');
    await user.click(within(dialog).getByRole('button', { name: 'Add chord' }));
    expect(within(dialog).getByRole('button', { name: 'Add macro' })).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Chord 2 character'), '%');
    expect(within(dialog).getByLabelText('Macro bytes')).toHaveTextContent('Bytes (hex): 02 25');
    await user.click(within(dialog).getByRole('button', { name: 'Add macro' }));

    expect(chipNames(3)).toEqual(['Ctrl+B %']);
    await waitFor(() => expect(bodies).toHaveLength(1));
    const added = bodies[0].shortcuts!.layout!.groups[2].keys[0] as Extract<LayoutEntry, { key: unknown }>;
    expect(added.key).toMatchObject({
      kind: 'macro',
      label: 'Ctrl+B %',
      chords: [
        { modifiers: ['ctrl'], key: 'b' },
        { modifiers: [], key: '%' },
      ],
    });
  });

  it('builds a macro with a named key and caps it at 8 chords', async () => {
    const user = userEvent.setup();
    storeLayout(small);
    render(<ShortcutsSettingsPage />);

    await user.click(await screen.findByRole('button', { name: 'Add group' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: 'Macro' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'Chord 1 key' }));
    await user.click(screen.getByRole('option', { name: 'Esc' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Chord 1 Ctrl' }));
    expect(within(dialog).getByLabelText('Macro bytes')).toHaveTextContent('Bytes (hex): 1b');
    const addChord = within(dialog).getByRole('button', { name: 'Add chord' });
    for (let i = 0; i < 7; i += 1) await user.click(addChord);
    expect(addChord).toBeDisabled();
    expect(within(dialog).getByText('A macro has at most 8 chords.')).toBeInTheDocument();
  });

  it('reorders keys within a group with the move buttons and the keyboard', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    render(<ShortcutsSettingsPage />);

    const menu = await openKeyMenu(user, /^Left arrow, key 1 of 4 in group 3/);
    expect(within(menu).getByRole('menuitem', { name: 'Move left' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(menu).getByRole('menuitem', { name: 'Move right' }));
    expect(chipNames(3)).toEqual(['Up arrow', 'Left arrow', 'Down arrow', 'Right arrow']);
    // Focus follows the key.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Left arrow, key 2 of 4/ })).toHaveFocus());

    await user.keyboard('{Alt>}{ArrowRight}{/Alt}');
    expect(chipNames(3)).toEqual(['Up arrow', 'Down arrow', 'Left arrow', 'Right arrow']);
    await waitFor(() => expect(screen.getByRole('button', { name: /^Left arrow, key 3 of 4/ })).toHaveFocus());

    await waitFor(() => expect(lastLayout(bodies)?.groups[2].keys).toEqual([{ id: 'up' }, { id: 'down' }, { id: 'left' }, { id: 'right' }]));
  });

  it('moves a key to another group with the move buttons and the keyboard', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    storeLayout(small);
    render(<ShortcutsSettingsPage />);

    const menu = await openKeyMenu(user, /^Esc, key 1 of 2 in group 1/);
    expect(within(menu).getByRole('menuitem', { name: 'Move to group above' })).toHaveAttribute('aria-disabled', 'true');
    await user.click(within(menu).getByRole('menuitem', { name: 'Move to group below' }));
    expect(chipNames(1)).toEqual(['Tab']);
    expect(chipNames(2)).toEqual(['Up arrow', 'Esc']);

    // Alt+Up takes it back; the group it leaves keeps its other key.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Esc, key 2 of 2 in group 2/ })).toHaveFocus());
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(chipNames(1)).toEqual(['Tab', 'Esc']);
    expect(chipNames(2)).toEqual(['Up arrow']);

    // Alt+Down from the last group starts a new group.
    screen.getByRole('button', { name: /^Up arrow, key 1 of 1 in group 2/ }).focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(within(group(2)).getByRole('alert')).toHaveTextContent('The key cannot move further.');

    await waitFor(() =>
      expect(lastLayout(bodies)).toEqual({ groups: [{ keys: [{ id: 'tab' }, { id: 'esc' }] }, { keys: [{ id: 'up' }] }] }),
    );
  });

  it('moves a key by drag and drop onto another key', async () => {
    storeLayout(small);
    render(<ShortcutsSettingsPage />);
    const up = await screen.findByRole('button', { name: /^Up arrow, key 1 of 1/ });
    const esc = screen.getByRole('button', { name: /^Esc, key 1 of 2/ });
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (t: string, v: string) => data.set(t, v),
      getData: (t: string) => data.get(t) ?? '',
      get types() {
        return [...data.keys()];
      },
      effectAllowed: 'move',
    };
    fireEvent.dragStart(up, { dataTransfer });
    fireEvent.dragOver(esc, { dataTransfer });
    fireEvent.drop(esc, { dataTransfer });
    expect(chipNames(1)).toEqual(['Up arrow', 'Esc', 'Tab']);
    expect(screen.getAllByRole('heading', { level: 3, name: /^Group \d+$/ })).toHaveLength(1);
  });

  it('enforces the caps with messages', async () => {
    const user = userEvent.setup();
    render(<ShortcutsSettingsPage />);

    // Group 2 (Shift+Tab, Esc, Ctrl) fills its four cells: no key can join it.
    expect(await screen.findByRole('button', { name: 'Add key to group 2' })).toBeDisabled();
    // Group 4 (two wide macros) refuses a key moved in.
    screen.getByRole('button', { name: /^Up arrow, key 2 of 4 in group 3/ }).focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');
    expect(within(group(3)).getByRole('alert')).toHaveTextContent('Group 4 has 0 free cells; this key needs 1.');
    // Widening a key in a full group is refused.
    const menu = await openKeyMenu(user, /^Esc, key 2 of 3 in group 2/);
    await user.click(within(menu).getByRole('menuitem', { name: 'Make wide (2 cells)' }));
    expect(within(group(2)).getByRole('alert')).toHaveTextContent('Group 2 has no free cell to widen this key.');
  });

  it('refuses a 41st group and a 51st custom key', async () => {
    const user = userEvent.setup();
    const many: KeyLayout = {
      groups: Array.from({ length: 40 }, (_, g) => ({
        keys:
          g < 25
            ? [0, 1].map((k) => ({
                key: {
                  kind: 'macro' as const,
                  id: `44444444-4444-4444-8444-4444444444${String(g * 2 + k).padStart(2, '0')}`,
                  label: `M${g * 2 + k}`,
                  chords: [{ modifiers: [], key: 'a' }],
                },
              }))
            : [{ id: 'esc' }],
      })),
    };
    storeLayout(many);
    render(<ShortcutsSettingsPage />);

    expect(await screen.findByRole('button', { name: 'Add group' })).toBeDisabled();
    expect(screen.getByText('At most 40 groups.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add key to group 30' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: 'Custom key' }));
    expect(within(dialog).getByText('At most 50 custom and macro keys per layout.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add custom key' })).toBeDisabled();
  });

  it('lists the problems of an invalid stored layout and does not save it', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    storeLayout({ groups: [{ keys: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }, { id: 'f4' }, { id: 'f5' }] }] });
    render(<ShortcutsSettingsPage />);

    expect(await screen.findByText('Group 1 has more than 4 keys.')).toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: /vibrate/i }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ shortcuts: { options: { ...DEFAULT_KEY_OPTIONS, haptics: false } } });
    expect(await screen.findByText('Not saved: fix the problems below.')).toBeInTheDocument();
  });

  it('toggles a key between one and two cells', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    storeLayout(small);
    render(<ShortcutsSettingsPage />);

    const menu = await openKeyMenu(user, /^Esc, key 1 of 2/);
    await user.click(within(menu).getByRole('menuitem', { name: 'Make wide (2 cells)' }));
    expect(screen.getByRole('button', { name: /^Esc, wide, key 1 of 2/ })).toHaveAttribute('data-span', '2');
    expect(within(group(1)).getByText('2 of 4 keys, 3 of 4 cells')).toBeInTheDocument();
    await waitFor(() => expect(lastLayout(bodies)?.groups[0].keys[0]).toEqual({ id: 'esc', span: 2 }));

    const again = await openKeyMenu(user, /^Esc, wide/);
    await user.click(within(again).getByRole('menuitem', { name: 'Make narrow (1 cell)' }));
    await waitFor(() => expect(lastLayout(bodies)?.groups[0].keys[0]).toEqual({ id: 'esc' }));
  });

  it('deletes a key, and a group, and the preview follows', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    storeLayout(small);
    render(<ShortcutsSettingsPage />);

    expect(within(await screen.findByTestId('key-row-preview')).getByRole('button', { name: 'Esc' })).toBeInTheDocument();
    const menu = await openKeyMenu(user, /^Esc, key 1 of 2/);
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete key' }));
    expect(chipNames(1)).toEqual(['Tab']);
    expect(within(preview()).queryByRole('button', { name: 'Esc' })).not.toBeInTheDocument();

    // Delete on a focused key removes it too; the empty group goes with it.
    screen.getByRole('button', { name: /^Tab, key 1 of 1/ }).focus();
    await user.keyboard('{Delete}');
    expect(screen.getAllByRole('heading', { level: 3, name: /^Group \d+$/ })).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Delete group 1' }));
    expect(screen.queryByRole('heading', { level: 3 })).not.toBeInTheDocument();
    expect(screen.getByText('No keys yet: add a group to start.')).toBeInTheDocument();
    await waitFor(() => expect(lastLayout(bodies)).toEqual({ groups: [] }));
  });

  it('moves groups up and down', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    storeLayout(small);
    render(<ShortcutsSettingsPage />);

    expect(await screen.findByRole('button', { name: 'Move group 1 up' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Move group 2 up' }));
    expect(chipNames(1)).toEqual(['Up arrow']);
    await waitFor(() => expect(lastLayout(bodies)?.groups.map((g) => g.keys.length)).toEqual([1, 2]));
  });

  it('resets to the defaults only after confirming', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    storeLayout(small, { autoHideWithHardwareKeyboard: false, haptics: false });
    render(<ShortcutsSettingsPage />);

    await user.click(await screen.findByRole('button', { name: 'Reset to defaults' }));
    let dialog = screen.getByRole('dialog', { name: /reset the keys/i });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 3, name: /^Group \d+$/ })).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    dialog = screen.getByRole('dialog', { name: /reset the keys/i });
    await user.click(within(dialog).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getAllByRole('heading', { level: 3, name: /^Group \d+$/ })).toHaveLength(DEFAULT_KEY_LAYOUT.groups.length);

    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({ shortcuts: { layout: DEFAULT_KEY_LAYOUT, options: DEFAULT_KEY_OPTIONS } });
  });

  it('saves an option change with options only', async () => {
    const user = userEvent.setup();
    const bodies = capturePatches();
    render(<ShortcutsSettingsPage />);

    await user.click(await screen.findByRole('switch', { name: /hardware keyboard/i }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      shortcuts: { options: { ...DEFAULT_KEY_OPTIONS, autoHideWithHardwareKeyboard: false } },
    });
  });

  it('shows the error of a failed save and returns to the stored keys', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch('*/api/user-settings', () =>
        HttpResponse.json({ code: 'CONFLICT', message: 'Version mismatch' }, { status: 409 }),
      ),
    );
    storeLayout(small);
    render(<ShortcutsSettingsPage />);

    await user.click(await screen.findByRole('button', { name: 'Move group 2 up' }));
    expect(await screen.findByText(/updated elsewhere/i)).toBeInTheDocument();
    await waitFor(() => expect(chipNames(1)).toEqual(['Esc', 'Tab']));
  });
});
