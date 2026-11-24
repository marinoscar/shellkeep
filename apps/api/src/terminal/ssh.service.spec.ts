import { EventEmitter } from 'events';

import { SshService } from './ssh.service';
import type { DecryptedServerProfile } from '../ssh/ssh-profile';
import { HostKeyError } from '../ssh/host-key.error';
import type { SshConnectionFactory } from '../ssh/ssh-connection.factory';

describe('SshService', () => {
  const profile: DecryptedServerProfile = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    orgId: '33333333-3333-4333-8333-333333333333',
    hostname: 'server-a.example.test',
    port: 22,
    username: 'admin',
    authMethod: 'password',
    password: 'my-password',
  };
  const tmuxSessionId = 'sk-abcd1234';

  function setup(options: { shellError?: Error; openError?: Error } = {}) {
    const stream = new EventEmitter() as any;
    stream.close = jest.fn();
    stream.write = jest.fn();
    stream.setWindow = jest.fn();

    const client = new EventEmitter() as any;
    client.end = jest.fn();
    client.shell = jest.fn((_opts: unknown, cb: (err: Error | null, stream: unknown) => void) =>
      options.shellError ? cb(options.shellError, null) : cb(null, stream),
    );

    const factory = {
      open: jest.fn(async () => {
        if (options.openError) throw options.openError;
        return client;
      }),
      exec: jest.fn(),
    } as unknown as jest.Mocked<SshConnectionFactory>;

    return { service: new SshService(factory), factory, client, stream };
  }

  describe('connect', () => {
    it('opens an interactive connection through the factory and starts tmux in a PTY shell', async () => {
      const { service, factory, client, stream } = setup();

      const connection = await service.connect(profile, tmuxSessionId, 80, 24);

      expect(factory.open).toHaveBeenCalledWith(profile, { purpose: 'interactive' });
      expect(client.shell).toHaveBeenCalledWith({ cols: 80, rows: 24, term: 'xterm-256color' }, expect.any(Function));
      expect(stream.write).toHaveBeenCalledWith(expect.stringContaining('set-option history-limit 50000'));
      // The `\\;` reaches the remote shell as `\;`, tmux's own command separator.
      expect(stream.write).toHaveBeenCalledWith(
        `tmux new-session -As ${tmuxSessionId} \\; set-option history-limit 50000 \\; set-option mouse on\n`,
      );
      expect(connection).toMatchObject({ client, stream });
    });

    it('propagates a host-key refusal untouched, before any shell is opened', async () => {
      const refusal = new HostKeyError('HOST_KEY_UNKNOWN', { fingerprint: 'SHA256:x', algorithm: 'ssh-ed25519' });
      const { service, client } = setup({ openError: refusal });

      await expect(service.connect(profile, tmuxSessionId, 80, 24)).rejects.toBe(refusal);
      expect(client.shell).not.toHaveBeenCalled();
    });

    it('rejects and ends the client when the shell cannot be opened', async () => {
      const { service, client } = setup({ shellError: new Error('Command failed') });

      await expect(service.connect(profile, tmuxSessionId, 80, 24)).rejects.toThrow('Command failed');
      expect(client.end).toHaveBeenCalled();
    });

    it('closes the stream and the client, and resizes the window', async () => {
      const { service, client, stream } = setup();
      const connection = await service.connect(profile, tmuxSessionId, 80, 24);

      connection.resize(120, 40);
      connection.close();

      expect(stream.setWindow).toHaveBeenCalledWith(40, 120, 0, 0);
      expect(stream.close).toHaveBeenCalled();
      expect(client.end).toHaveBeenCalled();
    });
  });

  describe('execCommand', () => {
    it('returns stdout, stderr, exit code and signal from the factory', async () => {
      const { service, factory } = setup();
      const result = { stdout: 'out', stderr: 'err', exitCode: 3, signal: null };
      factory.exec.mockResolvedValue(result);

      await expect(service.execCommand(profile, 'false')).resolves.toBe(result);
      expect(factory.exec).toHaveBeenCalledWith(profile, 'false', { timeoutMs: undefined });
    });
  });

  describe('execForOutput (the history download)', () => {
    it('returns stdout on success', async () => {
      const { service, factory } = setup();
      factory.exec.mockResolvedValue({ stdout: 'scrollback', stderr: '', exitCode: 0, signal: null });
      await expect(service.execForOutput(profile, 'tmux show-buffer')).resolves.toBe('scrollback');
    });

    it('rejects with the trimmed stderr when the command failed and wrote to stderr', async () => {
      const { service, factory } = setup();
      factory.exec.mockResolvedValue({ stdout: '', stderr: "can't find session\n", exitCode: 1, signal: null });
      await expect(service.execForOutput(profile, 'x')).rejects.toThrow("can't find session");
    });

    it('returns stdout when the command failed silently (the old rule: stderr decides)', async () => {
      const { service, factory } = setup();
      factory.exec.mockResolvedValue({ stdout: 'partial', stderr: '', exitCode: 1, signal: null });
      await expect(service.execForOutput(profile, 'x')).resolves.toBe('partial');
    });
  });
});
