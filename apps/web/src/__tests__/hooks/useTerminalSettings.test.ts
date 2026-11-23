import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { mockUserSettings } from '../mocks/data';
import { useTerminalSettings } from '../../hooks/useTerminalSettings';
import { DEFAULT_KEY_SHORTCUTS } from '../../lib/terminal/settings';
import type { KeyShortcut } from '../../types/terminal';

const custom: KeyShortcut = {
  id: '22222222-2222-4222-8222-222222222201',
  label: 'Ctrl+R',
  keystrokes: [{ modifiers: ['ctrl'], key: 'r' }],
};

describe('useTerminalSettings', () => {
  it('applies the defaults when the user has no stored terminal namespace', async () => {
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.terminal).toEqual({
      showScrollButtons: true,
      keyShortcuts: DEFAULT_KEY_SHORTCUTS,
    });
    expect(result.current.settings?.terminal.keyShortcuts).toHaveLength(9);
  });

  it('reads a stored namespace as saved before the change', async () => {
    server.use(
      http.get('*/api/user-settings', () =>
        HttpResponse.json({
          data: { ...mockUserSettings, terminal: { showScrollButtons: false, keyShortcuts: [custom] } },
        }),
      ),
    );
    const { result } = renderHook(() => useTerminalSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.terminal).toEqual({ showScrollButtons: false, keyShortcuts: [custom] });
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
    expect(body).toEqual({
      terminal: { showScrollButtons: false, keyShortcuts: DEFAULT_KEY_SHORTCUTS },
    });
    expect(result.current.terminal?.showScrollButtons).toBe(false);
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
        await result.current.updateTerminal({ keyShortcuts: [custom] });
      }),
    ).rejects.toThrow(/updated elsewhere/i);
  });
});
