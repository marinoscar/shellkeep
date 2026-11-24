import { redactText } from './redact';
import { stripAnsi } from './strip-ansi';

// Invented, structurally valid fixtures. None is a real credential.
// Assembled at run time so no secret-shaped literal sits in the repository (push scanners flag them).
const AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');
const AWS_SECRET_VALUE = ['wJalrXUtnFEMI', '/K7MDENG/', 'bPxRfiCYzZZZZZZZZZ'].join('');
const PEM = [
  '-----BEGIN RSA PRIVATE KEY-----',
  ...Array.from({ length: 30 }, (_, i) => `MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Q${i}`),
  '-----END RSA PRIVATE KEY-----',
].join('\n');

const kinds = (text: string, mode: 'standard' | 'strict' = 'standard') =>
  redactText(text, { mode }).findings.map((f) => f.kind);

describe('redactText: one positive and one negative per kind', () => {
  const positives: Array<[string, string, string]> = [
    ['aws_access_key', `key ${AWS_KEY} end`, AWS_KEY],
    ['aws_secret', `aws_secret_access_key = ${AWS_SECRET_VALUE}`, 'wJalrXUtnFEMI'],
    ['github_token', `t ghp_${'a1B2c3D4e5'.repeat(4)}`, 'ghp_a1B2'],
    ['github_token', `github_pat_${'A1b2C3d4E5'.repeat(7)}`, 'github_pat_A1b2'],
    ['slack_token', 'xoxb-1234567890-abcdefghij', 'xoxb-1234567890'],
    ['google_api_key', 'AIzaSy0123456789abcdefghijklmnopqrstuvw', 'AIzaSy0123'],
    ['llm_key', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz', 'sk-ant-api03'],
    ['llm_key', 'sk-proj-abcdefghijklmnopqrstuvwxyz', 'sk-proj-abcdef'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2ln-_abc', 'eyJhbGci'],
    ['private_key', PEM, 'MIIBOgIBAAJB'],
    ['url_credentials', 'git clone https://deploy:s3cretpw@git.example.test/x.git', 's3cretpw'],
    ['auth_header', 'Authorization: Bearer abc.def.ghi', 'abc.def.ghi'],
    ['kv_secret', 'DB_PASSWORD=hunter2hunter2', 'hunter2hunter2'],
    ['platform_token', 'pat_abcdefghijklmnop1234', 'pat_abcdef'],
    ['platform_token', 'nod_abcdefghijklmnop1234', 'nod_abcdef'],
  ];
  it.each(positives)('%s is redacted', (kind, input, secret) => {
    const r = redactText(input);
    expect(r.findings.map((f) => f.kind)).toContain(kind);
    expect(r.text).not.toContain(secret);
    expect(r.text).toContain(`[REDACTED:${kind}]`);
  });

  const negatives: Array<[string, string]> = [
    ['aws_access_key', 'AKIA-short and ASIA123'],
    ['aws_secret', 'aws_secret_access_key is configured'],
    ['github_token', 'ghp_short'],
    ['slack_token', 'xoxb-short'],
    ['google_api_key', 'AIza-short'],
    ['llm_key', 'sk-learn is a library, sk-short'],
    ['jwt', 'eyJ.eyJ'],
    ['private_key', '-----BEGIN CERTIFICATE-----'],
    ['url_credentials', 'https://git.example.test/x.git and ssh://user@host'],
    ['auth_header', 'Authorization: required'],
    ['kv_secret', 'Enter password:\nnext-line-word'],
    ['platform_token', 'pat_short nod_x'],
  ];
  it.each(negatives)('%s is not triggered by a look-alike', (kind, input) => {
    expect(kinds(input)).not.toContain(kind);
  });
});

describe('redactText: details', () => {
  it('keeps the scheme and host of a URL with credentials', () => {
    expect(redactText('https://u:p@host.example.test/a').text).toBe(
      'https://[REDACTED:url_credentials]@host.example.test/a',
    );
  });

  it('keeps the key of a key=value secret', () => {
    expect(redactText('api_key: abc123').text).toBe('api_key: [REDACTED:kv_secret]');
  });

  it('turns a 30-line PEM block into exactly one token', () => {
    const r = redactText(`before\n${PEM}\nafter`);
    expect(r.text).toBe('before\n[REDACTED:private_key]\nafter');
    expect(r.findings).toEqual([{ kind: 'private_key', count: 1 }]);
  });

  it('redacts an unterminated PEM block to the end', () => {
    expect(redactText('x\n-----BEGIN PRIVATE KEY-----\nAAAA\nBBBB').text).toBe('x\n[REDACTED:private_key]');
  });

  it('redacts exact literals', () => {
    const r = redactText('deploy with tr0ub4dor now', { extraLiterals: ['tr0ub4dor'] });
    expect(r.text).toBe('deploy with [REDACTED:literal] now');
    expect(redactText('abc', { extraLiterals: ['ab'] }).text).toBe('abc');
  });

  it('counts per kind', () => {
    const r = redactText(`${AWS_KEY} ${AWS_KEY.replace('AKIA', 'ASIA')}`);
    expect(r.findings).toEqual([{ kind: 'aws_access_key', count: 2 }]);
  });

  it('strict mode drops every line that had a finding', () => {
    const r = redactText(`ok one\nexport TOKEN=abc\nok two\n${PEM}\nok three`, { mode: 'strict' });
    expect(r.text).toBe('ok one\n[REDACTED LINE]\nok two\n[REDACTED LINE]\nok three');
  });

  it('standard mode keeps lines', () => {
    expect(redactText('a\nTOKEN=abc\nb').text).toBe('a\nTOKEN=[REDACTED:kv_secret]\nb');
  });
});

describe('redactText: entropy pass', () => {
  it('redacts a long random token', () => {
    const r = redactText('secret blob: Zk9fQ2xhdWRlX3Rlc3RfdG9rZW5fWFlaMTIzNDU2Nzg5');
    expect(kinds(r.text)).toEqual([]);
    expect(r.findings.map((f) => f.kind)).toContain('high_entropy');
  });

  it('redacts a long hex run', () => {
    const hex = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08ffee';
    expect(redactText(`k ${hex}`).findings.map((f) => f.kind)).toContain('high_entropy');
  });

  it('leaves the benign corpus untouched', () => {
    const corpus = [
      'id 123e4567-e89b-12d3-a456-426614174000',
      'commit 3f2a1b9c8d7e6f5a4b3c2d1e0f9a8b7c6d5e4f3a',
      'commit 3f2a1b9',
      'image sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
      '/usr/lib/x86_64-linux-gnu/libstdc++/gcc/something',
      'the_quick_brown_fox_jumps_over_the_lazy_dog',
      'drwxr-xr-x 2 root root 4096 Nov 24 10:00 node_modules',
      'systemd-journald.service-stopped-deactivated',
    ].join('\n');
    const r = redactText(corpus);
    expect(r.findings).toEqual([]);
    expect(r.text).toBe(corpus);
  });
});

describe('stripAnsi', () => {
  it('removes CSI, OSC and DCS sequences and normalises newlines', () => {
    const raw = '\u001b[31mred\u001b[0m\u001b]0;title\u0007 ok\u001bP1$r\u001b\\ done\r\nnext\rlast';
    expect(stripAnsi(raw)).toBe('red ok done\nnext\nlast');
  });

  it('removes OSC terminated by ST', () => {
    expect(stripAnsi('a\u001b]8;;http://x\u001b\\link\u001b]8;;\u001b\\b')).toBe('alinkb');
  });
});
