// =============================================================================
// SSH credentials in the platform credential store (issue #48)
// =============================================================================
//
// The REAL `ServerProfilesService` over the REAL `UserCredentialsService` and the
// platform cipher, with an in-memory credential table and profile table. It proves
// what the issue asks for: a secret is bound to its owner (a ciphertext copied to
// another user's row fails to decrypt), a secret never reaches a response, and the
// `ssh` purpose has no organization or deployment fallback.
// =============================================================================

import '../../src/shellkeep.manifest';

import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AUDIT_SINK, PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import { AccessPolicy, GrantsService, PrincipalGroupsProvider } from '@marinoscar/platform-api/sharing';
import {
  CredentialsService,
  OrgCredentialsService,
  USER_CREDENTIAL_PURPOSE_REGISTRY,
  UserCredentialResolver,
  UserCredentialsService,
  fallbackOf,
  userCredentialPurposeRegistry,
} from '@marinoscar/platform-api/credentials';

import { PrismaService } from '../../src/prisma/prisma.service';
import { ServerProfilesService } from '../../src/server-profiles/server-profiles.service';
import { ServerFactsService } from '../../src/ssh/server-facts.service';
import { TerminalWebhooksService } from '../../src/terminal/webhooks/terminal-webhooks.service';
import { SshConnectionFactory } from '../../src/ssh/ssh-connection.factory';
import { sshCredentialName } from '../../src/server-profiles/ssh-credentials';
import { createInMemoryCredentialPrisma } from '../helpers/in-memory-credentials';

// `runInOrg` hands the in-memory profile table to the callback (the transaction itself is the platform's).
jest.mock('@marinoscar/platform-api/core', () => ({
  ...jest.requireActual('@marinoscar/platform-api/core'),
  runInOrg: (_client: unknown, _scope: unknown, fn: (tx: unknown) => unknown) => fn((global as any).__profiles),
}));
// The list filter belongs to the sharing slice (proven against a real database in test/sharing).
jest.mock('../../src/platform/sharing/sharing-access', () => ({
  ...jest.requireActual('../../src/platform/sharing/sharing-access'),
  accessibleListWhere: async ({ principal }: { principal: { userId: string } }) => ({ userId: principal.userId, ownerGroupId: null }),
}));

const ORG = '5b0c1d2e-3f40-4a51-8b62-73c84d95ea06';
const USER_A = '11111111-1111-4111-8111-aaaaaaaaaaaa';
const USER_B = '22222222-2222-4222-8222-bbbbbbbbbbbb';
const scopeOf = (userId: string) =>
  ({
    kind: 'user',
    userId,
    email: `${userId}@example.test`,
    credential: 'session',
    roles: [],
    permissions: ['servers:read', 'servers:write', 'sessions:write'],
    activeOrgId: ORG,
  }) as never;

// Obviously fake fixtures; the marker makes any leak into a response or a log easy to find.
const PASSWORD = 'FAKE-PASSWORD-value-for-tests-1234';
const PRIVATE_KEY = '-----BEGIN FAKE KEY-----\nZmFrZS1rZXktZm9yLXRlc3RzLW9ubHk=\n-----END FAKE KEY-----\n';
const PASSPHRASE = 'FAKE-PASSPHRASE-value-5678';

