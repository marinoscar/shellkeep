import { afterEach, describe, it, expect, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import {
  StorageObjectNotReadyError,
  type StorageObject,
} from '@marinoscar/platform-web/storage/headless';
import { server } from '../mocks/server';
import { storageErrorMessage, storageObjects, uploadPastedImage } from '../../services/storage';

/**
 * The pasted-image flow over the platform's objects client (#50): a simple
 * multipart upload, a wait until the object is `ready`, then its signed URL.
 * The multipart POST itself is the package's (jsdom's `Blob` cannot cross
 * Node's `fetch`), so the upload is stubbed on the client.
 */

function object(status: string) {
  return {
    id: 'object-1',
    name: 'clipboard-1.png',
    size: 4,
    mimeType: 'image/png',
    status,
    metadata: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('uploadPastedImage (#50)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('uploads the file, waits until ready and returns the signed URL', async () => {
    const upload = vi
      .spyOn(storageObjects, 'upload')
      .mockResolvedValue(object('processing') as StorageObject);
    const get = vi.spyOn(storageObjects, 'get').mockResolvedValue(object('ready') as StorageObject);
    const downloadUrl = vi
      .spyOn(storageObjects, 'downloadUrl')
      .mockResolvedValue({ url: 'https://objects.example.test/signed', expiresIn: 3600 });
    const file = new Blob(['abcd'], { type: 'image/png' });

    const url = await uploadPastedImage(file, 'clipboard-1.png');

    expect(url).toBe('https://objects.example.test/signed');
    expect(upload).toHaveBeenCalledWith(file, 'clipboard-1.png');
    expect(get).toHaveBeenCalledWith('object-1');
    expect(downloadUrl).toHaveBeenCalledWith('object-1');
  });

  it('downloads through the objects route of the platform client', async () => {
    server.use(
      http.get('*/api/storage/objects/object-1/download', () =>
        HttpResponse.json({ data: { url: 'https://objects.example.test/signed', expiresIn: 3600 } }),
      ),
    );
    await expect(storageObjects.downloadUrl('object-1')).resolves.toEqual({
      url: 'https://objects.example.test/signed',
      expiresIn: 3600,
    });
  });

  it('rejects with the API error while storage is not configured', async () => {
    server.use(
      http.get('*/api/storage/objects/object-1', () =>
        HttpResponse.json(
          {
            statusCode: 503,
            message: 'Object storage is not configured for this deployment.',
            details: { reason: 'storage_not_configured' },
          },
          { status: 503 },
        ),
      ),
    );

    vi.spyOn(storageObjects, 'upload').mockResolvedValue(object('processing') as StorageObject);
    const error = await uploadPastedImage(new Blob(['abcd']), 'clipboard-1.png').catch((e) => e);
    expect(error).toMatchObject({ status: 503 });
    expect(storageErrorMessage(error, 'fallback')).toMatch(/not configured yet.*Settings → Storage/);
  });
});

describe('storageErrorMessage (#50)', () => {
  it('names the missing permission on a 403', () => {
    expect(storageErrorMessage({ status: 403, message: 'Forbidden' }, 'fallback')).toBe(
      'You do not have permission to upload files.',
    );
  });

  it('passes a processing failure through', () => {
    expect(storageErrorMessage(new StorageObjectNotReadyError('object-1', 'failed'), 'fallback')).toBe(
      'The uploaded file could not be processed.',
    );
  });

  it('uses the error message, then the fallback', () => {
    expect(storageErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(storageErrorMessage('nope', 'fallback')).toBe('fallback');
  });
});
