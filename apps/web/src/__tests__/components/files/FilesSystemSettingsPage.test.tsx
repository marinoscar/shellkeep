import { describe, it, expect, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { mockSystemSettings } from '../../mocks/data';
import { render, mockAdminUser } from '../../utils/test-utils';
import { FilesSystemSettingsPage } from '../../../components/files/settings/FilesSystemSettingsPage';

const MB = 1024 * 1024;
const GB = 1024 * MB;

const readOnlyAdmin = {
  ...mockAdminUser,
  permissions: mockAdminUser.permissions.filter((p) => p !== 'system_settings:write'),
};

describe('FilesSystemSettingsPage (#153)', () => {
  let patched: unknown[];

  beforeEach(() => {
    patched = [];
    server.use(
      http.patch('*/api/system-settings', async ({ request }) => {
        const body = await request.json();
        patched.push(body);
        return HttpResponse.json({
          data: { ...mockSystemSettings, ...(body as object), version: mockSystemSettings.version + 1 },
        });
      }),
    );
  });

  it('shows the API defaults in readable units while the namespace is not stored', async () => {
    render(<FilesSystemSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(await screen.findByLabelText('Full view limit')).toHaveValue(2);
    expect(screen.getByLabelText('Full view limit unit')).toHaveTextContent('MB');
    expect(screen.getByLabelText('Paged view limit')).toHaveValue(200);
    expect(screen.getByLabelText('Download limit')).toHaveValue(2);
    expect(screen.getByLabelText('Download limit unit')).toHaveTextContent('GB');
    expect(screen.getByLabelText('Upload limit')).toHaveValue(100);
    expect(screen.getByLabelText('SFTP read timeout (seconds)')).toHaveValue(30);
    expect(screen.getByLabelText('Concurrent downloads, per user')).toHaveValue(3);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a stored namespace', async () => {
    server.use(
      http.get('*/api/system-settings', () =>
        HttpResponse.json({
          data: { ...mockSystemSettings, files: { fullViewMaxBytes: 512 * 1024, downloadsPerMinute: 7 } },
        }),
      ),
    );
    render(<FilesSystemSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    expect(await screen.findByLabelText('Full view limit')).toHaveValue(512);
    expect(screen.getByLabelText('Full view limit unit')).toHaveTextContent('KB');
    expect(screen.getByLabelText('Downloads per minute, per user')).toHaveValue(7);
  });

  it('saves the whole namespace in bytes, with a changed unit', async () => {
    const user = userEvent.setup();
    render(<FilesSystemSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    const download = await screen.findByLabelText('Download limit');
    await user.clear(download);
    await user.type(download, '5');
    await user.click(screen.getByLabelText('Upload limit unit'));
    await user.click(await screen.findByRole('option', { name: 'GB' }));
    const upload = screen.getByLabelText('Upload limit');
    await user.clear(upload);
    await user.type(upload, '1');
    const perMinute = screen.getByLabelText('Downloads per minute, per user');
    await user.clear(perMinute);
    await user.type(perMinute, '40');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(patched).toHaveLength(1));
    expect(patched[0]).toEqual({
      files: {
        fullViewMaxBytes: 2 * MB,
        pagedViewMaxBytes: 200 * MB,
        downloadMaxBytes: 5 * GB,
        uploadMaxBytes: 1 * GB,
        sftpTimeoutSeconds: 30,
        contentRequestsPerMinute: 120,
        downloadsPerMinute: 40,
        maxConcurrentDownloads: 3,
      },
    });
    expect(await screen.findByText('Files settings saved')).toBeInTheDocument();
  });

  it('refuses a value that is not a positive whole number', async () => {
    const user = userEvent.setup();
    render(<FilesSystemSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    const upload = await screen.findByLabelText('Upload limit');
    await user.clear(upload);
    await user.type(upload, '0');
    expect(screen.getByText('Enter a whole number greater than 0.')).toBeInTheDocument();

    const concurrent = screen.getByLabelText('Concurrent downloads, per user');
    await user.clear(concurrent);
    await user.type(concurrent, '1.5');
    expect(screen.getByText('Enter a whole number from 1 to 50.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(patched).toHaveLength(0);
  });

  it('refuses a size outside the API bounds', async () => {
    const user = userEvent.setup();
    render(<FilesSystemSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    const full = await screen.findByLabelText('Full view limit');
    await user.clear(full);
    await user.type(full, '32');
    expect(screen.getByText('Enter a size from 64 KB to 16 MB.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('requires full view <= paged view <= download', async () => {
    const user = userEvent.setup();
    render(<FilesSystemSettingsPage />, { wrapperOptions: { user: mockAdminUser } });

    const paged = await screen.findByLabelText('Paged view limit');
    await user.clear(paged);
    await user.type(paged, '1');
    expect(screen.getByText('Must not be larger than the paged view limit.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(paged);
    await user.type(paged, '1500');
    await user.click(screen.getByLabelText('Download limit unit'));
    await user.click(await screen.findByRole('option', { name: 'MB' }));
    expect(screen.queryByText('Must not be larger than the paged view limit.')).not.toBeInTheDocument();
    expect(screen.getByText('Must not be larger than the download limit.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(patched).toHaveLength(0);
  });

  it('is read-only without system_settings:write', async () => {
    render(<FilesSystemSettingsPage />, { wrapperOptions: { user: readOnlyAdmin } });

    expect(await screen.findByLabelText('Full view limit')).toBeDisabled();
    expect(screen.getByLabelText('SFTP read timeout (seconds)')).toBeDisabled();
    expect(screen.getByLabelText('Full view limit unit')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/\(read-only\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
