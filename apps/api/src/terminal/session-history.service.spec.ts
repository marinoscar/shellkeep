import { BadRequestException, HttpException } from '@nestjs/common';
import { HostKeyError } from '../ssh/host-key.error';
import { SessionHistoryService } from './session-history.service';

const scope = { userId: 'user-1', orgId: 'org-1' };
const session = { id: 's1', status: 'active', serverProfileId: 'p1', tmuxSessionId: 'sk-abc123' };

function setup(exec: jest.Mock = jest.fn().mockResolvedValue('pane text')) {
  const sessions = { findOne: jest.fn().mockResolvedValue(session) };
  const ssh = { execForOutput: exec };
  const profiles = { getDecryptedProfileForSession: jest.fn().mockResolvedValue({ id: 'p1' }) };
  const service = new SessionHistoryService(sessions as never, ssh as never, profiles as never);
  return { service, sessions, ssh, profiles };
}

describe('SessionHistoryService', () => {
  it('reads the credential through the access-checked path, for the history purpose', async () => {
    const { service, profiles } = setup();
    await service.captureSession(session, scope);
    expect(profiles.getDecryptedProfileForSession).toHaveBeenCalledWith('p1', scope, 'history');
  });

  it('captures the whole history with joined lines by default', async () => {
    const { service, ssh } = setup();
    await expect(service.capture('s1', scope)).resolves.toBe('pane text');
    expect(ssh.execForOutput).toHaveBeenCalledWith({ id: 'p1' }, 'tmux capture-pane -p -J -S - -t sk-abc123');
  });

  it('captures the last N lines', async () => {
    const { service, ssh } = setup();
    await service.capture('s1', scope, { lines: 40 });
    expect(ssh.execForOutput.mock.calls[0][1]).toBe('tmux capture-pane -p -J -S -40 -t sk-abc123');
  });

  it('keeps the history download raw: no -J, the whole scrollback', async () => {
    const { service, ssh } = setup();
    await service.captureSession(session, scope, { joinWrapped: false });
    expect(ssh.execForOutput.mock.calls[0][1]).toBe('tmux capture-pane -p -S - -t sk-abc123');
  });

  it('checks ownership through SessionsService', async () => {
    const { service, sessions } = setup();
    await service.capture('s1', scope);
    expect(sessions.findOne).toHaveBeenCalledWith('s1', scope);
  });

  it('refuses a terminated session', async () => {
    const { service } = setup();
    await expect(service.captureSession({ ...session, status: 'terminated' }, scope)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('refuses a tmux id that is not shell-inert', async () => {
    const { service, ssh } = setup();
    await expect(service.captureSession({ ...session, tmuxSessionId: 'x; reboot' }, scope)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(ssh.execForOutput).not.toHaveBeenCalled();
  });

  it('maps a vanished tmux session to 404', async () => {
    const { service } = setup(jest.fn().mockRejectedValue(new Error("can't find session: sk-abc123")));
    await expect(service.captureSession(session, scope)).rejects.toMatchObject({ status: 404 });
  });

  it('maps any other failure to 502 without echoing its message', async () => {
    const { service } = setup(jest.fn().mockRejectedValue(new Error('boom: secret detail')));
    const error = await service.captureSession(session, scope).catch((e) => e as HttpException);
    expect(error).toMatchObject({ status: 502 });
    expect((error as HttpException).message).not.toContain('secret detail');
  });

  it('maps a host-key refusal to a 409 envelope', async () => {
    const hostKey = new HostKeyError('HOST_KEY_UNKNOWN', { fingerprint: 'SHA256:x', algorithm: 'ssh-ed25519' } as never);
    const { service } = setup(jest.fn().mockRejectedValue(hostKey));
    await expect(service.captureSession(session, scope)).rejects.toMatchObject({ status: 409 });
  });

  it('reads the pane working directory, and null when it cannot', async () => {
    const ok = setup(jest.fn().mockResolvedValue('/srv/app\n'));
    await expect(ok.service.currentPath(session, scope)).resolves.toBe('/srv/app');
    expect(ok.ssh.execForOutput.mock.calls[0][1]).toBe(
      "tmux display-message -p -t sk-abc123 '#{pane_current_path}'",
    );
    const bad = setup(jest.fn().mockRejectedValue(new Error('x')));
    await expect(bad.service.currentPath(session, scope)).resolves.toBeNull();
  });
});
