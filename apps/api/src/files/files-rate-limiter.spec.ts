import { FilesRateLimiter } from './files-rate-limiter';

describe('FilesRateLimiter', () => {
  let limiter: FilesRateLimiter;
  let clock: number;
  beforeEach(() => {
    clock = 0;
    limiter = new FilesRateLimiter();
    limiter.now = () => clock;
  });

  it('allows up to the limit per minute, then answers 429', () => {
    limiter.hit('u1', 'content', 2);
    limiter.hit('u1', 'content', 2);
    expect(() => limiter.hit('u1', 'content', 2)).toThrow(expect.objectContaining({ status: 429 }));
  });

  it('slides: the window frees as hits age out', () => {
    limiter.hit('u1', 'content', 1);
    clock = 59_999;
    expect(() => limiter.hit('u1', 'content', 1)).toThrow();
    clock = 60_000;
    expect(() => limiter.hit('u1', 'content', 1)).not.toThrow();
  });

  it('keeps users and buckets apart', () => {
    limiter.hit('u1', 'content', 1);
    expect(() => limiter.hit('u2', 'content', 1)).not.toThrow();
    expect(() => limiter.hit('u1', 'download', 1)).not.toThrow();
  });

  it('caps concurrent streams and frees a slot once, however often release is called', () => {
    const a = limiter.acquireStream('u1', 2);
    limiter.acquireStream('u1', 2);
    expect(() => limiter.acquireStream('u1', 2)).toThrow(expect.objectContaining({ status: 429 }));
    a();
    a();
    expect(() => limiter.acquireStream('u1', 2)).not.toThrow();
    expect(() => limiter.acquireStream('u1', 2)).toThrow();
  });
});
