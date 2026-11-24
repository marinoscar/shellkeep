import { identityConfiguration } from '@marinoscar/platform-api/identity';
import { jobsConfiguration } from '@marinoscar/platform-api/jobs';
import { resolveServiceName } from '../common/otel/telemetry-identity';

export default () => {
  // Construct DATABASE_URL from individual PostgreSQL variables
  const host = process.env.POSTGRES_HOST || 'localhost';
  const port = process.env.POSTGRES_PORT || '5432';
  const user = process.env.POSTGRES_USER || 'postgres';
  const password = process.env.POSTGRES_PASSWORD || 'postgres';
  const dbName = process.env.POSTGRES_DB || 'appdb';
  const ssl = process.env.POSTGRES_SSL === 'true';
  const sslParam = ssl ? '?sslmode=require' : '';

  const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${dbName}${sslParam}`;

  // Set DATABASE_URL for Prisma
  process.env.DATABASE_URL = databaseUrl;

  return {
    // Application
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    appUrl: process.env.APP_URL || 'http://localhost:3535',

    // Database
    database: {
      host,
      port: parseInt(port, 10),
      user,
      password,
      name: dbName,
      ssl,
      url: databaseUrl,
    },

  // Identity (issue #47): `jwt`, `auth`, `google`, `initialAdminEmail`,
  // `deviceAuth` and `tenancy`, built by the slice from the same environment
  // variables as before (JWT_SECRET, JWT_ACCESS_TTL_MINUTES,
  // JWT_REFRESH_TTL_DAYS, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
  // GOOGLE_CALLBACK_URL, INITIAL_ADMIN_EMAIL, DEVICE_CODE_EXPIRY_MINUTES,
  // DEVICE_CODE_POLL_INTERVAL). TENANCY_MODE is unset: single organization.
  ...identityConfiguration(),

  // The jobs and nodes slices (#49): `jobs.*` and `nodes.*`, built from JOBS_* and NODE_*_ENABLED.
  ...jobsConfiguration(process.env),

  // Observability
  otel: {
    enabled: process.env.OTEL_ENABLED === 'true',
    endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    serviceName: resolveServiceName(),
  },

  // Storage: the deployment's upload bounds. WHERE bytes go (provider, bucket, region,
  // endpoint, keys) is runtime configuration at `/admin/settings/storage` since #50, so
  // the old provider, S3 and AWS variables are gone; adding any of them back would restore a
  // second source of truth. The part size is the slice's default
  // (10 MiB, `StorageModule.forRoot({ partSizeBytes })`).
  storage: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10737418240', 10), // 10GB default
    // Exact types and `type/*` wildcards, matched case-insensitively by the slice; an empty variable keeps the default.
    allowedMimeTypes: (process.env.ALLOWED_MIME_TYPES || 'image/*,application/pdf,video/*')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
    signedUrlExpiry: parseInt(process.env.SIGNED_URL_EXPIRY || '3600', 10), // 1 hour default
  },

  logLevel: process.env.LOG_LEVEL || 'info',
  };
};
