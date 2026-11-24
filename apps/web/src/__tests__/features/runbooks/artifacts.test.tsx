import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { axe } from 'vitest-axe';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import { ArtifactsPanel } from '../../../features/runbooks/components/ArtifactsPanel';
import { PublicRunBundle } from '../../../features/runbooks/components/PublicRunBundle';
import { BUNDLE_POLL_MS } from '../../../features/runbooks/hooks/useRunArtifacts';
import { RUN_ID, runbookUser } from './fixtures';

/** Assembled at run time: a presigned URL is a credential, so no URL-shaped literal sits in the source. */
const SIGNED = ['https://storage.example.test', 'signed', Math.random().toString(36).slice(2, 10)].join('/');

const ARCHIVE = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  kind: 'target_archive' as const,
  runTargetId: 't1',
  runStepId: 's1',
  serverName: 'server-a',
  stepId: 'logs',
  stepIndex: 1,
  fileCount: 3,
  sizeBytes: 2048,
  sha256: 'a'.repeat(64),
  createdAt: '2026-01-01T00:00:00.000Z',
};
const BUNDLE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const none = { status: 'none', artifactId: null, sizeBytes: null, createdAt: null };
const ready = { status: 'ready', artifactId: BUNDLE_ID, sizeBytes: 5 * 1024 * 1024, createdAt: '2026-01-01T00:00:00.000Z' };

function serve(list: () => unknown) {
  server.use(http.get(`*/api/runbook-runs/${RUN_ID}/artifacts`, () => HttpResponse.json({ data: list() })));
}

const renderPanel = (props: Partial<Parameters<typeof ArtifactsPanel>[0]> = {}) =>
  render(<ArtifactsPanel runId={RUN_ID} runbookName="Patch web tier" finished canShare={false} {...props} />, {
    wrapperOptions: { user: runbookUser(['runbooks:read', 'sharing:write']) },
  });

let clicks: string[];
beforeEach(() => {
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this.href);
  });
});
afterEach(() => vi.restoreAllMocks());

