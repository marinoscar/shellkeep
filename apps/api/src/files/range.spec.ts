import { computeRange } from './range';

const limits = { fullViewMaxBytes: 1000, pagedViewMaxBytes: 10_000 };

describe('computeRange', () => {
  it('reads a small file whole', () => {
    expect(computeRange(300, {}, limits)).toEqual({ offset: 0, length: 300 });
  });

  it('caps the window at the full-view limit', () => {
    expect(computeRange(5000, {}, limits)).toEqual({ offset: 0, length: 1000 });
    expect(computeRange(5000, { offset: 100, length: 4000 }, limits)).toEqual({ offset: 100, length: 1000 });
  });

  it('clamps to the end of the file and allows an empty read at the end', () => {
    expect(computeRange(5000, { offset: 4500, length: 800 }, limits)).toEqual({ offset: 4500, length: 500 });
    expect(computeRange(5000, { offset: 5000 }, limits)).toEqual({ offset: 5000, length: 0 });
    expect(computeRange(0, {}, limits)).toEqual({ offset: 0, length: 0 });
  });

  it('refuses an offset past the end and a bad length', () => {
    for (const requested of [{ offset: 5001 }, { offset: -1 }, { offset: 1.5 }, { length: 0 }, { length: -5 }]) {
      expect(() => computeRange(5000, requested, limits)).toThrow(expect.objectContaining({ status: 400 }));
    }
  });

  it('refuses a file above the paged cap with 413', () => {
    expect(() => computeRange(10_001, {}, limits)).toThrow(expect.objectContaining({ status: 413 }));
    expect(computeRange(10_000, { offset: 9500 }, limits)).toEqual({ offset: 9500, length: 500 });
  });

  it('never lets the paged cap fall under the full-view cap', () => {
    expect(computeRange(1500, {}, { fullViewMaxBytes: 2000, pagedViewMaxBytes: 1000 })).toEqual({ offset: 0, length: 1500 });
  });
});
