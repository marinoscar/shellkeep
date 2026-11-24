import { DOWNLOAD_TOKEN_TTL_MS, DownloadTokenStore, MAX_PENDING_TOKENS_PER_USER } from './download-token.store';

const grant = { userId: 'u1', orgId: 'o1', serverProfileId: 'p1', path: '/var/log/a.log', size: 42 };

describe('DownloadTokenStore', () => {
  let store: DownloadTokenStore;
  let clock: number;
  beforeEach(() => {
    clock = 1_000_000;
    store = new DownloadTokenStore();
    store.now = () => clock;
  });

  it('issues an opaque token that expires in 60 seconds', () => {
    const { token, expiresAt } = store.issue(grant);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime()).toBe(clock + DOWNLOAD_TOKEN_TTL_MS);
    expect(DOWNLOAD_TOKEN_TTL_MS).toBe(60_000);
  });

  it('returns the bound grant once, then nothing', () => {
    const { token } = store.issue(grant);
    expect(store.consume(token)).toEqual(grant);
    expect(store.consume(token)).toBeNull();
  });

  it('refuses an expired token and forgets it', () => {
    const { token } = store.issue(grant);
    clock += DOWNLOAD_TOKEN_TTL_MS;
    expect(store.consume(token)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('refuses unknown, malformed and oversized tokens', () => {
    store.issue(grant);
    expect(store.consume('nope')).toBeNull();
    expect(store.consume('')).toBeNull();
    expect(store.consume('x'.repeat(500))).toBeNull();
    expect(store.consume(undefined as never)).toBeNull();
  });

  it('keeps no plain token in memory', () => {
    const { token } = store.issue(grant);
    expect([...(store as unknown as { grants: Map<string, unknown> }).grants.keys()]).not.toContain(token);
  });

  it('sweeps expired tokens when it issues, and bounds the pending tokens per user', () => {
    store.issue(grant);
    clock += DOWNLOAD_TOKEN_TTL_MS + 1;
    store.issue(grant);
    expect(store.size).toBe(1);

    const first = store.issue(grant).token;
    for (let i = 0; i < MAX_PENDING_TOKENS_PER_USER; i++) store.issue(grant);
    expect(store.consume(first)).toBeNull();
    expect(store.size).toBe(MAX_PENDING_TOKENS_PER_USER);
    expect(store.issue({ ...grant, userId: 'u2' }).token).toBeTruthy();
  });
});
