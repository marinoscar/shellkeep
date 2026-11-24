// =============================================================================
// ShellKeep's starter alert rules over a real database (issue #54)
// =============================================================================
//
// The seed runs against the migrated `alert_rules` table (the platform migration
// `add_alerts`, with its unique `key`): the four rules appear disabled, a second start
// does not overwrite what an administrator edited, and two replicas seeding at once leave
// one row per key. Run with `npm run test:db`.
// =============================================================================

import '../../src/shellkeep.manifest';
import '../../src/app-registrations/registrations';

import { registerBuiltinAlertKinds } from '@marinoscar/platform-api/alerts';

import { PrismaService } from '../../src/prisma/prisma.service';
import { TerminalAlertRulesSeed } from '../../src/terminal/alerts/terminal-alert-rules.seed';
import { TERMINAL_STARTER_ALERT_RULES } from '../../src/terminal/alerts/terminal.starter-alert-rules';

registerBuiltinAlertKinds();

const KEYS = TERMINAL_STARTER_ALERT_RULES.map((entry) => entry.key);

describe('TerminalAlertRulesSeed (real database)', () => {
  let prisma: PrismaService;
  let seed: TerminalAlertRulesSeed;

  beforeAll(async () => {
    prisma = new PrismaService();
    seed = new TerminalAlertRulesSeed(prisma as never);
    await prisma.alertRule.deleteMany({ where: { key: { in: KEYS } } });
  });

  afterAll(async () => {
    await prisma.alertRule.deleteMany({ where: { key: { in: KEYS } } });
    await prisma.$disconnect();
  });

  it('seeds the four rules disabled, with their kinds and severities', async () => {
    expect(await seed.seed()).toBe(4);
    const rows = await prisma.alertRule.findMany({ where: { key: { in: KEYS } }, orderBy: { key: 'asc' } });
    expect(rows.map((row) => row.key).sort()).toEqual([...KEYS].sort());
    for (const row of rows) expect(row.enabled).toBe(false);
    expect(rows.find((row) => row.key === 'shellkeep.reaper_stalled')).toMatchObject({
      kind: 'terminal_job_stalled',
      severity: 'critical',
    });
  });

  it('never overwrites an edited, enabled rule on a later start', async () => {
    await prisma.alertRule.update({
      where: { key: 'shellkeep.ssh_connect_failures' },
      data: { enabled: true, name: 'Our SSH failures', config: { metric: 'app_terminal_ssh_connect_duration_seconds_count', aggregation: 'rate', windowSeconds: 600, comparator: 'gt', threshold: 25 } },
    });
    expect(await seed.seed()).toBe(0);
    const row = await prisma.alertRule.findUniqueOrThrow({ where: { key: 'shellkeep.ssh_connect_failures' } });
    expect(row).toMatchObject({ enabled: true, name: 'Our SSH failures' });
    expect((row.config as { threshold: number }).threshold).toBe(25);
  });

  it('two replicas seeding at once leave one row per key', async () => {
    await prisma.alertRule.deleteMany({ where: { key: { in: KEYS } } });
    await Promise.all([seed.seed(), seed.seed(), seed.seed()]);
    expect(await prisma.alertRule.count({ where: { key: { in: KEYS } } })).toBe(4);
  });
});
