import { SERVER_FACTS_COMMAND, parseServerFacts, serverFactsSchema } from './server-facts';

const DEBIAN = `Linux 6.1.0-18-amd64 x86_64
PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"
NAME="Debian GNU/Linux"
VERSION_ID="12"
VERSION="12 (bookworm)"
ID=debian
HOME_URL="https://www.debian.org/"
SHELL=/bin/bash
HAS=tmux
HAS=sudo
HAS=apt-get
HAS=python3
`;

const ALPINE = `Linux 6.6.14-0-lts x86_64
NAME="Alpine Linux"
ID=alpine
VERSION_ID=3.19.1
PRETTY_NAME="Alpine Linux v3.19"
SHELL=/bin/ash
HAS=apk
`;

const MACOS = `Darwin 23.4.0 arm64
SHELL=/bin/zsh
HAS=tmux
HAS=brew
HAS=python3
`;

describe('SERVER_FACTS_COMMAND', () => {
  it('is the one fixed read-only line of the issue', () => {
    expect(SERVER_FACTS_COMMAND).toBe(
      'uname -srm; cat /etc/os-release 2>/dev/null; echo "SHELL=$SHELL"; ' +
        'for b in tmux sudo apt-get dnf yum apk zypper brew python3; do command -v $b >/dev/null 2>&1 && echo "HAS=$b"; done',
    );
  });
});

describe('parseServerFacts', () => {
  it('parses a Debian host: distro, shell, tools and apt', () => {
    expect(parseServerFacts(DEBIAN)).toEqual({
      kernel: 'Linux 6.1.0-18-amd64 x86_64',
      os: 'linux',
      distroId: 'debian',
      distroVersion: '12',
      prettyName: 'Debian GNU/Linux 12 (bookworm)',
      shell: '/bin/bash',
      has: ['tmux', 'sudo', 'apt-get', 'python3'],
      packageManager: 'apt',
    });
  });

  it('parses an Alpine host (unquoted values) with apk', () => {
    expect(parseServerFacts(ALPINE)).toMatchObject({
      os: 'linux',
      distroId: 'alpine',
      distroVersion: '3.19.1',
      shell: '/bin/ash',
      has: ['apk'],
      packageManager: 'apk',
    });
  });

  it('parses macOS: no os-release, brew', () => {
    const facts = parseServerFacts(MACOS);
    expect(facts).toMatchObject({ os: 'darwin', shell: '/bin/zsh', packageManager: 'brew', has: ['tmux', 'brew', 'python3'] });
    expect(facts.distroId).toBeUndefined();
  });

  it('prefers apt over dnf over yum when several exist, and reports none when none exists', () => {
    expect(parseServerFacts('Linux 6 x86_64\nHAS=yum\nHAS=dnf\n').packageManager).toBe('dnf');
    expect(parseServerFacts('Linux 6 x86_64\nHAS=yum\nHAS=apt-get\n').packageManager).toBe('apt');
    expect(parseServerFacts('Linux 6 x86_64\nSHELL=/bin/sh\n').packageManager).toBeUndefined();
  });

  it('maps an unknown kernel to other and survives an empty $SHELL', () => {
    expect(parseServerFacts('SunOS 5.11 i86pc\nSHELL=\n')).toMatchObject({ os: 'other', has: [] });
    expect(parseServerFacts('FreeBSD 14.0-RELEASE amd64\n').os).toBe('freebsd');
  });

  it('ignores garbage HAS lines and duplicates, and tolerates CRLF', () => {
    const facts = parseServerFacts('Linux 6 x86_64\r\nHAS=tmux\r\nHAS=tmux\r\nHAS=rm -rf /\r\nHAS=\r\n');
    expect(facts.has).toEqual(['tmux']);
  });

  it('rejects an empty output', () => {
    expect(() => parseServerFacts('')).toThrow(/no output/);
    expect(() => parseServerFacts('\n \n')).toThrow(/no output/);
  });

  it('produces a value its own schema accepts', () => {
    expect(serverFactsSchema.safeParse(parseServerFacts(DEBIAN)).success).toBe(true);
  });
});
