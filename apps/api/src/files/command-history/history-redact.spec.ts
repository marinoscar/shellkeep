import { REDACTION_KINDS } from '../../command-safety';
import { redactHistory, redactHistoryEntry } from './history-redact';

const masked = (command: string): string => {
  const r = redactHistoryEntry(command);
  expect(r.masked).toBe(true);
  expect(r.command).not.toBeNull();
  return r.command as string;
};

describe('history redaction', () => {
  it('leaves an ordinary command alone', () => {
    expect(redactHistoryEntry('git commit -m "fix: the thing" && ls -la /var/log')).toEqual({
      command: 'git commit -m "fix: the thing" && ls -la /var/log',
      masked: false,
    });
    expect(redactHistoryEntry('docker run --password-stdin x').masked).toBe(false);
    expect(redactHistoryEntry('mysql -p').masked).toBe(false);
  });

  it('masks password and token flags in both forms', () => {
    expect(masked('mycli --password hunter2 run')).toBe('mycli --password [REDACTED:password_flag] run');
    expect(masked('mycli --password=hunter2 run')).toBe('mycli --password=[REDACTED:password_flag] run');
    expect(masked("mycli --token 'a b c' go")).toBe('mycli --token [REDACTED:password_flag] go');
    expect(masked('deploy --api-key abcdef --env prod')).toBe('deploy --api-key [REDACTED:password_flag] --env prod');
  });

  it('masks sshpass -p', () => {
    expect(masked('sshpass -p hunter2 ssh user@host')).toBe('sshpass -p [REDACTED:password_flag] ssh user@host');
    expect(masked('sshpass -e -p hunter2 ssh user@host')).toContain('[REDACTED:password_flag]');
    expect(masked('sshpass -p hunter2 ssh user@host')).not.toContain('hunter2');
  });

  it('masks an attached mysql -p password and keeps the rest', () => {
    expect(masked('mysql -u root -phunter2 appdb')).toBe('mysql -u root -p[REDACTED:password_flag] appdb');
    expect(masked('mysqldump -uroot -phunter2 db > dump.sql')).not.toContain('hunter2');
  });

  it('masks curl basic auth but keeps the user', () => {
    expect(masked('curl -u admin:hunter2 https://example.test/api')).toBe('curl -u admin:[REDACTED:basic_auth_flag] https://example.test/api');
  });

  it('masks export and inline assignments of secret-named variables', () => {
    expect(masked('export DB_PASS=hunter2')).toBe('export DB_PASS=[REDACTED:credential_assignment]');
    expect(masked('SERVICE_TOKEN=abc123 ./run.sh')).toBe('SERVICE_TOKEN=[REDACTED:credential_assignment] ./run.sh');
    expect(masked('export PGPASSWORD=hunter2')).not.toContain('hunter2');
  });

  it('masks URLs with credentials and auth headers', () => {
    expect(masked('git clone https://person-a:hunter2@example.test/repo.git')).toBe('git clone https://[REDACTED:url_credentials]@example.test/repo.git');
    expect(masked('curl -H "Authorization: Bearer abc.def.ghi" https://example.test')).toContain('[REDACTED:auth_header]');
  });

  it('masks provider tokens and keys from the terminal redactor', () => {
    const cases: Array<[string, string]> = [
      ['aws_access_key', 'aws s3 ls --profile AKIAABCDEFGHIJKLMNOP'],
      ['github_token', `git push https://x@example.test ghp_${'a1B2'.repeat(10)}`],
      ['slack_token', 'notify xoxb-1234567890-abcdefghij'],
      ['google_api_key', `curl ?key=AIza${'a1B2c3D4'.repeat(4)}1234`],
      ['llm_key', `run --k sk-ant-${'a1B2c3'.repeat(5)}`],
      ['jwt', 'curl -b eyJhbGciOi.eyJzdWIiOiIx.abc_DEF-123 https://example.test'],
      ['platform_token', `appctl login pat_${'a1B2c3D4'.repeat(3)}`],
    ];
    for (const [kind, command] of cases) {
      expect(masked(command)).toContain(`[REDACTED:${kind}]`);
    }
    // Every kind the terminal redactor reports is one the history can show.
    expect(REDACTION_KINDS).toContain('jwt');
  });

  it('masks a high-entropy token inside a command', () => {
    expect(masked('echo q8Zx3KfP9vLm2NwR7TjB5HcY4DsA')).toContain('[REDACTED:high_entropy]');
  });

  it('drops an entry that is entirely a secret', () => {
    expect(redactHistoryEntry(`ghp_${'a1B2'.repeat(10)}`)).toEqual({ command: null, masked: true });
    expect(redactHistoryEntry('q8Zx3KfP9vLm2NwR7TjB5HcY4DsA')).toEqual({ command: null, masked: true });
    expect(redactHistoryEntry('-----BEGIN RSA PRIVATE KEY-----')).toEqual({ command: null, masked: true });
  });

  it('counts dropped entries and dedupes entries that mask to the same text', () => {
    const r = redactHistory(['export A_PASS=one', 'export A_PASS=two', 'ls', `ghp_${'a1B2'.repeat(10)}`]);
    expect(r.dropped).toBe(1);
    expect(r.entries.map((e) => e.command)).toEqual(['export A_PASS=[REDACTED:credential_assignment]', 'ls']);
  });
});
