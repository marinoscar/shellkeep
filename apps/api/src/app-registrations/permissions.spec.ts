import { APP_PERMISSIONS as APP_PERMISSION_MAP, APP_PERMISSION_IDS, RUNBOOK_PERMISSIONS } from './permissions';
import { PERMISSIONS } from '../common/constants/roles.constants';

const APP_PERMISSIONS = Object.values(APP_PERMISSION_MAP);

const grantsOf = (role: string) =>
  APP_PERMISSIONS.filter((p) => (p.defaultGrants as readonly string[]).includes(role))
    .map((p) => p.id)
    .sort();

describe('APP_PERMISSIONS', () => {
  it('declares the six domain permissions, org scoped', () => {
    expect(APP_PERMISSIONS.map((p) => p.id)).toEqual([
      'servers:read',
      'servers:write',
      'servers:delete',
      'sessions:read',
      'sessions:write',
      'sessions:delete',
    ]);
    expect(APP_PERMISSIONS.every((p) => p.scope === 'org')).toBe(true);
  });

  it('keeps the default grants the seed always had', () => {
    const all = [
      'servers:delete',
      'servers:read',
      'servers:write',
      'sessions:delete',
      'sessions:read',
      'sessions:write',
    ];
    expect(grantsOf('org_admin')).toEqual(all);
    expect(grantsOf('admin')).toEqual([]);
    expect(grantsOf('contributor')).toEqual(all);
    expect(grantsOf('viewer')).toEqual(['servers:read', 'sessions:read']);
  });

  it('is exposed through the PERMISSIONS constant', () => {
    expect(PERMISSIONS.SERVERS_READ).toBe(APP_PERMISSION_IDS.SERVERS_READ);
    expect(PERMISSIONS.SESSIONS_DELETE).toBe('sessions:delete');
  });
});

describe('RUNBOOK_PERMISSIONS', () => {
  const grants = (id: string) =>
    Object.values(RUNBOOK_PERMISSIONS)
      .find((p) => p.id === id)!
      .defaultGrants.slice()
      .sort();

  it('declares the four runbook permissions, org scoped', () => {
    expect(Object.values(RUNBOOK_PERMISSIONS).map((p) => p.id)).toEqual([
      'runbooks:read',
      'runbooks:write',
      'runbooks:run',
      'runbooks:approve',
    ]);
    expect(Object.values(RUNBOOK_PERMISSIONS).every((p) => p.scope === 'org')).toBe(true);
  });

  it('grants read to every org role, write and run to writers, approve to org_admin only', () => {
    expect(grants('runbooks:read')).toEqual(['contributor', 'org_admin', 'viewer']);
    expect(grants('runbooks:write')).toEqual(['contributor', 'org_admin']);
    expect(grants('runbooks:run')).toEqual(['contributor', 'org_admin']);
    expect(grants('runbooks:approve')).toEqual(['org_admin']);
  });

  it('is exposed through the PERMISSIONS constant', () => {
    expect(PERMISSIONS.RUNBOOKS_READ).toBe('runbooks:read');
    expect(PERMISSIONS.RUNBOOKS_APPROVE).toBe('runbooks:approve');
  });
});
