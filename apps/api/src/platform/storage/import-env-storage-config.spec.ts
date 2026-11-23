import {
  hasRuntimeStorageConfig,
  planStorageImport,
  readLegacyStorageEnv,
  runStorageEnvImport,
} from './import-env-storage-config';

const SECRET = 'wJalrXUtnFEMI-secret-value-never-printed';

const fullEnv = {
  STORAGE_PROVIDER: 's3',
  S3_BUCKET: 'bucket-a',
  S3_REGION: 'eu-west-1',
  AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE1234',
  AWS_SECRET_ACCESS_KEY: SECRET,
} as NodeJS.ProcessEnv;

const empty = { drivers: {}, bucket: '', descriptors: [] } as never;

function harness(options: { current?: unknown; actor?: string | null; env?: NodeJS.ProcessEnv; argv?: string[] } = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const admin = {
    describeForAdmin: jest.fn().mockResolvedValue(options.current ?? empty),
    replace: jest.fn().mockResolvedValue({}),
  };
  const run = () =>
    runStorageEnvImport({
      env: options.env ?? fullEnv,
      argv: options.argv ?? [],
      admin: admin as never,
      resolveActor: async () => (options.actor === undefined ? 'user-1' : options.actor),
      io: { stdout: (t) => out.push(t), stderr: (t) => err.push(t) },
    });
  return { admin, out, err, run };
}

describe('storage:import-env', () => {
  describe('planStorageImport', () => {
    it('maps AWS variables to the s3 driver', () => {
      const plan = planStorageImport(readLegacyStorageEnv(fullEnv));
      expect(plan).toMatchObject({
        kind: 'plan',
        input: {
          provider: 's3',
          drivers: { s3: { bucket: 'bucket-a', region: 'eu-west-1', accessKeyId: 'AKIAEXAMPLE1234' } },
          secrets: { s3: { secretAccessKey: SECRET } },
        },
      });
    });

    it('maps S3_ENDPOINT to the s3compatible driver (the old provider used path style there)', () => {
      const plan = planStorageImport(readLegacyStorageEnv({ ...fullEnv, S3_ENDPOINT: 'http://minio.example.test:9000' }));
      expect(plan).toMatchObject({ kind: 'plan', input: { provider: 's3compatible' } });
    });

    it.each([[{}], [{ S3_BUCKET: 'your-bucket-name' }]])('has nothing to import for %j', (env) => {
      expect(planStorageImport(readLegacyStorageEnv(env as NodeJS.ProcessEnv)).kind).toBe('nothing');
    });

    it('rejects a provider the old build never supported', () => {
      expect(planStorageImport(readLegacyStorageEnv({ ...fullEnv, STORAGE_PROVIDER: 'azure' })).kind).toBe('invalid');
    });

    it('reports an ignored part size', () => {
      const plan = planStorageImport(readLegacyStorageEnv({ ...fullEnv, STORAGE_PART_SIZE: '20971520' }));
      expect(plan.kind === 'plan' && plan.notes.join()).toContain('STORAGE_PART_SIZE');
    });
  });

  describe('hasRuntimeStorageConfig', () => {
    it('is false for the unconfigured defaults', () => {
      expect(hasRuntimeStorageConfig({ bucket: '', drivers: { s3: { bucket: '' } }, descriptors: [] } as never)).toBe(false);
    });
    it('is true for a bucket on any driver or a stored secret', () => {
      expect(hasRuntimeStorageConfig({ bucket: '', drivers: { r2: { bucket: 'x' } }, descriptors: [] } as never)).toBe(true);
      expect(
        hasRuntimeStorageConfig({
          bucket: '',
          drivers: {},
          descriptors: [{ fields: [{ kind: 'secret', hasValue: true }] }],
        } as never),
      ).toBe(true);
    });
  });

  describe('runStorageEnvImport', () => {
    it('writes through the configuration service and prints no secret', async () => {
      const h = harness();
      expect(await h.run()).toBe(0);
      expect(h.admin.replace).toHaveBeenCalledTimes(1);
      expect(h.admin.replace.mock.calls[0][1]).toBe('user-1');
      const printed = [...h.out, ...h.err].join('');
      expect(printed).not.toContain(SECRET);
      expect(printed).toContain('secret access key: set');
      expect(printed).toContain('...1234');
    });

    it('refuses when a runtime configuration exists and writes nothing', async () => {
      const h = harness({ current: { bucket: 'already', drivers: {}, descriptors: [] } });
      expect(await h.run()).toBe(1);
      expect(h.admin.replace).not.toHaveBeenCalled();
      expect(h.err.join('')).toContain('refused');
    });

    it('writes nothing on a dry run', async () => {
      const h = harness({ argv: ['--dry-run'] });
      expect(await h.run()).toBe(0);
      expect(h.admin.replace).not.toHaveBeenCalled();
      expect(h.out.join('')).not.toContain(SECRET);
    });

    it('exits 1 without touching the service when there is nothing to import', async () => {
      const h = harness({ env: {} as NodeJS.ProcessEnv });
      expect(await h.run()).toBe(1);
      expect(h.admin.describeForAdmin).not.toHaveBeenCalled();
    });

    it('fails when no administrator exists for the audit row', async () => {
      const h = harness({ actor: null });
      expect(await h.run()).toBe(2);
      expect(h.admin.replace).not.toHaveBeenCalled();
    });
  });
});
