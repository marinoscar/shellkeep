// "Run runbook on selected" once the run route is served (#79, #62): the run starts on exactly the
// selected servers; while it is not, the start is disabled and says why.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import type { ServerProfile } from '../../../types';

vi.mock('../../../services/runbooks-api', () => ({
  listRunbooks: vi.fn(),
  previewRunbookTargets: vi.fn(),
  startRunbookRun: vi.fn(),
}));

import * as runbooksApi from '../../../services/runbooks-api';
import { RunRunbookDialog, RUNBOOK_RUNS_UNAVAILABLE_REASON } from '../../../components/server-profiles/RunRunbookDialog';

const runbooks = vi.mocked(runbooksApi);
const servers = ['srv-1', 'srv-2', 'srv-3'].map(
  (id) => ({ id, name: `Server ${id}`, tags: [] }) as unknown as ServerProfile,
);

async function pickRunbook(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('combobox', { name: 'Runbook' }));
  await user.click(await screen.findByRole('option', { name: 'Rotate logs' }));
}

describe('RunRunbookDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runbooks.listRunbooks.mockResolvedValue({
      items: [{ id: 'rb-9', name: 'Rotate logs', description: null, tags: [], latestVersion: { version: 2 } }],
      total: 1,
    });
  });

  it('starts a run on exactly the selected servers when runs are available', async () => {
    const user = userEvent.setup();
    const onStarted = vi.fn();
    runbooks.startRunbookRun.mockResolvedValue({ runId: 'run-1' });
    render(<RunRunbookDialog open profiles={servers} onClose={vi.fn()} onStarted={onStarted} runsAvailable />);

    const dryRun = screen.getByRole('switch', { name: 'Dry run' });
    expect(dryRun).not.toBeChecked();
    await pickRunbook(user);
    await user.click(screen.getByRole('button', { name: 'Run on 3 servers' }));

    expect(runbooks.startRunbookRun).toHaveBeenCalledWith('rb-9', ['srv-1', 'srv-2', 'srv-3']);
    expect(await screen.findByTestId('run-runbook-started')).toHaveTextContent('run-1');
    expect(onStarted).toHaveBeenCalledWith('run-1');
  });

  it('offers only the dry run while the run route is not served', async () => {
    render(<RunRunbookDialog open profiles={servers} onClose={vi.fn()} runsAvailable={false} />);
    const dryRun = screen.getByRole('switch', { name: 'Dry run' });
    expect(dryRun).toBeChecked();
    expect(dryRun).toBeDisabled();
    expect(within(screen.getByRole('dialog')).getByTestId('run-runbook-submit')).toHaveTextContent('Preview targets');
    expect(RUNBOOK_RUNS_UNAVAILABLE_REASON).toMatch(/not available/);
  });
});
