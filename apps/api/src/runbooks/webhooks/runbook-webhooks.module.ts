import { Module } from '@nestjs/common';

import { webhooksModule } from '../../platform/webhooks/webhooks.config';
import { PrismaModule } from '../../prisma/prisma.module';
import { RunbookWebhooksService } from './runbook-webhooks.service';

/** Raises ShellKeep's runbook webhook events; imports the configured webhooks slice for `WebhooksService`. */
@Module({
  imports: [webhooksModule, PrismaModule],
  providers: [RunbookWebhooksService],
  exports: [RunbookWebhooksService],
})
export class RunbookWebhooksModule {}
