import type { SystemSettingsService } from '@marinoscar/platform-api/settings';

import type { PrismaService } from '../../prisma/prisma.service';
import type * as Contributor from './terminal.about-contributor';

jest.mock('../doctor/ssh-client.doctor-check', () => ({
  loadSshClientFacts: jest.fn(),
}));

jest.mock('@marinoscar/platform-api/host', () => ({
  ...jest.requireActual('@marinoscar/platform-api/host'),
  registerAboutContributor: jest.fn(),
}));

// `test/setup.ts` imports the manifest, which already loaded (and registered)
// this module with the real `ssh2` loader before the mocks above existed. A
// fresh module registry gives this file its own copy of the holder, the
// `registered` flag and the mocked dependencies.
let registerAboutContributor: jest.Mock;
let loadFacts: jest.Mock;
let registerTerminalAboutContributor: typeof Contributor.registerTerminalAboutContributor;
let terminalAboutContributor: typeof Contributor.terminalAboutContributor;
let TerminalAboutSource: typeof Contributor.TerminalAboutSource;
type TerminalAboutSource = Contributor.TerminalAboutSource;

beforeAll(() => {
  jest.resetModules();
  /* eslint-disable @typescript-eslint/no-require-imports */
  ({ registerAboutContributor } = require('@marinoscar/platform-api/host'));
  ({ loadSshClientFacts: loadFacts } = require('../doctor/ssh-client.doctor-check'));
  ({ registerTerminalAboutContributor, terminalAboutContributor, TerminalAboutSource } =
    require('./terminal.about-contributor') as typeof Contributor);
  /* eslint-enable @typescript-eslint/no-require-imports */
});

function sshVersionIs(version: string) {
  loadFacts.mockReturnValue({ version, hostKeyAlgorithms: [] });
}

function makeSource(
  groups: Array<{ status: string; _count: { _all: number } }> = [],
  terminal: Record<string, unknown> = {
    detachAfterMinutes: 30,
    terminateDetachedAfterHours: 24,
    purgeTerminatedAfterDays: 7,
  },
) {
  const prisma = { terminalSession: { groupBy: jest.fn().mockResolvedValue(groups) } };
  const settings = { getNamespace: jest.fn().mockResolvedValue(terminal) };
  const source = new TerminalAboutSource(
    prisma as unknown as PrismaService,
    settings as unknown as SystemSettingsService,
  );
  return { source, prisma, settings };
}

describe('terminalAboutContributor', () => {
  // The holder is module state: every test that binds a source unbinds it.
  const bound: TerminalAboutSource[] = [];
  const bind = (source: TerminalAboutSource) => {
    source.onModuleInit();
    bound.push(source);
  };

  beforeEach(() => {
    loadFacts.mockReset();
    sshVersionIs('1.16.0');
  });

  afterEach(() => {
    for (const source of bound.splice(0)) source.onModuleDestroy();
  });

  it('is the "terminal" section, labelled Terminal', () => {
    expect(terminalAboutContributor.id).toBe('terminal');
    expect(terminalAboutContributor.label).toBe('Terminal');
  });

  describe('before a source is bound', () => {
    it('falls back to the ssh2 version alone, touching no database or settings', async () => {
      await expect(terminalAboutContributor.describe()).resolves.toEqual({ ssh2Version: '1.16.0' });
    });

    it('reports "unavailable" when ssh2 cannot be loaded', async () => {
      loadFacts.mockImplementation(() => {
        throw new Error("Cannot find module 'ssh2'");
      });

      await expect(terminalAboutContributor.describe()).resolves.toEqual({ ssh2Version: 'unavailable' });
    });
  });

  describe('once TerminalAboutSource is initialised', () => {
    it('delegates to the source: session counts, ssh2 version and reaper thresholds', async () => {
      const { source, prisma, settings } = makeSource([
        { status: 'active', _count: { _all: 3 } },
        { status: 'detached', _count: { _all: 2 } },
      ]);
      bind(source);

      await expect(terminalAboutContributor.describe()).resolves.toEqual({
        activeSessions: 3,
        detachedSessions: 2,
        ssh2Version: '1.16.0',
        detachAfterMinutes: 30,
        terminateDetachedAfterHours: 24,
        purgeTerminatedAfterDays: 7,
      });
      expect(prisma.terminalSession.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        where: { status: { in: ['active', 'detached'] } },
        _count: { _all: true },
      });
      expect(settings.getNamespace).toHaveBeenCalledWith('terminal');
    });

    it('reports zero for a status with no sessions', async () => {
      const { source } = makeSource([]);
      bind(source);

      await expect(terminalAboutContributor.describe()).resolves.toMatchObject({
        activeSessions: 0,
        detachedSessions: 0,
      });
    });

    it('still reports "unavailable" for ssh2 when it cannot be loaded', async () => {
      loadFacts.mockImplementation(() => {
        throw new Error('the ssh2 module loaded but exports no Client');
      });
      const { source } = makeSource();
      bind(source);

      await expect(terminalAboutContributor.describe()).resolves.toMatchObject({ ssh2Version: 'unavailable' });
    });

    it('reports scalars only, never a setting it does not name', async () => {
      const { source } = makeSource([], {
        detachAfterMinutes: 30,
        terminateDetachedAfterHours: 24,
        purgeTerminatedAfterDays: 7,
        secretValue: 'do-not-leak',
      });
      bind(source);

      const facts = await terminalAboutContributor.describe();

      expect(JSON.stringify(facts)).not.toContain('do-not-leak');
      for (const value of Object.values(facts)) expect(['string', 'number']).toContain(typeof value);
    });
  });

  describe('on module destroy', () => {
    it('unbinds the source, so the contributor falls back to the ssh2 version', async () => {
      const { source, prisma } = makeSource([{ status: 'active', _count: { _all: 1 } }]);
      source.onModuleInit();
      source.onModuleDestroy();

      await expect(terminalAboutContributor.describe()).resolves.toEqual({ ssh2Version: '1.16.0' });
      expect(prisma.terminalSession.groupBy).not.toHaveBeenCalled();
    });

    it('does not unbind a newer source when a stale one is destroyed', async () => {
      const stale = makeSource([{ status: 'active', _count: { _all: 1 } }]);
      const current = makeSource([{ status: 'active', _count: { _all: 5 } }]);
      stale.source.onModuleInit();
      bind(current.source);

      stale.source.onModuleDestroy();

      await expect(terminalAboutContributor.describe()).resolves.toMatchObject({ activeSessions: 5 });
      expect(stale.prisma.terminalSession.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('registerTerminalAboutContributor', () => {
    it('registers the contributor once, however often it is called', () => {
      registerTerminalAboutContributor();
      registerTerminalAboutContributor();

      expect(registerAboutContributor).toHaveBeenCalledTimes(1);
      expect(registerAboutContributor).toHaveBeenCalledWith(terminalAboutContributor);
    });
  });
});
