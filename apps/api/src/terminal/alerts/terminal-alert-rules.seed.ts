// =============================================================================
// Seeding ShellKeep's starter alert rules (issue #54)
// =============================================================================
//
// The alerts slice seeds ITS starter rules (`STARTER_ALERT_RULES`, a fixed list with no hook
// for an app's), so ShellKeep seeds its own the same way: once the application has
// bootstrapped, for each stable key, INSERT IF ABSENT, always disabled. A rule that exists
// is never touched, so an administrator's edit, enabling or threshold survives every restart
// and every replica starting at once (the unique key makes the second insert a no-op).
//
// A failure is logged, never thrown: a missing starter rule must not stop the API.
// Listed in docs/platform-adoption/local-exceptions.md.
// =============================================================================

import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import { isUniqueViolation, parseAlertConfig, type AlertsPrisma } from '@marinoscar/platform-api/alerts';

import { TERMINAL_STARTER_ALERT_RULES, type TerminalStarterRule } from './terminal.starter-alert-rules';

/** The two slice functions the seed needs, as a structural port (a test passes a fake). */
export interface TerminalAlertRulesDb {
  alertRule: Pick<AlertsPrisma['alertRule'], 'findUnique' | 'create'>;
}

@Injectable()
export class TerminalAlertRulesSeed implements OnApplicationBootstrap {
  private readonly logger = new Logger(TerminalAlertRulesSeed.name);

  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: TerminalAlertRulesDb) {}

  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.seed();
    } catch (error) {
      this.logger.warn(`Could not seed the ShellKeep starter alert rules: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Creates the missing starter rules (disabled).
   *
   * @param rules - the rules to seed; the four ShellKeep ones by default.
   * @returns how many were created.
   */
  async seed(
    rules: readonly TerminalStarterRule[] = TERMINAL_STARTER_ALERT_RULES,
    parseConfig: (kind: string, config: unknown) => unknown = parseAlertConfig,
  ): Promise<number> {
    let created = 0;
    for (const { key, rule } of rules) {
      if (await this.prisma.alertRule.findUnique({ where: { key } })) continue;
      try {
        await this.prisma.alertRule.create({
          data: { ...rule, key, enabled: false, config: parseConfig(rule.kind, rule.config), description: rule.description ?? null },
        });
        created += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error; // another replica seeded it first
      }
    }
    if (created > 0) this.logger.log(`Seeded ${created} ShellKeep starter alert rule(s), all disabled.`);
    return created;
  }
}
