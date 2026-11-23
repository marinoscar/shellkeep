import { Readable } from 'node:stream';
import { STORAGE_PROVIDER, StorageProviderRouter, type StorageProvider } from '@marinoscar/platform-api/storage';

import type { TestContext } from './test-app.helper';

/** An in-memory-free storage provider double: every call is a jest mock with a plausible answer. */
export function createMockStorageProvider() {
  return {
    kind: 's3',
    getBucket: jest.fn().mockReturnValue('test-bucket'),
    upload: jest.fn().mockImplementation(async (key: string, stream: Readable) => {
      let size = 0;
      for await (const chunk of stream) size += (chunk as Buffer).length;
      return { key, size, etag: 'etag-simple' };
    }),
    initMultipartUpload: jest.fn().mockResolvedValue({ uploadId: 'upload-1' }),
    getSignedUploadUrl: jest.fn().mockResolvedValue('https://storage.example.test/part'),
    completeMultipartUpload: jest.fn().mockImplementation(async (key: string) => ({ key, size: 0, etag: 'etag-multi' })),
    abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
    download: jest.fn().mockResolvedValue(Readable.from([])),
    getSignedDownloadUrl: jest.fn().mockResolvedValue('https://storage.example.test/download'),
    getSignedPutUrl: jest.fn().mockResolvedValue('https://storage.example.test/put'),
    delete: jest.fn().mockResolvedValue(undefined),
    getMetadata: jest.fn().mockResolvedValue(null),
    setMetadata: jest.fn().mockResolvedValue(undefined),
    exists: jest.fn().mockResolvedValue(true),
  };
}

/**
 * Makes `mock` the storage provider of a booted test app: the active `STORAGE_PROVIDER`
 * answers with its methods, and the per-row router hands it back for every recorded
 * provider, as a configured deployment would.
 */
export function installMockStorageProvider(context: TestContext, mock: ReturnType<typeof createMockStorageProvider>): void {
  const token = context.module.get(STORAGE_PROVIDER, { strict: false }) as StorageProvider | undefined;
  if (token) {
    const { kind: _kind, ...methods } = mock;
    Object.assign(token, methods, { resolveCurrent: async () => mock });
  }
  const router = context.module.get(StorageProviderRouter, { strict: false });
  if (router) {
    router.forLocation = async () => mock as unknown as StorageProvider;
    router.forObject = async () => mock as unknown as StorageProvider;
  }
}
