import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';

import { ServersUserDataPurgeHandler } from './servers-purge.handler';

const USER = '9d5b1c34-1c3e-4e53-a1d3-0d7c9a1f1b04';

function build(failKey?: string) {
  const order: string[] = [];
  const archives = [{ storageKey: 'file-archives/o/a/archive.tar.gz' }, { storageKey: null }, { storageKey: 'file-archives/o/b/archive.tar.gz' }];
  const db = {
    runAsSystem: async (_reason: string, fn: (t: unknown) => Promise<unknown>) =>
      fn({
        fileArchive: {
          findMany: async () => archives.filter((a) => a.storageKey),
          deleteMany: async () => (order.push('rows'), { count: 3 }),
        },
        serverProfile: { findMany: async () => [], deleteMany: async () => ({ count: 0 }) },
      }),
  };
  const storage = {
    deleteMany: async (keys: string[]) => {
      order.push(`objects:${keys.length}`);
      return { deleted: keys.filter((k) => k !== failKey), failed: keys.filter((k) => k === failKey).map((key) => ({ key, message: 'denied' })) };
    },
    delete: async () => undefined,
  };
  const credentials = { list: async () => [], deleteSecret: async () => undefined };
  return { handler: new ServersUserDataPurgeHandler(new JobHandlerRegistry(), credentials as never, db as never, storage as never), order };
}

describe('servers.user_data.purge and folder archives (#158)', () => {
  it('deletes the archive objects BEFORE their rows', async () => {
    const { handler, order } = build();
    const result = await handler.purge(USER);
    expect(order).toEqual(['objects:2', 'rows']);
    expect(result.archiveObjects).toBe(2);
  });

  it('keeps the rows (and throws, so the job retries) when an object cannot be deleted', async () => {
    const { handler, order } = build('file-archives/o/b/archive.tar.gz');
    await expect(handler.purge(USER)).rejects.toThrow(/1 archive object/);
    expect(order).toEqual(['objects:2']);
  });
});
