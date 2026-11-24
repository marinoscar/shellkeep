/** The environment view {@link buildDatabaseUrl} reads (`POSTGRES_*`). */
export type DatabaseEnv = NodeJS.ProcessEnv;

/**
 * Builds the PostgreSQL connection URL from the individual POSTGRES_*
 * variables, with the same rules as scripts/prisma-env.js (which is CommonJS,
 * runs before compilation, and so keeps its own copy). The password is
 * URL-encoded so characters such as `@`, `/` or `+` cannot corrupt the URL.
 */
export function buildDatabaseUrl(env: DatabaseEnv = process.env): string {
  const host = env.POSTGRES_HOST || 'localhost';
  const port = env.POSTGRES_PORT || '5432';
  const user = env.POSTGRES_USER || 'postgres';
  const password = env.POSTGRES_PASSWORD || 'postgres';
  const dbName = env.POSTGRES_DB || 'appdb';
  const sslParam = env.POSTGRES_SSL === 'true' ? '?sslmode=require' : '';

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${dbName}${sslParam}`;
}
