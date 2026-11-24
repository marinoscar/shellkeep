import { looksLikeSecret } from './secret-detector';

// Every literal below is invented or assembled at run time; none is a real credential.
const join = (...parts: string[]) => parts.join('');

describe('looksLikeSecret', () => {
  it.each([
    ['a private key header', `${join('-----BEGIN ', 'OPENSSH PRIVATE', ' KEY-----')}\nabc`],
    ['an RSA private key header', join('-----BEGIN RSA ', 'PRIVATE KEY-----')],
    ['password=', 'mysql -u app --password=hunter22 -h db'],
    ['password: with spaces', 'password : Sup3rSecret'],
    ['an api key assignment', 'export API_KEY=abcd1234efgh'],
    ['an AWS access key id', `aws configure set aws_access_key_id ${join('AKIA', 'ABCDEFGHIJKLMNOP')}`],
    ['a GitHub token', `git clone https://x@example.test/r.git # ${join('ghp_', 'a'.repeat(36))}`],
    ['a bearer header', `curl -H "Authorization: Bearer ${'Ab1'.repeat(8)}" https://example.test`],
    ['credentials in a URL', 'psql postgres://app:s3cretpw@db.example.test/main'],
    ['sshpass', 'sshpass -p hunter22 ssh host.example.test'],
    ['a long high-entropy token', `export X=${join('Zk9QpL2vXr8TnB4yHc7WmD1sFg6JaE3u', 'Vq5')}`],
  ])('flags %s', (_name, body) => {
    expect(looksLikeSecret(body)).toBe(true);
  });

  it.each([
    ['a plain command', 'docker compose logs -f --tail=100 api'],
    ['a placeholder password', 'mysql -u {{user}} --password={{password}}'],
    ['a shell variable password', 'curl -u app:x --data password=$DB_PASSWORD https://example.test'],
    ['a word that merely contains token', 'echo tokenize the words'],
    ['a long path', 'cd /var/lib/some/very/long/directory/name/that/keeps/going/and/going'],
    ['a git sha (lower-case hex)', 'git show 3b18e512dba79e4c8300dd08aeb37f8e728b8dad'],
    ['multi-line text', 'line one\nline two\n\tindented'],
  ])('does not flag %s', (_name, body) => {
    expect(looksLikeSecret(body)).toBe(false);
  });
});
