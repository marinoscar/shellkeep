import { renderPackageUpdate } from './package-commands';

const base = { manager: 'auto' as const, packages: 'all' as const, refreshIndex: true, securityOnly: false };

describe('renderPackageUpdate', () => {
  it('apt: refresh, then upgrade everything non-interactively', () => {
    expect(renderPackageUpdate(base, 'apt')).toEqual({
      ok: true,
      manager: 'apt',
      script: 'DEBIAN_FRONTEND=noninteractive apt-get update\nDEBIAN_FRONTEND=noninteractive apt-get upgrade -y',
    });
  });

  it('apt: named packages use --only-upgrade and skip the refresh when asked', () => {
    const result = renderPackageUpdate({ ...base, manager: 'apt', packages: ['openssl', 'curl'], refreshIndex: false }, undefined);
    expect(result).toEqual({
      ok: true,
      manager: 'apt',
      script: "DEBIAN_FRONTEND=noninteractive apt-get install -y --only-upgrade 'openssl' 'curl'",
    });
  });

  it('auto uses the manager of the server facts; none found is PACKAGE_MANAGER_UNKNOWN', () => {
    expect(renderPackageUpdate(base, 'dnf')).toMatchObject({ ok: true, manager: 'dnf' });
    expect(renderPackageUpdate(base, undefined)).toMatchObject({ ok: false, code: 'PACKAGE_MANAGER_UNKNOWN' });
    expect(renderPackageUpdate(base, 'pacman')).toMatchObject({ ok: false, code: 'PACKAGE_MANAGER_UNKNOWN' });
  });

  it('securityOnly: unattended-upgrade on apt, --security on dnf and yum', () => {
    const apt = renderPackageUpdate({ ...base, manager: 'apt', securityOnly: true }, null);
    expect(apt).toMatchObject({ ok: true });
    expect((apt as { script: string }).script).toContain('unattended-upgrade -v');
    expect((renderPackageUpdate({ ...base, manager: 'dnf', securityOnly: true }, null) as { script: string }).script).toContain('upgrade --security');
    expect((renderPackageUpdate({ ...base, manager: 'yum', securityOnly: true, packages: ['kernel'] }, null) as { script: string }).script).toContain(
      "yum -y upgrade --security 'kernel'",
    );
  });

  it.each(['apk', 'zypper', 'brew'] as const)('securityOnly on %s is UNSUPPORTED_OPTION', (manager) => {
    expect(renderPackageUpdate({ ...base, manager, securityOnly: true }, null)).toMatchObject({ ok: false, code: 'UNSUPPORTED_OPTION' });
  });

  it('apt securityOnly with named packages is UNSUPPORTED_OPTION', () => {
    expect(renderPackageUpdate({ ...base, manager: 'apt', securityOnly: true, packages: ['curl'] }, null)).toMatchObject({
      ok: false,
      code: 'UNSUPPORTED_OPTION',
    });
  });

  it('renders apk, zypper and brew', () => {
    expect((renderPackageUpdate({ ...base, manager: 'apk' }, null) as { script: string }).script).toBe('apk update\napk upgrade');
    expect((renderPackageUpdate({ ...base, manager: 'zypper', packages: ['vim'] }, null) as { script: string }).script).toContain(
      "zypper --non-interactive update 'vim'",
    );
    expect((renderPackageUpdate({ ...base, manager: 'brew' }, null) as { script: string }).script).toBe('brew update\nbrew upgrade');
  });
});
