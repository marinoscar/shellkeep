// IMPORTANT: Load instrumentation before anything else
import './instrumentation';
// Then the registry manifest: DTOs are composed from it at import time
import './shellkeep.manifest';

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { registerFileUploadBodyParser } from './files/upload-body-parser';
import { WsAdapter } from '@nestjs/platform-ws';
import { verifyEncryptionKeyAtStartup } from '@marinoscar/platform-api/core';
import { registerRequestSpanAttributes } from '@marinoscar/platform-api/otel-core';
import {
  buildCorsOptions,
  isSameOriginOnly,
  registerPlatformDocs,
  verifyDeploymentModeAtStartup,
  verifyDeploymentNetworkAtStartup,
} from '@marinoscar/platform-api/host';
import {
  STORAGE_OPTIONS,
  registerStoragePartBodyParser,
  simpleUploadFileSizeLimit,
  type ResolvedStorageModuleOptions,
} from '@marinoscar/platform-api/storage';
import { APP_OPENAPI } from './openapi/document';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';
import { PrismaSystemService } from './prisma/prisma-system.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Safety check: prevent test auth module in production
  if (process.env.NODE_ENV === 'production' && process.env.TEST_AUTH_ENABLED === 'true') {
    throw new Error('TEST_AUTH_ENABLED must not be true in production');
  }

  // CORS policy, DEPLOYMENT_MODE and DEPLOYMENT_NETWORK (#46). Parsed HERE, before the
  // application or its database connection exists, so a wildcard or malformed
  // CORS_ORIGIN, or an invalid mode, fails the boot immediately with a message naming
  // the variable and its allowed values.
  const corsOptions = buildCorsOptions(process.env.CORS_ORIGIN);
  verifyDeploymentModeAtStartup(process.env, logger);
  verifyDeploymentNetworkAtStartup(process.env, logger);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // Route and caller attributes on the HTTP server span (`http.route`, `app.request.bearer`). A no-op
  // unless the SDK is installed (OTEL_ENABLED=true); the runtime gate decides what is exported.
  registerRequestSpanAttributes(app.getHttpAdapter().getInstance(), process.env.OTEL_ENABLED === 'true');

  // Platform secrets key check (#48). Runs before the plugins and before `listen`, so
  // a deployment that cannot read its own stored credentials never binds the port: the
  // failure belongs in the deploy log, not in a 500 handed to the first user who opens
  // a server profile. It asks the database whether any credential is stored (the
  // deployment's, a user's or an organization's), so a fresh deployment without the
  // key still boots. The key itself is read by the platform cipher, not by this app.
  //
  // `org_credentials` forces row-level security, so the count runs on the bypass client
  // (one read-only transaction, reason `admin-aggregate`): on the tenant client an
  // unscoped count is 0 under the application role (#52) and a deployment that holds
  // only organization credentials would boot without the key.
  const prisma = app.get(PrismaService);
  const system = app.get(PrismaSystemService);
  await verifyEncryptionKeyAtStartup(
    async () =>
      (await prisma.credential.count()) +
      (await prisma.userCredential.count()) +
      (await system.runAsSystem('admin-aggregate', (tx) => tx.orgCredential.count())),
    logger,
  );

  // Register cookie plugin
  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET,
  });

  // Register multipart plugin for the simple upload route (`POST /api/storage/objects`). The
  // ceiling is the slice's (`StorageModule.forRoot({ maxSimpleUploadBytes })`, 100 MiB by default)
  // capped at the deployment's `MAX_FILE_SIZE`, so the plugin refuses an oversized body before the
  // service sees it.
  const storageOptions = app.get<ResolvedStorageModuleOptions>(STORAGE_OPTIONS, { strict: false });
  const maxFileSize = app.get(ConfigService).get<number>('storage.maxFileSize');
  await app.register(multipart, {
    limits: {
      fileSize: simpleUploadFileSizeLimit(maxFileSize, storageOptions.maxSimpleUploadBytes),
      files: 1,
    },
  });

  // The API-proxied multipart part route (`PUT /api/storage/objects/:id/upload/parts/:n`, served
  // only for a storage driver with no presigned URLs) receives its body as the unread request
  // stream. A no-op for every other route. Before `listen()`.
  registerStoragePartBodyParser(app.getHttpAdapter().getInstance());
  // The raw octet-stream body of a file upload to a server (`POST /api/server-profiles/:id/files/upload`).
  registerFileUploadBodyParser(app.getHttpAdapter().getInstance());

  // Global prefix for all routes
  app.setGlobalPrefix('api');

  // CORS: same-origin only unless CORS_ORIGIN lists trusted origins. nginx (and the
  // Vite dev proxy) serve the web app and /api from one origin, so the default emits
  // no CORS headers at all.
  app.enableCors(corsOptions);
  logger.log(
    isSameOriginOnly(corsOptions)
      ? 'CORS: same-origin only (CORS_ORIGIN unset; no cross-origin access)'
      : `CORS: allowlist of ${corsOptions.origin.length} origin(s) with credentials: ${corsOptions.origin.join(', ')}`,
  );

  // OpenAPI: the document and the two routes that serve it (`/api/openapi.json` and
  // `/api/docs`), from the host slice. Registered AFTER `setGlobalPrefix('api')`
  // because the introspection reads the prefix off the application. A generation
  // failure degrades both routes to a 503 instead of stopping the boot.
  const docsReady = registerPlatformDocs(app, APP_OPENAPI, logger);

  // WebSocket adapter for terminal gateway
  app.useWebSocketAdapter(new WsAdapter(app));

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`Application running on port ${port}`);
  logger.log(
    docsReady
      ? 'API reference available at /api/docs'
      : 'API reference DEGRADED: /api/docs and /api/openapi.json return 503 (see error above)',
  );
}

bootstrap();