describe('ArtifactsPanel', () => {
  it('lists the archives by server and downloads one through a signed URL, never logging it', async () => {
    serve(() => ({ items: [ARCHIVE], bundle: none }));
    server.use(
      http.get(`*/api/runbook-runs/${RUN_ID}/artifacts/${ARCHIVE.id}/download`, () =>
        HttpResponse.json({ data: { url: SIGNED, expiresAt: new Date(Date.now() + 900_000).toISOString() } }),
      ),
    );
    const logged: unknown[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args));
    }
    const user = userEvent.setup();
    renderPanel();

    expect(await screen.findByText('server-a')).toBeInTheDocument();
    expect(screen.getByText(/3 files/)).toBeInTheDocument();
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download the archive of server-a' }));
    await waitFor(() => expect(clicks).toEqual([SIGNED]));
    expect(JSON.stringify(logged)).not.toContain(SIGNED);
  });

  it('says so when nothing was collected, and offers no bundle before the run finished', async () => {
    serve(() => ({ items: [], bundle: none }));
    renderPanel({ finished: false });
    expect(await screen.findByText(/No logs were collected/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Build bundle' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Share link/ })).not.toBeInTheDocument();
  });

  it('builds the bundle, polls while it is building, then offers the download', async () => {
    let status: 'none' | 'building' | 'ready' = 'none';
    let reads = 0;
    serve(() => {
      reads += 1;
      return { items: [ARCHIVE], bundle: status === 'ready' ? ready : status === 'building' ? { ...none, status: 'building' } : none };
    });
    server.use(
      http.post(`*/api/runbook-runs/${RUN_ID}/artifacts/bundle`, () => {
        status = 'building';
        return HttpResponse.json({ data: { jobId: 'job-1', artifactId: null } }, { status: 202 });
      }),
      http.get(`*/api/runbook-runs/${RUN_ID}/artifacts/${BUNDLE_ID}/download`, () =>
        HttpResponse.json({ data: { url: SIGNED, expiresAt: new Date(Date.now() + 900_000).toISOString() } }),
      ),
    );
    const user = userEvent.setup();
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Build bundle' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Building the bundle');
    expect(screen.queryByRole('button', { name: 'Build bundle' })).not.toBeInTheDocument();

    // the build finishes on the server; the next poll shows it
    const before = reads;
    status = 'ready';
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download bundle' })).toBeInTheDocument(), { timeout: BUNDLE_POLL_MS + 3000 });
    expect(reads).toBeGreaterThan(before);
    expect(screen.getByText(/5\.0 MB/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Download bundle' }));
    await waitFor(() => expect(clicks).toEqual([SIGNED]));
  }, 20_000);

  it('shows "Share link…" only to the person who may share, and creates a link in a link-only dialog', async () => {
    serve(() => ({ items: [ARCHIVE], bundle: ready }));
    let created: Record<string, unknown> | null = null;
    server.use(
      http.get('*/api/grants/links', () => HttpResponse.json({ data: { items: [], total: 0, page: 1, pageSize: 20 } })),
      http.post('*/api/grants/links', async ({ request }) => {
        created = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(
          { data: { grant: { id: 'g1', expiresAt: null }, url: 'https://app.example.test/s#lnk_fake', token: 'lnk_fake' } },
          { status: 201 },
        );
      }),
    );
    const user = userEvent.setup();
    const { unmount } = renderPanel({ canShare: false });
    await screen.findByRole('button', { name: 'Download bundle' });
    expect(screen.queryByRole('button', { name: /Share link/ })).not.toBeInTheDocument();
    unmount();

    renderPanel({ canShare: true });
    await user.click(await screen.findByRole('button', { name: /Share link/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Patch web tier');
    // link mode only: no people or group sharing
    expect(screen.queryByLabelText('E-mail address')).not.toBeInTheDocument();
    expect((await axe(dialog)).violations).toEqual([]);

    await user.click(screen.getByRole('button', { name: 'Create link' }));
    expect(await screen.findByLabelText('Share link')).toHaveValue('https://app.example.test/s#lnk_fake');
    expect(created).toMatchObject({ resourceType: 'runbook_run', resourceId: RUN_ID, role: 'viewer' });
    const days = (new Date(String(created!.expiresAt)).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it('reports an error from the API in an alert', async () => {
    server.use(http.get(`*/api/runbook-runs/${RUN_ID}/artifacts`, () => HttpResponse.json({ message: 'Run not found' }, { status: 404 })));
    renderPanel();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('PublicRunBundle (the /s landing of a runbook_run link)', () => {
  const resolution = { resourceType: 'runbook_run', resourceId: RUN_ID, role: 'viewer', expiresAt: null, title: 'Patch web tier' };

  it('sends the token in a header only, shows the bundle and downloads it', async () => {
    const get = vi.fn().mockResolvedValue({
      runbook: 'Patch web tier',
      finishedAt: '2026-01-01T00:00:00.000Z',
      sizeBytes: 3 * 1024 * 1024,
      url: SIGNED,
      urlExpiresAt: new Date(Date.now() + 900_000).toISOString(),
    });
    const user = userEvent.setup();
    render(<PublicRunBundle resolution={resolution as never} token="lnk_secret_token" apiClient={{ get } as never} />);
    expect(await screen.findByRole('heading', { name: 'Patch web tier' })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/public/runbook-runs/bundle', { headers: { 'x-link-token': 'lnk_secret_token' } });
    expect(get.mock.calls[0]![0]).not.toContain('lnk_');
    expect(screen.getByText(/3\.0 MB/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download' }));
    expect(clicks).toEqual([SIGNED]);
  });

  it('shows one neutral message when the link cannot be resolved', async () => {
    const get = vi.fn().mockRejectedValue(new Error('404'));
    render(<PublicRunBundle resolution={resolution as never} token="lnk_x" apiClient={{ get } as never} />);
    expect(await screen.findByText('This link is not available.')).toBeInTheDocument();
    await act(async () => undefined);
  });
});
