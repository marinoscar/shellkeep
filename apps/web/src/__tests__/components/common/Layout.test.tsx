import { describe, it, expect, afterEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { render, mockUser, type MockUser } from '../../utils/test-utils';
import { server } from '../../mocks/server';
import { Layout } from '../../../components/common/Layout';
import { APP_NAME, APP_VERSION } from '../../../config/app';

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
    // #148: the Option A mark sits beside the name, hidden from assistive tech.
    expect(screen.getByTestId('brand-mark')).toHaveAttribute('aria-hidden', 'true');
    expect(document.querySelector('main')).toHaveAttribute('data-main-variant', 'padded');
  });
});

describe('Layout: the user-menu version line', () => {
  /** The avatar button that opens the user menu (the one holding the avatar). */
  const avatarButton = () => document.querySelector('.MuiAvatar-root')!.closest('button')!;

  it('shows "<APP_NAME> <APP_VERSION>" in the footer once the menu opens, to a viewer too', async () => {
    restore = installWidth(1280);
    renderShell('/', viewer);
    // Inside the menu, which is closed until the avatar is clicked.
    expect(screen.queryByText(`${APP_NAME} ${APP_VERSION}`)).toBeNull();

    await userEvent.click(avatarButton());
    const menu = await screen.findByRole('menu');
    const line = within(menu).getByText(`${APP_NAME} ${APP_VERSION}`);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    // A label, not an action.
    expect(line.closest('[role="menuitem"]')).toBeNull();
  });
});

describe('Layout: onboarding (#70)', () => {
  const onboarding = (welcomeSeenAt: string | null) => ({
    settings: { welcomeSeenAt, checklistDismissedAt: null, adminDismissedAt: null, skipped: [] },
    user: {
      steps: [
        {
          id: 'shellkeep.add-server',
          audience: 'user',
          tier: 'required',
          status: 'todo',
          title: 'Add a server',
          description: 'Save a server.',
          actionLabel: 'Add a server',
          href: '/servers?new=1',
          detail: null,
          blockedReason: null,
          skippable: false,
          skipped: false,
        },
      ],
      completed: 0,
      total: 1,
      requiredDone: false,
      allResolved: false,
    },
    admin: null,
  });

  let restore: () => void = () => undefined;
  afterEach(() => restore());

  it('opens the welcome dialog with the ShellKeep pane while it has not been seen, and shows the banner', async () => {
    restore = installWidth(1280);
    server.use(http.get('*/api/onboarding', () => HttpResponse.json({ data: onboarding(null) })));
    renderShell('/', viewer);
    const dialog = await screen.findByTestId('welcome-dialog');
    expect(within(dialog).getByText(/keep running when you close the tab/)).toBeInTheDocument();
    // The modal hides the page behind it from the accessibility tree.
    expect(screen.getByRole('heading', { name: /1 of 1 required step left/, hidden: true })).toBeInTheDocument();
  });

  it('does not open the welcome dialog once it has been seen', async () => {
    restore = installWidth(1280);
    server.use(http.get('*/api/onboarding', () => HttpResponse.json({ data: onboarding('2026-01-01T00:00:00.000Z') })));
    renderShell('/', viewer);
    expect(await screen.findByRole('heading', { name: /1 of 1 required step left/ })).toBeInTheDocument();
    expect(screen.queryByTestId('welcome-dialog')).not.toBeInTheDocument();
  });
});
