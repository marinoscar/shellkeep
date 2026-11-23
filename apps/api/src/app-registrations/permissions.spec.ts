import { APP_PERMISSIONS as APP_PERMISSION_MAP, APP_PERMISSION_IDS } from './permissions';
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
