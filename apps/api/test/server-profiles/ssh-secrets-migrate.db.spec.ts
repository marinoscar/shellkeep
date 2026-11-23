// =============================================================================
// SSH secret re-encryption over a real database (issue #48)
// =============================================================================
//
// `npm run ssh:migrate-secrets` copies the legacy `encrypted_*` columns of
// `server_profiles` into the platform credential store. This runs the command's
// engine (`migrateSshSecrets`) and its entry point (`main`) against the migrated
// database (POSTGRES_*; `npm run prisma:migrate` first) with the REAL
// `UserCredentialsService`, fixtures encrypted with the legacy cipher under both
// accepted key forms (base64 and a raw 32-character string), and proves:
//
//   dry run: counts only, writes nothing         apply: copies and reads back
//   second apply: idempotent                      verify: source = target
//   an undecryptable row is reported by id and field, skipped, and fails the exit code
//   a credential that already exists is never overwritten
//   no plaintext and no ciphertext reaches the output
//
// Every fixture is an obviously fake value; every user has a unique `@example.test`
// address and is deleted at the end (the profiles and credentials cascade).
// Run with `npm run test:db`.
// =============================================================================

import { randomBytes } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { UserCredentialsService } from '@marinoscar/platform-api/credentials';

import { registerShellkeepCredentialPurposes } from '../../src/app-registrations/credentials';
import { buildDatabaseUrl } from '../../src/common/database-url';
import { encrypt, getEncryptionKey } from '../../src/server-profiles/migrate/legacy-cipher';
import {
  formatReport,
  main,
  migrateSshSecrets,
  parseMode,
  type ProfileSource,
} from '../../src/server-profiles/migrate/ssh-secrets-migrate';
import { sshCredentialName } from '../../src/server-profiles/ssh-credentials';

const RUN = randomBytes(4).toString('hex');
const FAKE_PASSWORD = 'FAKE-LEGACY-PASSWORD-0001';
const FAKE_KEY = '-----BEGIN FAKE KEY-----\nbGVnYWN5LWZha2Uta2V5\n-----END FAKE KEY-----\n';
const FAKE_PASSPHRASE = 'FAKE-LEGACY-PASSPHRASE-0003';

// The legacy key is accepted as base64 of 32 bytes or as a raw 32-character string; `isRaw`
// says which one the cipher must have chosen (a 32-character base64 string decodes to 24 bytes).
const KEY_FORMS: Array<[string, () => string, boolean]> = [
  ['base64', () => randomBytes(32).toString('base64'), false],
  ['raw 32-character', () => randomBytes(24).toString('base64'), true], // 32 ASCII characters
];

