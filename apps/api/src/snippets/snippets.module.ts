import { Module } from '@nestjs/common';
import { AuthModule } from '@marinoscar/platform-api/identity';

import { PrismaModule } from '../prisma/prisma.module';
import { SnippetsController } from './snippets.controller';
import { SnippetsRateLimiter } from './snippets-rate-limiter';
import { SnippetsService } from './snippets.service';

/** The key panel's Snippets tab (#172): the caller's saved terminal text. Owner-only, never logged, never sent to a model. */
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [SnippetsController],
  providers: [SnippetsService, SnippetsRateLimiter],
})
export class SnippetsModule {}
