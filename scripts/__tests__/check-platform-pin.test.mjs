// Proves scripts/check-platform-pin.mjs accepts one exact pin and rejects a
// caret, a mismatch, a stale lockfile and a missing override.
// Run: node --test scripts/__tests__/
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkPin } from '../check-platform-pin.mjs';

const CONTRACT = '@marinoscar/platform-contract';
const V = '0.1.0-next.39';

/** An in-memory repo: root, api and web manifests plus the lockfile. */
function repo({ apiSpec = V, webSpec = V, lockVersion = V, override = `$${CONTRACT}` } = {}) {
  return {
    manifests: [
      {
        path: 'package.json',
        json: {
          devDependencies: { [CONTRACT]: V },
          overrides: override === null ? {} : { [CONTRACT]: override },
        },
      },
      {
        path: 'apps/api/package.json',
        json: { dependencies: { '@marinoscar/platform-api': apiSpec, [CONTRACT]: V } },
      },
      {
        path: 'apps/web/package.json',
        json: { dependencies: { '@marinoscar/platform-web': webSpec, [CONTRACT]: V } },
      },
    ],
    lock: { packages: { '': {}, [`node_modules/${CONTRACT}`]: { version: lockVersion } } },
  };
}

describe('check-platform-pin', () => {
  it('passes when every platform entry pins the same exact version', () => {
    const result = checkPin(repo());
    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
    assert.equal(result.pin, V);
  });

  it('fails when a platform entry uses a caret range', () => {
    const result = checkPin(repo({ apiSpec: `^${V}` }));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /no ranges, tags or carets/);
  });

  it('fails when two platform entries pin different versions', () => {
    const result = checkPin(repo({ webSpec: '0.1.0-next.38' }));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /pin different versions/);
  });

  it('fails when the lockfile resolves another version', () => {
    const result = checkPin(repo({ lockVersion: '0.1.0-next.38' }));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /package-lock\.json/);
  });

  it('fails when the contract override is missing', () => {
    const result = checkPin(repo({ override: null }));
    assert.equal(result.ok, false);
    assert.match(result.errors.join('\n'), /overrides has no/);
  });
});