describe('SSH secret re-encryption (real database)', () => {
  let prisma: PrismaClient;
  let credentials: UserCredentialsService;
  let orgId: string;
  const userIds: string[] = [];
  const savedLegacyKey = process.env.ENCRYPTION_KEY;

  beforeAll(async () => {
    // The platform cipher reads this lazily; .env.test sets it, a CI run may not.
    process.env.SECRETS_ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
    registerShellkeepCredentialPurposes();
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: buildDatabaseUrl() }) });
    await prisma.$connect();
    credentials = new UserCredentialsService(prisma as never);
    const org = await prisma.organization.findFirst({ where: { isDefault: true }, select: { id: true } });
    if (!org) throw new Error('The default organization is missing: run `npm run prisma:seed` first.');
    orgId = org.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    if (savedLegacyKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = savedLegacyKey;
  });

  async function createUser(label: string): Promise<string> {
    const user = await prisma.user.create({
      data: { email: `ssh-migrate-${label}-${RUN}-${randomBytes(3).toString('hex')}@example.test` },
    });
    userIds.push(user.id);
    return user.id;
  }

  async function createProfile(
    userId: string,
    name: string,
    secrets: { password?: string | null; privateKey?: string | null; passphrase?: string | null },
  ) {
    return prisma.serverProfile.create({
      data: {
        userId,
        orgId,
        name,
        hostname: 'server-a.example.test',
        username: 'person-a',
        authMethod: secrets.privateKey ? 'key' : 'password',
        encryptedPassword: secrets.password ?? null,
        encryptedPrivateKey: secrets.privateKey ?? null,
        encryptedPassphrase: secrets.passphrase ?? null,
      },
    });
  }

  /** Only the fixtures' own profiles: the database may hold others (a shared test database). */
  const sourceOf = (ids: string[]): ProfileSource => ({
    serverProfile: {
      findMany: (args) =>
        prisma.serverProfile.findMany({
          ...args,
          where: { ...(args.where ?? {}), userId: { in: ids } },
        }) as never,
    },
  });

  const credentialCount = (ids: string[]) => prisma.userCredential.count({ where: { userId: { in: ids }, purpose: 'ssh' } });

  describe.each(KEY_FORMS)('with a %s legacy key', (_form, makeKey, isRaw) => {
    let legacyKeyString: string;
    let key: Buffer;
    let ids: string[];
    let userA: string;
    let userB: string;
    let passwordProfile: { id: string };
    let keyProfile: { id: string };
    let otherUserProfile: { id: string };

    beforeAll(async () => {
      legacyKeyString = makeKey();
      process.env.ENCRYPTION_KEY = legacyKeyString;
      key = getEncryptionKey();
      userA = await createUser('a');
      userB = await createUser('b');
      ids = [userA, userB];
      passwordProfile = await createProfile(userA, 'password server', { password: encrypt(FAKE_PASSWORD, key) });
      keyProfile = await createProfile(userA, 'key server', {
        privateKey: encrypt(FAKE_KEY, key),
        passphrase: encrypt(FAKE_PASSPHRASE, key),
      });
      otherUserProfile = await createProfile(userB, 'other user server', { password: encrypt('FAKE-OTHER-USER-PW', key) });
      // A profile with no secret at all (agent auth): nothing to copy.
      await prisma.serverProfile.create({
        data: { userId: userB, orgId, name: 'agent server', hostname: 'server-b.example.test', username: 'person-b', authMethod: 'agent' },
      });
    });

    const run = (mode: 'dry-run' | 'apply' | 'verify') =>
      migrateSshSecrets(mode, { prisma: sourceOf(ids), credentials, legacyKey: key });

    it('0. reads the key in the form it was given', () => {
      expect(key).toHaveLength(32);
      expect(key.equals(Buffer.from(legacyKeyString, isRaw ? 'utf8' : 'base64'))).toBe(true);
    });

    it('1. dry run counts what would be copied and writes nothing', async () => {
      const report = await run('dry-run');

      expect(report.profiles).toBe(4);
      expect(report.fields.password).toMatchObject({ source: 2, toCopy: 2, alreadyCopied: 0, undecryptable: 0 });
      expect(report.fields.private_key).toMatchObject({ source: 1, toCopy: 1, alreadyCopied: 0 });
      expect(report.fields.passphrase).toMatchObject({ source: 1, toCopy: 1, alreadyCopied: 0 });
      expect(report.clean).toBe(true);
      expect(await credentialCount(ids)).toBe(0);
    });

    it('2. verify before the copy reports every pair missing and writes nothing', async () => {
      const report = await run('verify');

      expect(report.fields.password).toMatchObject({ source: 2, target: 0, mismatched: 2 });
      expect(report.issues.every((issue) => issue.reason === 'missing')).toBe(true);
      expect(report.clean).toBe(false);
      expect(await credentialCount(ids)).toBe(0);
    });

    it('3. apply copies every field and each one reads back to the legacy plaintext', async () => {
      const report = await run('apply');

      expect(report.fields.password).toMatchObject({ source: 2, toCopy: 2, failed: 0 });
      expect(report.fields.private_key).toMatchObject({ toCopy: 1, failed: 0 });
      expect(report.fields.passphrase).toMatchObject({ toCopy: 1, failed: 0 });
      expect(report.clean).toBe(true);
      expect(await credentialCount(ids)).toBe(4);

      await expect(credentials.getSecret(userA, 'ssh', sshCredentialName(passwordProfile.id, 'password'))).resolves.toBe(FAKE_PASSWORD);
      await expect(credentials.getSecret(userA, 'ssh', sshCredentialName(keyProfile.id, 'private_key'))).resolves.toBe(FAKE_KEY);
      await expect(credentials.getSecret(userA, 'ssh', sshCredentialName(keyProfile.id, 'passphrase'))).resolves.toBe(FAKE_PASSPHRASE);
      await expect(credentials.getSecret(userB, 'ssh', sshCredentialName(otherUserProfile.id, 'password'))).resolves.toBe('FAKE-OTHER-USER-PW');
    });

    it('4. the stored credentials are ciphertext under the platform key, not the legacy ciphertext', async () => {
      const rows = await prisma.userCredential.findMany({ where: { userId: { in: ids }, purpose: 'ssh' } });
      const legacy = await prisma.serverProfile.findMany({ where: { userId: { in: ids } }, select: { encryptedPassword: true } });
      const legacyCiphertexts = new Set(legacy.map((row) => row.encryptedPassword).filter(Boolean));

      for (const row of rows) {
        expect(legacyCiphertexts.has(row.secret)).toBe(false);
        expect(row.secret).not.toContain('FAKE');
      }
    });

    it('5. a second apply is idempotent: nothing copied, everything already there', async () => {
      const before = await prisma.userCredential.findMany({ where: { userId: { in: ids }, purpose: 'ssh' }, select: { id: true, secret: true } });

      const report = await run('apply');

      expect(report.fields.password).toMatchObject({ toCopy: 0, alreadyCopied: 2, failed: 0 });
      expect(report.fields.private_key).toMatchObject({ toCopy: 0, alreadyCopied: 1 });
      expect(report.fields.passphrase).toMatchObject({ toCopy: 0, alreadyCopied: 1 });
      expect(report.clean).toBe(true);
      const after = await prisma.userCredential.findMany({ where: { userId: { in: ids }, purpose: 'ssh' }, select: { id: true, secret: true } });
      expect(after.sort((a, b) => a.id.localeCompare(b.id))).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
    });

    it('6. verify prints source = target for every field', async () => {
      const report = await run('verify');

      for (const field of ['password', 'private_key', 'passphrase'] as const) {
        expect(report.fields[field].mismatched).toBe(0);
        expect(report.fields[field].target).toBe(report.fields[field].source);
      }
      expect(report.clean).toBe(true);
      const text = formatReport(report).join('\n');
      expect(text).toMatch(/password\s+source 2 = target 2/);
      expect(text).toMatch(/private_key\s+source 1 = target 1/);
      expect(text).toMatch(/passphrase\s+source 1 = target 1/);
    });

    it('7. verify catches a credential that differs, and apply never overwrites it', async () => {
      const name = sshCredentialName(passwordProfile.id, 'password');
      await credentials.setSecret(userA, 'ssh', name, 'FAKE-CHANGED-AFTER-COPY');

      const applied = await run('apply');
      expect(applied.fields.password.toCopy).toBe(0);
      await expect(credentials.getSecret(userA, 'ssh', name)).resolves.toBe('FAKE-CHANGED-AFTER-COPY');

      const verified = await run('verify');
      expect(verified.fields.password).toMatchObject({ target: 1, mismatched: 1 });
      expect(verified.issues).toEqual([{ profileId: passwordProfile.id, field: 'password', reason: 'differs' }]);
      expect(verified.clean).toBe(false);

      await credentials.setSecret(userA, 'ssh', name, FAKE_PASSWORD);
    });

    it('8. leaves the legacy columns exactly as they were', async () => {
      const row = await prisma.serverProfile.findUnique({ where: { id: keyProfile.id } });

      expect(row?.encryptedPrivateKey).toBeTruthy();
      expect(row?.encryptedPassphrase).toBeTruthy();
    });
  });

  describe('an undecryptable row', () => {
    it('is reported by profile id and field, skipped, and fails the exit code; the rest is copied', async () => {
      const key = randomBytes(32);
      const otherKey = randomBytes(32);
      process.env.ENCRYPTION_KEY = key.toString('base64');
      const userId = await createUser('bad');
      const good = await createProfile(userId, 'good', { password: encrypt('FAKE-GOOD-PASSWORD', key) });
      const wrongKey = await createProfile(userId, 'wrong key', { password: encrypt('FAKE-OTHER-KEY-PW', otherKey) });
      const malformed = await createProfile(userId, 'malformed', { password: 'not-a-ciphertext' });
      const blank = await createProfile(userId, 'blank', { password: encrypt('', key) });
      const ids = [userId];

      const dry = await migrateSshSecrets('dry-run', { prisma: sourceOf(ids), credentials, legacyKey: key });
      expect(dry.fields.password).toMatchObject({ source: 4, toCopy: 1, undecryptable: 3 });
      expect(dry.clean).toBe(false);

      const applied = await migrateSshSecrets('apply', { prisma: sourceOf(ids), credentials, legacyKey: key });
      expect(applied.fields.password).toMatchObject({ toCopy: 1, undecryptable: 3, failed: 0 });
      expect(applied.issues).toEqual(
        expect.arrayContaining([
          { profileId: wrongKey.id, field: 'password', reason: 'auth-failed' },
          { profileId: malformed.id, field: 'password', reason: 'bad-format' },
          { profileId: blank.id, field: 'password', reason: 'blank' },
        ]),
      );
      expect(applied.clean).toBe(false);
      expect(await credentialCount(ids)).toBe(1);
      await expect(credentials.getSecret(userId, 'ssh', sshCredentialName(good.id, 'password'))).resolves.toBe('FAKE-GOOD-PASSWORD');

      // The report names ids and reason codes, never content.
      const text = formatReport(applied).join('\n');
      expect(text).toContain(wrongKey.id);
      expect(text).not.toContain('FAKE-');
      expect(text).not.toContain('not-a-ciphertext');
    });
  });

  describe('the command (main)', () => {
    let logs: string[];
    let errors: string[];

    beforeEach(() => {
      logs = [];
      errors = [];
      jest.spyOn(console, 'log').mockImplementation((line: unknown) => void logs.push(String(line)));
      jest.spyOn(console, 'error').mockImplementation((line: unknown) => void errors.push(String(line)));
    });

    afterEach(() => jest.restoreAllMocks());

    it('parses the mode and refuses --apply with --verify', () => {
      expect(parseMode([])).toBe('dry-run');
      expect(parseMode(['--apply'])).toBe('apply');
      expect(parseMode(['--verify'])).toBe('verify');
      expect(() => parseMode(['--apply', '--verify'])).toThrow(/not both/);
    });

    it('exits 2 and names the variable when the legacy key is not configured', async () => {
      const saved = process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_KEY;
      try {
        await expect(main([])).resolves.toBe(2);
        expect(errors.join('\n')).toMatch(/environment variable is not set/);
      } finally {
        process.env.ENCRYPTION_KEY = saved;
      }
    });

    it('exits 2 on a mode conflict', async () => {
      await expect(main(['--apply', '--verify'])).resolves.toBe(2);
    });

    it('runs a dry run over the database and prints counts only', async () => {
      const key = randomBytes(32);
      process.env.ENCRYPTION_KEY = key.toString('base64');
      const userId = await createUser('cli');
      await createProfile(userId, 'cli server', { password: encrypt('FAKE-CLI-PASSWORD-77', key) });

      // The command scans every profile of the database; a pre-existing undecryptable one
      // (another deployment's key) would be a 1, so assert on the output, not the code.
      await main([]);

      const output = logs.join('\n');
      expect(output).toContain('DRY RUN (nothing written)');
      expect(output).toMatch(/password\s+legacy values \d+: to copy \d+/);
      expect(output).not.toContain('FAKE-CLI-PASSWORD-77');
      expect(await credentialCount([userId])).toBe(0);
    });
  });
});
