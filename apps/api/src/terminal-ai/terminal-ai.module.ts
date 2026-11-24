import { Module } from '@nestjs/common';

import { AiModule } from '../platform/ai/ai.config';
import { PrismaModule } from '../prisma/prisma.module';
import { TerminalModule } from '../terminal/terminal.module';
import { TerminalAiConsentController } from './terminal-ai-consent.controller';
import { SessionSummarizeHandler } from './jobs/session-summarize.handler';
import { SessionSummaryController } from './session-summary.controller';
import { SessionSummaryService } from './session-summary.service';
import { TerminalAssistController } from './terminal-assist.controller';
import { TerminalAssistService } from './terminal-assist.service';
import { TerminalContextService } from './terminal-context.service';

/**
 * The safety layer between terminals and AI features (#56). #57, #58, #59 and #64 import this
 * module and call `TerminalContextService.forAi`; they never read a pane themselves.
 * #59 adds the `ai.session.summarize` job and its three routes (server-only, no node ever runs it).
 */
@Module({
  imports: [PrismaModule, TerminalModule, AiModule],
  controllers: [TerminalAiConsentController, TerminalAssistController, SessionSummaryController],
  providers: [TerminalContextService, TerminalAssistService, SessionSummaryService, SessionSummarizeHandler],
  exports: [TerminalContextService],
})
export class TerminalAiModule {}
