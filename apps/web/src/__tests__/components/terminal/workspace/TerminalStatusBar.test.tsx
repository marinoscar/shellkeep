import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '../../../utils/test-utils';
import {
  TerminalStatusBar,
  algorithmLabel,
  shortFingerprint,
} from '../../../../components/terminal/workspace/TerminalStatusBar';
import type { TerminalSession } from '../../../../types';

const session = {
  id: 's1',
  name: 'alpha',
  status: 'active',
  tmuxSessionId: 'sk-0000aaaa',
  serverProfile: { name: 'Server A', hostname: 'server-a.example.test', port: 2222, username: 'person-a', color: 'default' },
} as TerminalSession;

describe('TerminalStatusBar (#77)', () => {
  it('shows host, latency, a trusted key and the tmux session', () => {
    render(
      <TerminalStatusBar session={session} connected latencyMs={22} cols={132} rows={38} hostKey="trusted"
        fingerprint="SHA256:q3VtAbCdEfGhIjKl9Lk" algorithm="ssh-ed25519" />,
    );
    const bar = screen.getByTestId('terminal-status-bar');
    expect(bar).toHaveTextContent('person-a@server-a.example.test:2222');
    expect(bar).toHaveTextContent('rtt 22 ms');
    expect(bar).toHaveTextContent('host key trusted');
    expect(bar).toHaveTextContent('ED25519 SHA256:q3Vt…9Lk');
    expect(bar).toHaveTextContent('tmux sk-0000aaaa · 132×38');
  });

  it('shows a changed key and a lost connection', () => {
    render(<TerminalStatusBar session={session} connected={false} latencyMs={null} cols={null} rows={null} hostKey="mismatch" />);
    const bar = screen.getByTestId('terminal-status-bar');
    expect(bar).toHaveTextContent('not connected');
    expect(bar).toHaveTextContent('host key changed');
    expect(screen.getByLabelText('Host key: host key changed')).toBeInTheDocument();
  });

  it('leaves the host key out until the profile is read, and is short on a phone', () => {
    render(<TerminalStatusBar session={session} connected latencyMs={9} cols={40} rows={20} hostKey={null} compact />);
    const bar = screen.getByTestId('terminal-status-bar');
    expect(bar).not.toHaveTextContent('host key');
    expect(bar).toHaveTextContent('server-a.example.test');
    expect(bar).not.toHaveTextContent('person-a@');
    expect(bar).toHaveTextContent('9 ms');
    expect(bar).not.toHaveTextContent('40×20');
  });

  it('formats fingerprints and algorithms', () => {
    expect(shortFingerprint('SHA256:abcdefghijklmnop')).toBe('SHA256:abcd…nop');
    expect(shortFingerprint('short')).toBe('short');
    expect(algorithmLabel('ssh-ed25519')).toBe('ED25519');
    expect(algorithmLabel('ecdsa-sha2-nistp256')).toBe('ECDSA');
    expect(algorithmLabel('ssh-rsa')).toBe('RSA');
  });
});
