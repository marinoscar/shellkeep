import { describe, expect, it } from 'vitest';

import { DEFAULT_BIND_PORT, withDefaultPort } from './default-port.js';

describe('withDefaultPort', () => {
  it('is 8323', () => {
    expect(DEFAULT_BIND_PORT).toBe(8323);
  });

  it.each(['install', 'doctor', 'status'])('adds --port 8323 to deploy %s', (sub) => {
    expect(withDefaultPort(['deploy', sub, '--domain', 'app.example.test'])).toEqual([
      'deploy',
      sub,
      '--port',
      '8323',
      '--domain',
      'app.example.test',
    ]);
  });

  it('lets an explicit --port win, in both spellings', () => {
    expect(withDefaultPort(['deploy', 'install', '--port', '9000'])).toEqual(['deploy', 'install', '--port', '9000']);
    expect(withDefaultPort(['deploy', 'install', '--port=9000', '--json'])).toEqual(['deploy', 'install', '--port=9000', '--json']);
    expect(withDefaultPort(['deploy', 'doctor', '--port=3535'])).toEqual(['deploy', 'doctor', '--port=3535']);
  });

  it('does not mistake a flag that merely starts with --port for --port', () => {
    expect(withDefaultPort(['deploy', 'status', '--portable'])).toEqual(['deploy', 'status', '--port', '8323', '--portable']);
  });

  it('leaves update alone: it reads APP_BIND_PORT from the .env and has no --port', () => {
    expect(withDefaultPort(['deploy', 'update', '--root', '/opt/infra/apps/shellkeep'])).toEqual([
      'deploy',
      'update',
      '--root',
      '/opt/infra/apps/shellkeep',
    ]);
  });

  it('leaves the other commands untouched', () => {
    for (const argv of [
      ['deploy', 'list'],
      ['deploy', 'uninstall', '--dry-run'],
      ['deploy', 'certs'],
      ['deploy'],
      ['servers', 'list'],
      ['sessions', 'list', '--json'],
      ['install'],
      [],
    ]) {
      expect(withDefaultPort(argv), argv.join(' ')).toEqual(argv);
    }
  });

  it('leaves help and version alone', () => {
    expect(withDefaultPort(['deploy', 'install', '--help'])).toEqual(['deploy', 'install', '--help']);
    expect(withDefaultPort(['--version'])).toEqual(['--version']);
  });

  it('keeps the recorded port of a reinstall or a resume', () => {
    expect(withDefaultPort(['deploy', 'install', '--reinstall'])).toEqual(['deploy', 'install', '--reinstall']);
    expect(withDefaultPort(['deploy', 'install', '--resume'])).toEqual(['deploy', 'install', '--resume']);
  });

  it('adds nothing after a bare --', () => {
    expect(withDefaultPort(['deploy', 'doctor', '--', '--port', '1'])).toEqual(['deploy', 'doctor', '--port', '8323', '--', '--port', '1']);
  });

  it('does not mutate its input', () => {
    const argv = ['deploy', 'install'];
    withDefaultPort(argv);
    expect(argv).toEqual(['deploy', 'install']);
  });
});
