// The Servers page (issue #79): the platform DataTable over the server list, filters in the URL,
// row actions gated by `access.can` (#71), host-key prompts on a refused test (#60), the detail
// drawer, and the bulk actions on the selection (run a runbook, test, tag, delete).
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router-dom';
import { installLayoutStubs, setContainerWidth } from '@marinoscar/platform-web/datatable/testing';
import { render, mockUser, type MockUser } from '../utils/test-utils';
import type { ServerProfile } from '../../types';

vi.mock('../../services/terminal-api', () => ({
  getServerProfiles: vi.fn(),
  getServerProfileTags: vi.fn(),
  bulkTagServerProfiles: vi.fn(),
  createServerProfile: vi.fn(),
  updateServerProfile: vi.fn(),
  deleteServerProfile: vi.fn(),
  testServerProfile: vi.fn(),
  createSession: vi.fn(),
  getSessions: vi.fn(),
  trustHostKey: vi.fn(),
  scanHostKey: vi.fn(),
  forgetHostKey: vi.fn(),
  refreshServerFacts: vi.fn(),
  getServerProfile: vi.fn(),
}));
vi.mock('../../services/runbooks-api', () => ({
  listRunbooks: vi.fn(),
  previewRunbookTargets: vi.fn(),
  startRunbookRun: vi.fn(),
}));
// The platform dialog needs the host; what the page passes to it is what is under test.
vi.mock('../../components/common/ShareResourceDialog', () => ({
  ShareResourceDialog: vi.fn(({ open, resourceType, resourceId }) =>
    open ? <div data-testid="share-dialog">{`${resourceType}:${resourceId}`}</div> : null,
  ),
}));

import * as terminalApi from '../../services/terminal-api';
import * as runbooksApi from '../../services/runbooks-api';
import ServerProfilesPage from '../../pages/ServerProfilesPage';

const api = vi.mocked(terminalApi);
const runbooks = vi.mocked(runbooksApi);

const CAN_ALL = { connect: true, test: true, write: true, share: true, delete: true };
const READ_ONLY = { connect: true, test: true, write: false, share: false, delete: false };
const PRESENTED = 'SHA256:' + 'P'.repeat(43);

function profile(id: string, name: string, extra: Partial<ServerProfile> = {}): ServerProfile {
  return {
    id,
    name,
    hostname: `${id}.example.test`,
    port: 22,
    username: 'ops',
    authMethod: 'agent',
    fingerprint: null,
    tags: [],
    color: 'default',
    aiOutputSharing: true,
    health: 'unknown',
    hostKeyState: 'untrusted',
    lastTestAt: null,
    lastTestOk: null,
    lastSessionAt: null,
    owner: { kind: 'user', id: 'u-a', name: 'Person A' },
    access: { role: 'owner', via: 'owner', shared: false, credentialHolder: true, can: CAN_ALL },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...extra,
  };
}

const alpha = profile('srv-a', 'Server A', {
  tags: ['prod'],
  health: 'reachable',
  lastTestAt: '2026-11-24T00:00:00.000Z',
  lastTestOk: true,
  fingerprint: 'SHA256:' + 'T'.repeat(43),
  hostKeyState: 'trusted',
});
const bravo = profile('srv-b', 'Server B', { tags: ['prod', 'web'], health: 'unreachable', lastTestOk: false });
const charlie = profile('srv-c', 'Server C', {
  owner: { kind: 'user', id: 'u-b', name: 'Person B' },
  access: { role: 'viewer', via: 'user_grant', shared: true, credentialHolder: false, can: READ_ONLY },
});
const ROWS = [alpha, bravo, charlie];

const operator: MockUser = {
  ...mockUser,
  permissions: [...mockUser.permissions, 'servers:read', 'servers:write', 'servers:delete', 'sessions:write', 'runbooks:read', 'runbooks:run'],
};
const noRunbooks: MockUser = { ...operator, permissions: operator.permissions.filter((p) => !p.startsWith('runbooks:')) };

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
}

function renderPage(route = '/servers', user: MockUser = operator) {
  return render(
    <>
      <ServerProfilesPage />
      <LocationProbe />
    </>,
    { wrapperOptions: { route, user } },
  );
}

const lastQuery = () => api.getServerProfiles.mock.calls.at(-1)?.[0];
const search = () => new URLSearchParams(screen.getByTestId('location').textContent?.split('?')[1] ?? '');

