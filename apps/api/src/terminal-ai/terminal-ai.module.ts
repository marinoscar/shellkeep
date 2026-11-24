import { Module } from '@nestjs/common';

import { AiModule } from '../platform/ai/ai.config';
import { PrismaModule } from '../prisma/prisma.module';
import { TerminalModule } from '../terminal/terminal.module';
import { TerminalAiConsentController } from './terminal-ai-consent.controller';
import { TerminalAssistController } from './terminal-assist.controller';
import { TerminalAssistService } from './terminal-assist.service';
import { TerminalExplainController } from './terminal-explain.controller';
import { TerminalExplainService } from './terminal-explain.service';
import { TerminalContextService } from './terminal-context.service';

/**
 * The safety layer between terminals and AI features (#56). #57, #58, #59 and #64 import this
 * module and call `TerminalContextService.forAi`; they never read a pane themselves.
 */
@Module({
  imports: [PrismaModule, TerminalModule, AiModule],
  controllers: [TerminalAiConsentController, TerminalAssistController, TerminalExplainController],
  providers: [TerminalContextService, TerminalAssistService, TerminalExplainService],
  exports: [TerminalContextService],
})
export class TerminalAiModule {}
