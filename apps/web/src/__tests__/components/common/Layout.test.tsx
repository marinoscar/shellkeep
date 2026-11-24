import { describe, it, expect, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { render, mockUser, type MockUser } from '../../utils/test-utils';
import { Layout } from '../../../components/common/Layout';

/**
 * The shell binding (#76) at the three window classes: 360 (phone), 768
 * (medium, collapsed rail) and 1280 (expanded rail). `matchMedia` answers
 * min/max-width queries against the simulated width, so the platform's own
 * gates decide what mounts; `Layout` reads none.
 */
function installWidth(width: number): () => void {
  const original = window.matchMedia;
  const evaluate = (query: string) => {
    const mins = [...query.matchAll(/\(min-width:\s*([\d.]+)px\)/g)].map((m) => parseFloat(m[1]));
    const maxs = [...query.matchAll(/\(max-width:\s*([\d.]+)px\)/g)].map((m) => parseFloat(m[1]));
    if (mins.length === 0 && maxs.length === 0) return false;
    return mins.every((min) => width >= min) && maxs.every((max) => width <= max);
  };
  window.matchMedia = ((query: string) => ({
    matches: evaluate(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

const admin: MockUser = {
  ...mockUser,
  id: 'admin-id',
  displayName: 'Person A',
  roles: [{ name: 'admin' }],
  permissions: [
    'user_settings:read',
    'user_settings:write',
    'sessions:read',
    'servers:read',
    'system_settings:read',
    'users:read',
  ],
};

const viewer: MockUser = {
  ...mockUser,
  permissions: ['user_settings:read', 'user_settings:write', 'sessions:read', 'servers:read'],
};

function renderShell(route: string, user: MockUser, element = <Layout />) {
  return render(
    <Routes>
      <Route element={element}>
        <Route path="*" element={<div data-testid="page">Page</div>} />
      </Route>
    </Routes>,
    { wrapperOptions: { route, user } },
  );
}

/** The rail: the shell's `nav` in either mode. */
const rail = () =>
  screen.queryByRole('navigation', { name: 'Main navigation' }) ??
  screen.queryByRole('navigation', { name: 'Console navigation' });
/** The phone bottom bar (MUI BottomNavigation). */
const bottomBar = () => document.querySelector<HTMLElement>('.MuiBottomNavigation-root');

let restore: (() => void) | undefined;
afterEach(() => {
  restore?.();
  restore = undefined;
});

describe('Layout (the platform shell binding)', () => {
  describe('at 360px (phone)', () => {
    it('draws the bottom bar and no rail: exactly one navigation surface', () => {
      restore = installWidth(360);
      renderShell('/', viewer);
      expect(rail()).toBeNull();
      const bar = bottomBar();
      expect(bar).not.toBeNull();
      const labels = within(bar!).getAllByRole('button').map((b) => b.textContent);
      expect(labels).toEqual(['Home', 'Sessions', 'Servers']);
      expect(screen.getByTestId('page')).toBeInTheDocument();
    });

    it('gives an administrator Console as the fourth tab while four destinations fit', () => {
      restore = installWidth(360);
      renderShell('/', admin);
      const labels = within(bottomBar()!).getAllByRole('button').map((b) => b.textContent);
      expect(labels).toEqual(['Home', 'Sessions', 'Servers', 'Console']);
    });

    it('with six visible destinations shows three tabs plus More, and More holds Runbooks, Runs and Console', async () => {
      restore = installWidth(360);
      // #65 appended Runbooks and Runs before the pinned Console.
      renderShell('/', { ...admin, permissions: [...admin.permissions, 'runbooks:read'] });
      const bar = bottomBar()!;
      const tabs = within(bar).getAllByRole('button');
      expect(tabs.map((b) => b.textContent)).toEqual(['Home', 'Sessions', 'Servers', 'More']);

      await userEvent.click(within(bar).getByRole('button', { name: /More destinations/ }));
      const sheet = await screen.findByRole('navigation', { name: 'More destinations' });
      const rows = within(sheet).getAllByRole('link').map((row) => row.textContent);
      expect(rows).toEqual(['Runbooks', 'Runs', 'Console']);
    });
  });

  describe('at 768px (medium)', () => {
    it('draws the collapsed rail and no bottom bar, Console pinned at its foot', () => {
      restore = installWidth(768);
      renderShell('/', admin);
      expect(bottomBar()).toBeNull();
      const nav = rail();
      expect(nav).not.toBeNull();
      const names = within(nav!).getAllByRole('link').map((link) => link.getAttribute('aria-label') ?? link.textContent);
      expect(names[names.length - 1]).toContain('Console');
    });
  });

  describe('at 1280px (expanded)', () => {
    it('draws the expanded rail with Home, Sessions, Servers and Console last', () => {
      restore = installWidth(1280);
      renderShell('/', admin);
      expect(bottomBar()).toBeNull();
      const nav = screen.getByRole('navigation', { name: 'Main navigation' });
      const texts = within(nav).getAllByRole('link').map((link) => link.textContent);
      expect(texts).toEqual(['Home', 'Sessions', 'Servers', 'Console']);
    });

    it('hides Console from a viewer without an admin permission', () => {
      restore = installWidth(1280);
      renderShell('/', viewer);
      const nav = screen.getByRole('navigation', { name: 'Main navigation' });
      expect(within(nav).queryByText('Console')).toBeNull();
    });

    it('switches the rail to Console mode on /admin/settings, with a way back to ShellKeep', () => {
      restore = installWidth(1280);
      renderShell('/admin/settings', admin);
      expect(screen.queryByRole('navigation', { name: 'Main navigation' })).toBeNull();
      const consoleNav = screen.getByRole('navigation', { name: 'Console navigation' });
      const back = within(consoleNav).getByRole('link', { name: 'Back to ShellKeep' });
      expect(back).toHaveAttribute('href', '/');
      expect(within(consoleNav).getByRole('link', { name: 'About' })).toBeInTheDocument();
      expect(within(consoleNav).getByRole('link', { name: 'Users & Allowlist' })).toBeInTheDocument();
    });
  });

  it('brands the AppBar ShellKeep and draws the padded main by default', () => {
    restore = installWidth(1280);
    renderShell('/', viewer);
    expect(screen.getByText('ShellKeep')).toBeInTheDocument();
    expect(document.querySelector('main')).toHaveAttribute('data-main-variant', 'padded');
  });
});
