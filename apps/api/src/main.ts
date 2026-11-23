// IMPORTANT: Load instrumentation before anything else
import './instrumentation';
// Then the registry manifest: DTOs are composed from it at import time
import './shellkeep.manifest';

import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from '@nestjs/common';
import fastifyCookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import { WsAdapter } from '@nestjs/platform-ws';
import { verifyEncryptionKeyAtStartup } from '@marinoscar/platform-api/core';
import { AppModule } from './app.module';
import { PrismaService } from './prisma/prisma.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  // Safety check: prevent test auth module in production
  if (process.env.NODE_ENV === 'production' && process.env.TEST_AUTH_ENABLED === 'true') {
    throw new Error('TEST_AUTH_ENABLED must not be true in production');
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // Platform secrets key check (#48). Runs before the plugins and before `listen`, so
  // a deployment that cannot read its own stored credentials never binds the port: the
  // failure belongs in the deploy log, not in a 500 handed to the first user who opens
  // a server profile. It asks the database whether any credential is stored (the
  // deployment's, a user's or an organization's), so a fresh deployment without the
  // key still boots. The key itself is read by the platform cipher, not by this app.
  const prisma = app.get(PrismaService);
  await verifyEncryptionKeyAtStartup(
    async () =>
      (await prisma.credential.count()) +
      (await prisma.userCredential.count()) +
      (await prisma.orgCredential.count()),
    logger,
  );

  // Register cookie plugin
  await app.register(fastifyCookie, {
    secret: process.env.COOKIE_SECRET || process.env.JWT_SECRET,
  });

  // Register multipart plugin for file uploads
  await app.register(multipart, {
    limits: {
      fileSize: 100 * 1024 * 1024, // 100MB for simple upload
      files: 1,
    },
  });

  // Global prefix for all routes
  app.setGlobalPrefix('api');

  // Enable CORS (same-origin by default, configurable)
  app.enableCors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true,
  });

  // Swagger/OpenAPI setup
  const config = new DocumentBuilder()
    .setTitle('ShellKeep API')
    .setDescription('API documentation for ShellKeep')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token',
      },
      'JWT-auth',
    )
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/openapi.json',
  });

  // WebSocket adapter for terminal gateway
  app.useWebSocketAdapter(new WsAdapter(app));

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  logger.log(`Application running on port ${port}`);
  logger.log(`Swagger UI available at /api/docs`);
}

bootstrap();
