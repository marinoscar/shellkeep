import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { mockUserSettings } from '../mocks/data';
import { useTerminalSettings } from '../../hooks/useTerminalSettings';
import { DEFAULT_KEY_SHORTCUTS, DEFAULT_TERMINAL_SETTINGS } from '../../lib/terminal/settings';
import type { KeyShortcut } from '../../types/terminal';
import { DEFAULT_KEY_LAYOUT, DEFAULT_KEY_OPTIONS } from '../../lib/terminal/keys/keyModel';
import { fromLegacyShortcuts, layoutFromLegacyShortcuts } from '../../lib/terminal/keys/legacyAdapter';

const custom: KeyShortcut = {
  id: '22222222-2222-4222-8222-222222222201',
  label: 'Ctrl+R',
  keystrokes: [{ modifiers: ['ctrl'], key: 'r' }],
};

describe('useTerminalSettings', () => {
  it('applies the defaults when the user has no stored terminal namespace', async () => {
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.terminal).toEqual(DEFAULT_TERMINAL_SETTINGS);
    expect(result.current.keyShortcuts).toEqual(DEFAULT_KEY_SHORTCUTS);
    expect(result.current.settings?.shortcuts.keyShortcuts).toHaveLength(9);
  });

  it('reads the shortcuts namespace', async () => {
    server.use(
      http.get('*/api/user-settings', () =>
        HttpResponse.json({
          data: { ...mockUserSettings, shortcuts: { keyShortcuts: [custom] } },
        }),
      ),
    );
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.keyShortcuts).toEqual([custom]);
  });

  it('reads a legacy terminal.keyShortcuts payload through the shim (#80)', async () => {
    server.use(
      http.get('*/api/user-settings', () =>
        HttpResponse.json({
          data: { ...mockUserSettings, terminal: { showScrollButtons: false, keyShortcuts: [custom] } },
        }),
      ),
    );
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.terminal).toEqual({ ...DEFAULT_TERMINAL_SETTINGS, showScrollButtons: false });
    expect(result.current.keyShortcuts).toEqual([custom]);
  });

  it('saves the whole namespace with If-Match and adopts the answer', async () => {
    let body: unknown = null;
    let ifMatch: string | null = null;
    server.use(
      http.patch('*/api/user-settings', async ({ request }) => {
        body = await request.json();
        ifMatch = request.headers.get('If-Match');
        return HttpResponse.json({
          data: { ...mockUserSettings, ...(body as object), version: mockUserSettings.version + 1 },
        });
      }),
    );
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateSettings({ terminal: { showScrollButtons: false } });
    });

    expect(ifMatch).toBe(String(mockUserSettings.version));
    expect(body).toEqual({ terminal: { ...DEFAULT_TERMINAL_SETTINGS, showScrollButtons: false } });
    expect(result.current.terminal?.showScrollButtons).toBe(false);
  });

  it('saves the shortcut list to the shortcuts namespace', async () => {
    let body: unknown = null;
    server.use(
      http.patch('*/api/user-settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          data: { ...mockUserSettings, ...(body as object), version: mockUserSettings.version + 1 },
        });
      }),
    );
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.updateShortcuts([custom]);
    });

    expect(body).toEqual({ shortcuts: { keyShortcuts: [custom] } });
    expect(result.current.keyShortcuts).toEqual([custom]);
  });

  it('returns the resolved v2 layout and options beside the legacy list (#165)', async () => {
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.keyLayout).toEqual(DEFAULT_KEY_LAYOUT);
    expect(result.current.keyOptions).toEqual(DEFAULT_KEY_OPTIONS);
    expect(result.current.settings?.shortcuts.layout).toEqual(DEFAULT_KEY_LAYOUT);
  });

  it('feeds the bar from a stored layout and rewrites it when the legacy editor saves', async () => {
    let body: unknown = null;
    server.use(
      http.get('*/api/user-settings', () =>
        HttpResponse.json({
          data: {
            ...mockUserSettings,
            shortcuts: { keyShortcuts: [custom], layout: fromLegacyShortcuts([custom]) },
          },
        }),
      ),
      http.patch('*/api/user-settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          data: { ...mockUserSettings, ...(body as object), version: mockUserSettings.version + 1 },
        });
      }),
    );
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.keyShortcuts).toEqual([custom]);

    const other: KeyShortcut = { ...custom, id: '22222222-2222-4222-8222-222222222202', label: 'Ctrl+T' };
    await act(async () => {
      await result.current.updateShortcuts([custom, other]);
    });

    expect(body).toEqual({
      shortcuts: { keyShortcuts: [custom, other], layout: layoutFromLegacyShortcuts([custom, other]) },
    });
    // the bar is fed from the layout: the default keys, then the user's own
    expect(result.current.keyShortcuts.slice(-2)).toEqual([custom, other]);
  });

  it('saves the key layout and options without keyShortcuts (#169)', async () => {
    let body: unknown = null;
    server.use(
      http.patch('*/api/user-settings', async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          data: { ...mockUserSettings, ...(body as object), version: mockUserSettings.version + 1 },
        });
      }),
    );
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const layout = { groups: [{ keys: [{ id: 'esc' }] }] };
    const options = { autoHideWithHardwareKeyboard: false, haptics: true };
    await act(async () => {
      await result.current.updateKeys({ layout, options });
    });

    expect(body).toEqual({ shortcuts: { layout, options } });
    expect(result.current.keyLayout).toEqual(layout);
    expect(result.current.keyOptions).toEqual(options);

    await act(async () => {
      await result.current.updateKeys({ options: { ...options, haptics: false } });
    });
    expect(body).toEqual({ shortcuts: { options: { ...options, haptics: false } } });
  });

  it('hands a saved document to the other open instances without a refetch', async () => {
    server.use(
      http.patch('*/api/user-settings', async ({ request }) => {
        const body = (await request.json()) as object;
        return HttpResponse.json({
          data: { ...mockUserSettings, ...body, version: mockUserSettings.version + 1 },
        });
      }),
    );
    const editor = renderHook(() => useTerminalSettings());
    const terminal = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(editor.result.current.isLoading).toBe(false));
    await waitFor(() => expect(terminal.result.current.isLoading).toBe(false));

    await act(async () => {
      await editor.result.current.updateTerminal({ fontSize: 20 });
    });

    await waitFor(() => expect(terminal.result.current.terminal?.fontSize).toBe(20));
  });

  it('rejects with a clear message on a version conflict', async () => {
    server.use(
      http.patch('*/api/user-settings', () =>
        HttpResponse.json({ code: 'CONFLICT', message: 'Version mismatch' }, { status: 409 }),
      ),
    );
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await expect(
      act(async () => {
        await result.current.updateShortcuts([custom]);
      }),
    ).rejects.toThrow(/updated elsewhere/i);
  });
});
