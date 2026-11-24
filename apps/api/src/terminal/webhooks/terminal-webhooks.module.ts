import { Module } from '@nestjs/common';

import { webhooksModule } from '../../platform/webhooks/webhooks.config';
import { TerminalWebhooksService } from './terminal-webhooks.service';

/**
 * Raises ShellKeep's webhook events. Imported by the modules that emit (`TerminalModule`,
 * `ServerProfilesModule`); it imports the configured webhooks slice for `WebhooksService`
 * (the same dynamic module `AppModule` mounts, so Nest composes it once).
 */
@Module({
  imports: [webhooksModule],
  providers: [TerminalWebhooksService],
  exports: [TerminalWebhooksService],
})
export class TerminalWebhooksModule {}