function createProfileTable() {
  const rows: any[] = [];
  let seq = 0;
  // Equality, `AND` of such clauses, and `null` meaning "absent"; `OR` is not evaluated.
  const matches = (row: any, where: any): boolean =>
    Object.entries(where).every(([key, value]) => {
      if (key === 'OR') return true;
      if (key === 'AND') return (value as any[]).every((clause) => matches(row, clause));
      return (row[key] ?? null) === (value ?? null);
    });
  /** What the service asks the database for with `include`: the owning user and group. */
  const withOwner = (row: any) => ({ ...row, user: { id: row.userId, displayName: null, email: `${row.userId}@example.test` }, ownerGroup: null });
  return {
    rows,
    serverProfile: {
      create: async ({ data }: any) => {
        seq += 1;
        const row = {
          id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
          color: 'default',
          encryptedPassword: null,
          encryptedPrivateKey: null,
          encryptedPassphrase: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      },
      findFirst: async ({ where }: any) => {
        const row = rows.find((candidate) => matches(candidate, where));
        return row ? withOwner(row) : null;
      },
      findMany: async ({ where }: any) => rows.filter((row) => matches(row, where)).map(withOwner),
      count: async ({ where }: any) => rows.filter((row) => matches(row, where)).length,
      update: async ({ where, data }: any) => Object.assign(rows.find((row) => row.id === where.id), data),
      delete: async ({ where }: any) => {
        const index = rows.findIndex((row) => row.id === where.id);
        return rows.splice(index, 1)[0];
      },
    },
  };
}

describe('SSH credentials in the platform credential store', () => {
  let module: TestingModule;
  let service: ServerProfilesService;
  let credentials: UserCredentialsService;
  let table: ReturnType<typeof createInMemoryCredentialPrisma>;
  let profiles: ReturnType<typeof createProfileTable>;

  beforeEach(async () => {
    table = createInMemoryCredentialPrisma();
    profiles = createProfileTable();
    (global as any).__profiles = profiles;
    // AccessPolicy as ShellKeep wires it, reduced to what this spec proves: only the owner reaches a profile.
    const OWNER = { allowed: true, role: 'owner', via: 'owner' };
    const owns = (principal: any, id: string) =>
      profiles.rows.some((row) => row.id === id && row.userId === principal.userId && row.orgId === principal.activeOrgId);
    const access = {
      require: async (principal: any, _action: string, ref: { id: string }) => {
        if (!owns(principal, ref.id)) throw new NotFoundException();
        return OWNER;
      },
      requireIn: async (_tx: unknown, principal: any, _action: string, ref: { id: string }) => {
        if (!owns(principal, ref.id)) throw new NotFoundException();
        return OWNER;
      },
      decideManyIn: async (_tx: unknown, _p: unknown, _a: string, refs: Array<{ type: string; id: string }>) =>
        new Map(refs.map((ref) => [`${ref.type}:${ref.id}`, OWNER])),
    };
    module = await Test.createTestingModule({
      providers: [
        ServerProfilesService,
        UserCredentialsService,
        UserCredentialResolver,
        { provide: PLATFORM_PRISMA, useValue: table.prisma },
        { provide: PrismaService, useValue: profiles },
        { provide: AccessPolicy, useValue: access },
        { provide: GrantsService, useValue: { deleteForResources: async () => 0 } },
        { provide: PrincipalGroupsProvider, useValue: { enrich: async (p: unknown) => p, groupRoleFor: async () => null } },
        // The service never connects in this spec (it proves credential storage only).
        { provide: SshConnectionFactory, useValue: {} },
        { provide: ServerFactsService, useValue: {} },
        { provide: TerminalWebhooksService, useValue: { hostKeyChanged: jest.fn() } },
        { provide: AUDIT_SINK, useValue: { record: jest.fn().mockResolvedValue(undefined) } },
        { provide: USER_CREDENTIAL_PURPOSE_REGISTRY, useValue: userCredentialPurposeRegistry.list() },
        // The deployment and organization tiers HOLD a secret at the same address: the resolver
        // must still not use them for `ssh`.
        { provide: CredentialsService, useValue: { getSecret: jest.fn().mockResolvedValue('FAKE-DEPLOYMENT-SECRET') } },
        { provide: OrgCredentialsService, useValue: { getSecret: jest.fn().mockResolvedValue('FAKE-ORG-SECRET') } },
      ],
    }).compile();
    service = module.get(ServerProfilesService);
    credentials = module.get(UserCredentialsService);
  });

  const base = {
    name: 'Server A',
    hostname: 'server-a.example.test',
    port: 22,
    username: 'person-a',
    tags: [],
    color: 'default' as const,
  };

  async function createFull(userId = USER_A) {
    return service.create(scopeOf(userId), {
      ...base,
      authMethod: 'key',
      password: PASSWORD,
      privateKey: PRIVATE_KEY,
      passphrase: PASSPHRASE,
    });
  }

  it('round-trips the three secrets of a profile through the store, under the documented names', async () => {
    const created = await createFull();

    expect([...table.rows.values()].map((row) => `${row.purpose}/${row.name}`).sort()).toEqual(
      ['password', 'passphrase', 'private_key'].map((field) => `ssh/${sshCredentialName(created.id, field as any)}`).sort(),
    );

    const decrypted = await service.getDecryptedProfile(created.id, scopeOf(USER_A));
    expect(decrypted).toMatchObject({ password: PASSWORD, privateKey: PRIVATE_KEY, passphrase: PASSPHRASE });
  });

  it('stores only ciphertext: no plaintext is in the table, the profile row or the legacy columns', async () => {
    const created = await createFull();

    const stored = JSON.stringify([...table.rows.values()]);
    expect(stored).not.toContain('FAKE-PASSWORD');
    expect(stored).not.toContain('FAKE KEY');
    expect(stored).not.toContain('FAKE-PASSPHRASE');
    const row = profiles.rows.find((candidate) => candidate.id === created.id);
    expect(row.encryptedPassword).toBeNull();
    expect(row.encryptedPrivateKey).toBeNull();
    expect(row.encryptedPassphrase).toBeNull();
  });

  describe('owner binding', () => {
    it('fails to decrypt a ciphertext copied to another user row', async () => {
      const created = await createFull();
      const name = sshCredentialName(created.id, 'password');
      const source = table.rows.get(table.keyOf(USER_A, 'ssh', name))!;

      // The same ciphertext, in a row of user B at the same address.
      table.rows.set(table.keyOf(USER_B, 'ssh', name), { ...source, id: 'copied', userId: USER_B });

      await expect(credentials.getSecret(USER_B, 'ssh', name)).rejects.toBeInstanceOf(InternalServerErrorException);
      await expect(credentials.getSecret(USER_B, 'ssh', name)).rejects.toThrow(/could not be decrypted/);
      // The owner still reads it.
      await expect(credentials.getSecret(USER_A, 'ssh', name)).resolves.toBe(PASSWORD);
    });

    it('does not decrypt a secret stored for another purpose of the same user', async () => {
      const created = await createFull();
      const name = sshCredentialName(created.id, 'password');
      const source = table.rows.get(table.keyOf(USER_A, 'ssh', name))!;

      // The cipher domain is `user:<userId>:<purpose>`: another purpose's sub-key does not open an
      // `ssh` ciphertext, whoever the owner is.
      const { decryptSecret, userCredentialPurpose } = await import('@marinoscar/platform-api/core');
      expect(() => decryptSecret(source.secret, userCredentialPurpose(USER_A, 'other'))).toThrow();
      expect(decryptSecret(source.secret, userCredentialPurpose(USER_A, 'ssh'))).toBe(PASSWORD);
    });

    it('answers another user profile as not found and reads none of its secrets', async () => {
      const created = await createFull(USER_A);

      await expect(service.getDecryptedProfile(created.id, scopeOf(USER_B))).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.findOne(created.id, scopeOf(USER_B))).rejects.toBeInstanceOf(NotFoundException);
      // Even addressed directly, user B's store has nothing at user A's names.
      await expect(
        credentials.getSecret(USER_B, 'ssh', sshCredentialName(created.id, 'password')),
      ).resolves.toBeNull();
    });
  });

  describe('responses', () => {
    const SECRET_SHAPED = /password|passphrase|private_?key|secret|ciphertext|encrypted|hint/i;
    const ALLOWED_FLAGS = ['hasPassword', 'hasPrivateKey', 'hasPassphrase'];

    function expectNoSecret(response: unknown) {
      const text = JSON.stringify(response);
      expect(text).not.toContain('FAKE-PASSWORD');
      expect(text).not.toContain('FAKE KEY');
      expect(text).not.toContain('FAKE-PASSPHRASE');
      expect(text).not.toContain('••••');
      const offending = Object.keys(response as object).filter(
        (key) => SECRET_SHAPED.test(key) && !ALLOWED_FLAGS.includes(key),
      );
      expect(offending).toEqual([]);
    }

    it('carries only the has* booleans from create, findOne, findAll and update', async () => {
      const created = await createFull();
      expectNoSecret(created);
      expect(created).toMatchObject({ hasPassword: true, hasPrivateKey: true, hasPassphrase: true });

      const one = await service.findOne(created.id, scopeOf(USER_A));
      expectNoSecret(one);

      const list = await service.findAll(scopeOf(USER_A), { page: 1, pageSize: 20, filter: 'all' });
      list.items.forEach(expectNoSecret);
      expect(list.items[0]).toMatchObject({ hasPassword: true, hasPrivateKey: true, hasPassphrase: true });

      const updated = await service.update(created.id, scopeOf(USER_A), { password: '' });
      expectNoSecret(updated);
      expect(updated).toMatchObject({ hasPassword: false, hasPrivateKey: true });
    });

    it('lists no profile of another user, and no flag of one', async () => {
      await createFull(USER_A);

      const list = await service.findAll(scopeOf(USER_B), { page: 1, pageSize: 20, filter: 'all' });
      expect(list.items).toEqual([]);
    });
  });

  describe('update and delete', () => {
    it('replaces a secret, keeps the others, and removes one when it is cleared', async () => {
      const created = await createFull();

      await service.update(created.id, scopeOf(USER_A), { password: 'FAKE-NEW-PASSWORD-9999' });
      let decrypted = await service.getDecryptedProfile(created.id, scopeOf(USER_A));
      expect(decrypted).toMatchObject({ password: 'FAKE-NEW-PASSWORD-9999', passphrase: PASSPHRASE });

      await service.update(created.id, scopeOf(USER_A), { passphrase: '' });
      decrypted = await service.getDecryptedProfile(created.id, scopeOf(USER_A));
      expect(decrypted).toMatchObject({ password: 'FAKE-NEW-PASSWORD-9999', passphrase: null, privateKey: PRIVATE_KEY });
    });

    it('deletes the three credentials with the profile', async () => {
      const created = await createFull();
      expect(table.rows.size).toBe(3);

      await service.remove(created.id, scopeOf(USER_A));

      expect(table.rows.size).toBe(0);
    });

    it('never reads the legacy ciphertext columns', async () => {
      const created = await createFull();
      const row = profiles.rows.find((candidate) => candidate.id === created.id);
      // A legacy ciphertext in the old column is ignored: the store is the only source.
      row.encryptedPassword = 'iv:tag:legacy-ciphertext';
      await service.update(created.id, scopeOf(USER_A), { password: '' });

      const decrypted = await service.getDecryptedProfile(created.id, scopeOf(USER_A));
      expect(decrypted.password).toBeNull();
    });
  });

  describe('the ssh purpose', () => {
    it('is registered with no organization or deployment fallback', () => {
      const def = userCredentialPurposeRegistry.get('ssh')!;

      expect(def).toBeDefined();
      expect(def.system).toBeNull();
      expect(def.org ?? null).toBeNull();
      expect(fallbackOf(def)).toEqual([]);
      expect(def.label).toBe('SSH credentials');
    });

    it('resolves to nothing for a user who stored no secret, whatever the organization or deployment holds', async () => {
      const resolver = module.get(UserCredentialResolver);
      const deployment = module.get(CredentialsService).getSecret as jest.Mock;
      const organization = module.get(OrgCredentialsService).getSecret as jest.Mock;

      await expect(
        resolver.resolve(USER_B, 'ssh', sshCredentialName('00000000-0000-4000-8000-000000000001', 'password'), {
          orgId: ORG,
        }),
      ).resolves.toMatchObject({ source: 'none' });
      expect(deployment).not.toHaveBeenCalled();
      expect(organization).not.toHaveBeenCalled();
    });
  });
});
