import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';
import '../../src/platform/storage/storage-key-prefix.manifest';

import {
  AVATARS_KEY_PREFIX,
  UPLOADS_KEY_PREFIX,
  allKeyPrefixes,
  buildObjectKey,
  orgKeyPrefixes,
  storageKeyPrefixRegistry,
} from '@marinoscar/platform-api/storage';

import { APP_STORAGE_KEY_PREFIXES } from '../../src/app-registrations/storage-prefixes';

describe('ShellKeep object-storage key prefixes (#50)', () => {
  const byId = () => new Map(storageKeyPrefixRegistry.list().map((def) => [def.id, def]));

  it('registers session-logs and runbook-artifacts as organization-scoped', () => {
    expect(byId().get('session-logs')).toMatchObject({ prefix: 'session-logs/', owner: 'terminal', scope: 'org' });
    expect(byId().get('runbook-artifacts')).toMatchObject({ prefix: 'runbook-artifacts/', owner: 'runbooks', scope: 'org' });
  });

  it('keeps the platform prefixes, uploads/ first (every existing object lives there)', () => {
    const prefixes = allKeyPrefixes();
    expect(prefixes).toEqual(expect.arrayContaining([UPLOADS_KEY_PREFIX, AVATARS_KEY_PREFIX, 'session-logs/', 'runbook-artifacts/']));
    expect(prefixes[0]).toBe('uploads/');
    expect(UPLOADS_KEY_PREFIX).toBe('uploads/');
  });

  it('declares exactly the two app prefixes in app-registrations', () => {
    expect(APP_STORAGE_KEY_PREFIXES.map((def) => def.id)).toEqual(['session-logs', 'runbook-artifacts']);
  });

  it('lists the app prefixes among the organization prefixes', () => {
    expect(orgKeyPrefixes('org-a')).toEqual(expect.arrayContaining(['session-logs/org-a/', 'runbook-artifacts/org-a/']));
  });

  it('builds an organization-segmented key under the prefix', () => {
    const key = buildObjectKey('session-logs', { orgId: 'org-a' }, 'session-1', 'log.txt');
    expect(key.startsWith('session-logs/org-a/')).toBe(true);
    expect(key.endsWith('/session-1/log.txt')).toBe(true);
  });

  it('refuses an organization-scoped key without an organization', () => {
    expect(() => buildObjectKey('runbook-artifacts', {}, 'x')).toThrow(/orgId/);
  });
});
