// Must stay the first import: registers the static registries that the DTOs
// below are composed from (see shellkeep.manifest.ts).
import './shellkeep.manifest';
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';

import { PrismaModule } from './prisma/prisma.module';
import { platformHostModule } from './platform/platform-host.module';
import { doctorModule } from './platform/doctor.config';
import { identityModule } from './platform/identity/identity.config';
import { HealthModule } from './health/health.module';
import { StorageModule } from './storage/storage.module';
import { ServerProfilesModule } from './server-profiles/server-profiles.module';
import { TerminalModule } from './terminal/terminal.module';
import { LoggerModule } from './common/logger/logger.module';

import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

import configuration from './config/configuration';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Scheduling (must be at root level for NestJS 11)
    ScheduleModule.forRoot(),

    // Event emitter for async events
    EventEmitterModule.forRoot(),

    // Database
    PrismaModule,

    // The platform's DI-time host ports (audit sink, `PLATFORM_PRISMA`), bound
    // to ShellKeep's services (#47). Global.
    platformHostModule,
    // The platform Doctor: the identity slice registers its health checks with
    // it, so it cannot boot without it (#47). One read-only admin route.
    doctorModule,

    // Logger
    LoggerModule,

    // Feature modules
    // The platform's identity slice (#47): `/api/auth/*`, `/api/users`,
    // `/api/roles`, `/api/allowlist`, `/api/pat`, `/api/auth/device/*` and,
    // outside production, `/api/auth/test/login`, in single-organization mode.
    // Replaces ShellKeep's own auth, users, allowlist, device-auth and
    // test-auth modules. Global: it provides `PatService` and the guards'
    // dependencies to every module.
    identityModule,
    HealthModule,
    StorageModule,
    ServerProfilesModule,
    TerminalModule,
  ],
  providers: [
    // Global validation pipe (Zod)
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
    // Global exception filter
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
    // Global logging interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // Global response transform interceptor
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(RequestIdMiddleware)
      .forRoutes('*');
  }
}