async function selectRows(user: ReturnType<typeof userEvent.setup>, names: string[]) {
  for (const name of names) await user.click(await screen.findByRole('checkbox', { name: `Select ${name}` }));
}

// The DataGrid renders and the dialogs animate: under a loaded runner a case can pass 10 s.
describe('ServerProfilesPage (#79)', { timeout: 30_000 }, () => {
  beforeAll(() => installLayoutStubs());

  beforeEach(() => {
    vi.clearAllMocks();
    setContainerWidth(1280);
    api.getServerProfiles.mockResolvedValue({ items: ROWS, total: ROWS.length, page: 1, pageSize: 20 });
    api.getServerProfileTags.mockResolvedValue(['prod', 'web']);
    api.getSessions.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 5 });
    runbooks.listRunbooks.mockResolvedValue({
      items: [{ id: 'rb-1', name: 'Patch kernel', description: null, tags: [], latestVersion: { version: 1 } }],
      total: 1,
    });
  });

  describe('filters in the URL', () => {
    it('applies tag and health from the URL to the request', async () => {
      renderPage('/servers?tag=prod&health=unreachable');
      await waitFor(() => expect(api.getServerProfiles).toHaveBeenCalled());
      expect(lastQuery()).toMatchObject({ tags: ['prod'], health: 'unreachable', page: 1 });
    });

    it('applies the Home tiles\' host-key link and a repeated tag', async () => {
      renderPage('/servers?hostKey=untrusted&tag=prod&tag=web&owner=shared');
      await waitFor(() => expect(lastQuery()).toMatchObject({ hostKey: 'untrusted', tags: ['prod', 'web'], owner: 'shared' }));
    });

    it('drops a value outside its vocabulary instead of sending it', async () => {
      renderPage('/servers?health=sideways&hostKey=maybe');
      await waitFor(() => expect(api.getServerProfiles).toHaveBeenCalled());
      expect(lastQuery()).not.toHaveProperty('health');
      expect(lastQuery()).not.toHaveProperty('hostKey');
    });

    it('writes a chosen filter into the URL and reloads with it', async () => {
      const user = userEvent.setup();
      renderPage();
      await screen.findByText('Server A');

      await user.click(screen.getByRole('combobox', { name: 'Health' }));
      await user.click(await screen.findByRole('option', { name: 'Unreachable' }));

      await waitFor(() => expect(search().get('health')).toBe('unreachable'));
      await waitFor(() => expect(lastQuery()).toMatchObject({ health: 'unreachable' }));
    });

    it('filters by a tag when its chip is clicked', async () => {
      const user = userEvent.setup();
      renderPage();
      const row = (await screen.findByText('Server B')).closest('[role="row"]') as HTMLElement;
      await user.click(within(row).getByRole('button', { name: 'web' }));
      await waitFor(() => expect(search().getAll('tag')).toEqual(['web']));
    });

    it('keeps the sort in the URL', async () => {
      const user = userEvent.setup();
      renderPage('/servers?sort=health&order=desc');
      await waitFor(() => expect(lastQuery()).toMatchObject({ sort: 'health', order: 'desc' }));
      await user.click(await screen.findByRole('columnheader', { name: /Name/ }));
      await waitFor(() => expect(search().get('sort')).toBe('name'));
    });
  });

  describe('the table', () => {
    it('shows health, host key, owner and the last check, never colour alone', async () => {
      renderPage();
      await screen.findByText('Server A');
      const health = screen.getAllByTestId('server-health');
      expect(health.map((cell) => cell.getAttribute('data-health'))).toEqual(['reachable', 'unreachable', 'unknown']);
      expect(health[0]).toHaveTextContent('Reachable');
      const keys = screen.getAllByTestId('host-key-status');
      expect(keys[0]).toHaveTextContent('Trusted');
      expect(keys[1]).toHaveTextContent('Not trusted');
      expect(screen.getAllByTestId('owner-chip').map((chip) => chip.textContent)).toEqual(['You', 'You', 'Person B']);
    });

    it('shows a changed key as Mismatch', async () => {
      api.getServerProfiles.mockResolvedValue({
        items: [{ ...alpha, hostKeyState: 'mismatch' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      renderPage();
      expect(await screen.findByTestId('host-key-status')).toHaveTextContent('Mismatch');
    });

    it('offers only what the caller may do on a row', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Row actions for Server C' }));
      const menu = await screen.findByRole('menu');
      expect(within(menu).getByRole('menuitem', { name: /Edit/ })).toHaveAttribute('aria-disabled', 'true');
      expect(within(menu).getByRole('menuitem', { name: /Share/ })).toHaveAttribute('aria-disabled', 'true');
      expect(within(menu).getByRole('menuitem', { name: /Delete/ })).toHaveAttribute('aria-disabled', 'true');
      expect(within(menu).getByRole('menuitem', { name: /Test connection/ })).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('connects: a new session, then the session page', async () => {
      const user = userEvent.setup();
      api.createSession.mockResolvedValue({ id: 'sess-1' } as never);
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Row actions for Server A' }));
      await user.click(await screen.findByRole('menuitem', { name: /Connect/ }));
      expect(api.createSession).toHaveBeenCalledWith({ serverProfileId: 'srv-a' });
      await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/sessions/sess-1'));
    });

    it('opens the share dialog of the row', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Row actions for Server A' }));
      await user.click(await screen.findByRole('menuitem', { name: /Share/ }));
      expect(await screen.findByTestId('share-dialog')).toHaveTextContent('server_profile:srv-a');
    });

    it('opens the host-key dialog on a refused test and tests again after trust', async () => {
      const user = userEvent.setup();
      api.testServerProfile
        .mockResolvedValueOnce({
          success: false,
          error: 'Host key not trusted',
          code: 'HOST_KEY_UNKNOWN',
          presented: { fingerprint: PRESENTED, algorithm: 'ssh-ed25519' },
          expected: null,
        })
        .mockResolvedValueOnce({ success: true });
      api.trustHostKey.mockResolvedValue({ ...bravo, fingerprint: PRESENTED });
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Row actions for Server B' }));
      await user.click(await screen.findByRole('menuitem', { name: /Test connection/ }));

      const dialog = await screen.findByTestId('host-key-dialog');
      expect(within(dialog).getByTestId('host-key-presented')).toHaveTextContent(PRESENTED);
      await user.click(within(dialog).getByRole('button', { name: 'Trust and test' }));

      expect(api.trustHostKey).toHaveBeenCalledWith('srv-b', PRESENTED, undefined);
      await waitFor(() => expect(api.testServerProfile).toHaveBeenCalledTimes(2));
      expect(await screen.findByText('Connection successful')).toBeInTheDocument();
    });

    it('reloads the list after a test, so the health column updates', async () => {
      const user = userEvent.setup();
      api.testServerProfile.mockResolvedValue({ success: false, error: 'Connection refused' });
      renderPage();
      await screen.findByText('Server A');
      const before = api.getServerProfiles.mock.calls.length;
      await user.click(screen.getByRole('button', { name: 'Row actions for Server A' }));
      await user.click(await screen.findByRole('menuitem', { name: /Test connection/ }));
      expect(await screen.findByText('Connection refused')).toBeInTheDocument();
      expect(api.getServerProfiles.mock.calls.length).toBeGreaterThan(before);
    });

    it('opens the detail drawer from the name, with the recent sessions of that server', async () => {
      const user = userEvent.setup();
      renderPage();
      await user.click(await screen.findByRole('button', { name: 'Server B' }));
      const drawer = await screen.findByTestId('server-detail-drawer');
      expect(within(drawer).getByText('srv-b.example.test:22')).toBeInTheDocument();
      expect(api.getSessions).toHaveBeenCalledWith({ serverProfileId: 'srv-b', pageSize: 5 });
      expect(await within(drawer).findByText('No sessions on this server yet.')).toBeInTheDocument();
    });

    it('opens the create dialog for ?new=1 and drops the flag', async () => {
      renderPage('/servers?new=1');
      expect(await screen.findByRole('dialog', { name: /server profile/i })).toBeInTheDocument();
      await waitFor(() => expect(search().has('new')).toBe(false));
    });
  });

  describe('bulk actions', () => {
    it('opens the run dialog with exactly the 3 selected targets and a dry-run option', async () => {
      const user = userEvent.setup();
      runbooks.previewRunbookTargets.mockResolvedValue({
        servers: [{ id: 'srv-a', name: 'Server A', hostname: 'a' }, { id: 'srv-b', name: 'Server B', hostname: 'b' }],
        skipped: [{ serverProfileId: 'srv-c', reason: 'no_connect_access' }],
        total: 2,
        capped: false,
        limit: 500,
      });
      renderPage();
      await selectRows(user, ['Server A', 'Server B', 'Server C']);
      await user.click(screen.getByRole('button', { name: 'Run runbook on selected…' }));

      const dialog = await screen.findByRole('dialog', { name: 'Run runbook on selected' });
      expect(within(dialog).getByTestId('run-runbook-target-count')).toHaveTextContent('3 targets');
      const targets = within(dialog).getByTestId('run-runbook-targets').querySelectorAll('[data-server-id]');
      expect([...targets].map((chip) => chip.getAttribute('data-server-id'))).toEqual(['srv-a', 'srv-b', 'srv-c']);
      expect(within(dialog).getByRole('switch', { name: 'Dry run' })).toBeChecked();

      await user.click(within(dialog).getByRole('combobox', { name: 'Runbook' }));
      await user.click(await screen.findByRole('option', { name: 'Patch kernel' }));
      await user.click(within(dialog).getByTestId('run-runbook-submit'));

      expect(runbooks.previewRunbookTargets).toHaveBeenCalledWith(['srv-a', 'srv-b', 'srv-c']);
      expect(await within(dialog).findByTestId('run-runbook-preview')).toHaveTextContent('reach 2 of 3 servers');
      expect(runbooks.startRunbookRun).not.toHaveBeenCalled();
    });

    it('hides "Run runbook on selected" without runbooks:run', async () => {
      const user = userEvent.setup();
      renderPage('/servers', noRunbooks);
      await selectRows(user, ['Server A']);
      expect(screen.getByRole('button', { name: 'Test connection' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Run runbook on selected…' })).not.toBeInTheDocument();
    });

    it('adds a tag to the selection and reports the servers the caller cannot change', async () => {
      const user = userEvent.setup();
      api.bulkTagServerProfiles.mockResolvedValue({ updated: ['srv-a'], unchanged: [], denied: ['srv-c'] });
      renderPage();
      await selectRows(user, ['Server A', 'Server C']);
      await user.click(screen.getByRole('button', { name: 'Add or remove tag' }));
      const dialog = await screen.findByRole('dialog', { name: /Tags on 2 servers/ });
      await user.type(within(dialog).getByLabelText('Tags to add'), 'eu-west{Enter}');
      await user.click(within(dialog).getByRole('button', { name: 'Add tags' }));

      expect(api.bulkTagServerProfiles).toHaveBeenCalledWith({ ids: ['srv-a', 'srv-c'], add: ['eu-west'] });
      const result = await within(dialog).findByTestId('bulk-tag-result');
      expect(result).toHaveTextContent('1 changed, 0 already as asked, 1 you cannot change');
      expect(within(result).getByText('Server C')).toBeInTheDocument();
    });

    it('deletes what it may after a confirmation with the count, and reports the rest', async () => {
      const user = userEvent.setup();
      api.deleteServerProfile.mockResolvedValue(undefined);
      renderPage();
      await selectRows(user, ['Server A', 'Server B', 'Server C']);
      await user.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog', { name: 'Delete 2 servers?' });
      expect(within(dialog).getByTestId('bulk-delete-refused')).toHaveTextContent('Server C');
      await user.click(within(dialog).getByRole('button', { name: 'Delete 2' }));

      await waitFor(() => expect(api.deleteServerProfile).toHaveBeenCalledTimes(2));
      expect(api.deleteServerProfile.mock.calls.map(([id]) => id).sort()).toEqual(['srv-a', 'srv-b']);
      expect(await within(dialog).findByTestId('bulk-delete-result')).toHaveTextContent('2 deleted, 1 not deleted');
    });

    it('tests the selection with a progress list', async () => {
      const user = userEvent.setup();
      api.testServerProfile.mockImplementation(async (id: string) =>
        id === 'srv-b' ? { success: false, error: 'Connection refused' } : { success: true },
      );
      renderPage();
      await selectRows(user, ['Server A', 'Server B']);
      await user.click(screen.getByRole('button', { name: 'Test connection' }));
      await waitFor(() => expect(screen.getByTestId('bulk-item-srv-b')).toHaveAttribute('data-state', 'failed'));
      expect(screen.getByTestId('bulk-item-srv-a')).toHaveAttribute('data-state', 'ok');
      expect(api.testServerProfile).toHaveBeenCalledTimes(2);
    });
  });

  describe('at phone width', () => {
    it('renders the servers as cards', async () => {
      setContainerWidth(360);
      renderPage();
      const cards = await screen.findAllByTestId('datatable-card');
      expect(cards).toHaveLength(3);
      expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    });
  });
});
