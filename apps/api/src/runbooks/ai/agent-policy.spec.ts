import RE2 from 're2';

import { AgentPolicy } from './agent-policy';

const policy = (over: Partial<ConstructorParameters<typeof AgentPolicy>[0]> = {}) =>
  new AgentPolicy({ approvalMode: 'autonomous_within_allowlist', allow: ['^systemctl (status|restart) '], deny: [], ...over });

describe('AgentPolicy.checkCommand', () => {
  it('allows a command that matches an allow pattern', () => {
    expect(policy().checkCommand('systemctl status nginx')).toEqual({ allowed: true });
  });

  it('lets deny win over allow', () => {
    const p = policy({ allow: ['^systemctl '], deny: ['restart'] });
    expect(p.checkCommand('systemctl restart nginx')).toMatchObject({ allowed: false, code: 'DENY_PATTERN' });
    expect(p.checkCommand('systemctl status nginx')).toEqual({ allowed: true });
  });

  it('refuses a destructive command even when an allow pattern matches it', () => {
    const p = policy({ allow: ['.*'] });
    expect(p.checkCommand('mkfs.ext4 /dev/sdb1')).toMatchObject({ allowed: false, code: 'DESTRUCTIVE' });
    expect(p.checkCommand('rm -rf /')).toMatchObject({ allowed: false, code: 'DESTRUCTIVE' });
  });

  it('refuses a command no allow pattern matches in autonomous mode', () => {
    expect(policy().checkCommand('ls -la /var/log')).toMatchObject({ allowed: false, code: 'NOT_ALLOWLISTED' });
  });

  it('needs no allow match when a person decides (per_command, plan)', () => {
    for (const approvalMode of ['per_command', 'plan'] as const) {
      const p = policy({ approvalMode, allow: [] });
      expect(p.checkCommand('ls -la /var/log')).toEqual({ allowed: true });
      // deny and destructive still refuse
      expect(policy({ approvalMode, allow: [], deny: ['^ls'] }).checkCommand('ls /')).toMatchObject({ code: 'DENY_PATTERN' });
      expect(p.checkCommand('mkfs.ext4 /dev/sdb1')).toMatchObject({ code: 'DESTRUCTIVE' });
    }
  });

  it('refuses an empty command and a command that names a sensitive path', () => {
    const p = policy({ allow: ['.*'] });
    expect(p.checkCommand('   ')).toMatchObject({ code: 'EMPTY' });
    for (const command of ['cat /etc/shadow', 'cat ~/.ssh/id_ed25519', 'ls /root/.ssh', 'cp /srv/tls/site.pem /tmp', 'head /srv/tls/site.key', 'cat /proc/1/environ']) {
      expect(p.checkCommand(command)).toMatchObject({ allowed: false, code: 'SENSITIVE_PATH' });
    }
    // near misses are not sensitive
    expect(p.checkCommand('ls /var/keyring /home/me/ssh')).toEqual({ allowed: true });
  });

  it('fails closed on a pattern that does not compile', () => {
    expect(policy({ allow: ['.*'], deny: ['(unclosed'] }).checkCommand('uptime')).toMatchObject({ code: 'DENY_PATTERN' });
    expect(policy({ allow: ['(unclosed'] }).checkCommand('uptime')).toMatchObject({ code: 'NOT_ALLOWLISTED' });
  });

  it('compiles patterns with RE2, the linear-time engine, never a backtracking RegExp', () => {
    // Backreferences and lookaheads exist only in a backtracking engine. RE2 refuses them, so the
    // pattern fails closed; a fallback to RegExp would make `(a)\\1` match 'aa' and be allowed.
    expect(policy({ allow: ['^(a)\\1$'] }).checkCommand('aa')).toMatchObject({ allowed: false, code: 'NOT_ALLOWLISTED' });
    expect(policy({ allow: ['^a(?=b)'] }).checkCommand('ab')).toMatchObject({ allowed: false, code: 'NOT_ALLOWLISTED' });
    expect(policy({ allow: ['.*'], deny: ['^(a)\\1$'] }).checkCommand('anything')).toMatchObject({ allowed: false, code: 'DENY_PATTERN' });
    // Sanity: the same constructs are valid in a backtracking engine, so the refusal above is RE2's.
    expect(new RegExp('^(a)\\1$').test('aa')).toBe(true);
    expect(() => new RE2('^(a)\\1$', 'u')).toThrow();
  });

  // The test timeout is only a generous hang bound; correctness is asserted, not elapsed time.
  it('answers a catastrophic-backtracking fixture correctly', () => {
    const p = policy({ allow: ['^(a+)+$'], deny: ['(x+x+)+y'] });
    expect(p.checkCommand(`${'a'.repeat(5000)}!`)).toMatchObject({ allowed: false, code: 'NOT_ALLOWLISTED' });
    expect(p.checkCommand('a'.repeat(5000))).toEqual({ allowed: true });
    expect(p.checkCommand('x'.repeat(5000))).toMatchObject({ allowed: false });
    expect(p.checkCommand(`${'x'.repeat(5000)}y`)).toMatchObject({ allowed: false, code: 'DENY_PATTERN' });
  }, 10_000);
});

describe('AgentPolicy.checkPath', () => {
  const p = policy();

  it('allows ordinary absolute paths', () => {
    expect(p.checkPath('/var/log/nginx/error.log')).toEqual({ allowed: true });
    expect(p.checkPath('/etc/nginx/nginx.conf')).toEqual({ allowed: true });
  });

  it('refuses the sensitive reads, however the path is spelled', () => {
    for (const path of ['/etc/shadow', '/etc/gshadow-', '/root/.ssh/authorized_keys', '/home/me/.ssh', '/a/../etc/shadow', '/srv/tls/site.pem', '/srv/tls/site.key', '/etc/ssl/private/ca']) {
      expect(p.checkPath(path)).toMatchObject({ allowed: false, code: 'SENSITIVE_PATH' });
    }
  });

  it('refuses a relative path', () => {
    expect(p.checkPath('etc/hosts')).toMatchObject({ allowed: false });
  });
});
