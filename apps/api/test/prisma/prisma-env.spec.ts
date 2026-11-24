import { buildDatabaseUrl as buildInApp } from '../../src/common/database-url';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { constructDatabaseUrl, buildDatabaseUrl } = require('../../scripts/prisma-env.js') as {
  constructDatabaseUrl: (env?: NodeJS.ProcessEnv) => string;
  buildDatabaseUrl: (env?: NodeJS.ProcessEnv) => string;
};

describe('scripts/prisma-env.js constructDatabaseUrl', () => {
  it('returns an explicit DATABASE_URL unchanged', () => {
    const env = { DATABASE_URL: 'postgresql://u:p@explicit:5432/x', POSTGRES_HOST: 'other' };
    expect(constructDatabaseUrl(env)).toBe('postgresql://u:p@explicit:5432/x');
  });

  it('builds the URL from POSTGRES_* when DATABASE_URL is unset', () => {
    const env = {
      POSTGRES_HOST: 'db.example.test',
      POSTGRES_PORT: '6543',
      POSTGRES_USER: 'app',
      POSTGRES_PASSWORD: 'secret',
      POSTGRES_DB: 'shells',
    };
    expect(constructDatabaseUrl(env)).toBe('postgresql://app:secret@db.example.test:6543/shells');
  });

  it('URL-encodes the user and password', () => {
    const url = constructDatabaseUrl({
      POSTGRES_HOST: 'h',
      POSTGRES_USER: 'a@b',
      POSTGRES_PASSWORD: 'p@ss/w+rd',
    });
    expect(url).toBe('postgresql://a%40b:p%40ss%2Fw%2Brd@h:5432/appdb');
  });

  it('appends sslmode=require when POSTGRES_SSL is true', () => {
    expect(constructDatabaseUrl({ POSTGRES_HOST: 'h', POSTGRES_SSL: 'true' })).toMatch(/\?sslmode=require$/);
    expect(constructDatabaseUrl({ POSTGRES_HOST: 'h', POSTGRES_SSL: 'false' })).not.toMatch(/sslmode/);
  });

  it('buildDatabaseUrl ignores DATABASE_URL (wrapper behaviour)', () => {
    expect(buildDatabaseUrl({ DATABASE_URL: 'postgresql://x', POSTGRES_HOST: 'h' })).toContain('@h:5432');
  });

  it('matches the runtime builder in src/common/database-url.ts', () => {
    const env = { POSTGRES_HOST: 'h', POSTGRES_PASSWORD: 'a b&c', POSTGRES_SSL: 'true' };
    expect(buildDatabaseUrl(env)).toBe(buildInApp(env));
  });
});
