import { SnippetsRateLimiter } from './snippets-rate-limiter';

describe('SnippetsRateLimiter', () => {
  it('allows up to the limit per user and bucket, then 429s, then recovers', () => {
    const limiter = new SnippetsRateLimiter();
    let now = 1_000_000;
    limiter.now = () => now;
    for (let i = 0; i < 3; i += 1) limiter.hit('u1', 'write', 3);
    expect(() => limiter.hit('u1', 'write', 3)).toThrow(expect.objectContaining({ status: 429 }));
    limiter.hit('u2', 'write', 3);
    limiter.hit('u1', 'read', 3);
    now += 60_001;
    expect(() => limiter.hit('u1', 'write', 3)).not.toThrow();
  });
});
