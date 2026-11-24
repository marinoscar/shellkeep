// =============================================================================
// Host-key fingerprints against OpenSSH (issue #60)
// =============================================================================
//
// The fixtures are real public keys generated with `ssh-keygen` for this test (throwaway,
// no private half is kept), with the output of `ssh-keygen -lf` recorded next to them. The
// blob is the base64 field of the `.pub` line, which is the key blob ssh2 hands the verifier.
// =============================================================================

import {
  FINGERPRINT_PATTERN,
  UNKNOWN_HOST_KEY_ALGORITHM,
  algorithmOf,
  fingerprintOf,
  sameFingerprint,
} from '../../src/ssh/host-key';

const KEYS = [
  {
    name: 'ed25519',
    blob: 'AAAAC3NzaC1lZDI1NTE5AAAAIM676+3/GwHjN2sHiQBHrqdjG4LVIwBdO2biO5sViv8F',
    fingerprint: 'SHA256:CzjWx8nv1WXDDoBAgG6+1LdMUftZ0EWgtCpuqJGo7Gs',
    algorithm: 'ssh-ed25519',
  },
  {
    name: 'rsa',
    blob:
      'AAAAB3NzaC1yc2EAAAADAQABAAABAQC2pi6z6aYtRpdoS3TQOfhSBM5Da0eu48iX6qIhXNbRf9RVh/dKpM/HU0AHNhsOkMJeKetz8o+M0HhanVghUMRoR4mKxxRcjw0CB6UzEAGpTD+JgadUFn8da+1uuoGQgOyWBawepIiym+/ON0C4zDbFeSXaINsdQp0Qg/EsS+vG4TuKFIMB3WDUd3BVdTvTGh/alWjXii0N3I9KOJ9s6xV3tEIt4+WeACIT9QEgrTVHmygCv2moXwBPhliYg+I6wYag2nAhysEuPU/59DK0hC5s7ZZd+EnJPJLC6z9l2fdkFTXM0b1L0iFA3yIgMbbCztl5oTwwrQIpXl01G6jdnKqj',
    fingerprint: 'SHA256:YL2RlHUz82H4YThsbfK6SAn5E33ESpUsHTVW/2XxSAE',
    algorithm: 'ssh-rsa',
  },
  {
    name: 'ecdsa',
    blob:
      'AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBOTYej0BWu/SErYzuIUKQAFB/4N8eHlxnqw8h6O0qufNIOm8glSG0Ku9mWLYhg0hsSnQXn77HS1AOH9KQYs6evI=',
    fingerprint: 'SHA256:fZmrbCyA/Nc/zuWMa3TuRwWvbW3TB6a5W/SJQwADSBE',
    algorithm: 'ecdsa-sha2-nistp256',
  },
] as const;

describe('fingerprintOf', () => {
  it.each(KEYS)('equals `ssh-keygen -lf` for an $name key', ({ blob, fingerprint }) => {
    expect(fingerprintOf(Buffer.from(blob, 'base64'))).toBe(fingerprint);
  });

  it('has no base64 padding and matches the pattern a client may send', () => {
    for (const { blob } of KEYS) {
      const value = fingerprintOf(Buffer.from(blob, 'base64'));
      expect(value).not.toContain('=');
      expect(value).toMatch(FINGERPRINT_PATTERN);
    }
  });
});

describe('algorithmOf', () => {
  it.each(KEYS)('reads $algorithm from the leading SSH string of an $name key', ({ blob, algorithm }) => {
    expect(algorithmOf(Buffer.from(blob, 'base64'))).toBe(algorithm);
  });

  it('answers unknown for a blob that is empty, too short, or whose length runs past its end', () => {
    expect(algorithmOf(Buffer.alloc(0))).toBe(UNKNOWN_HOST_KEY_ALGORITHM);
    expect(algorithmOf(Buffer.from([0, 0, 0]))).toBe(UNKNOWN_HOST_KEY_ALGORITHM);
    expect(algorithmOf(Buffer.from([0, 0, 0, 20, 0x73, 0x73, 0x68]))).toBe(UNKNOWN_HOST_KEY_ALGORITHM);
    expect(algorithmOf(Buffer.from([0, 0, 0, 0]))).toBe(UNKNOWN_HOST_KEY_ALGORITHM);
  });

  it('answers unknown rather than echoing arbitrary bytes as an algorithm name', () => {
    const blob = Buffer.concat([Buffer.from([0, 0, 0, 4]), Buffer.from([0x00, 0x01, 0xff, 0x7f])]);
    expect(algorithmOf(blob)).toBe(UNKNOWN_HOST_KEY_ALGORITHM);
  });
});

describe('sameFingerprint', () => {
  it('compares ignoring padding and whitespace, and tells different keys apart', () => {
    expect(sameFingerprint(KEYS[0].fingerprint, `  ${KEYS[0].fingerprint}=\n`)).toBe(true);
    expect(sameFingerprint(KEYS[0].fingerprint, KEYS[1].fingerprint)).toBe(false);
    expect(sameFingerprint(KEYS[0].fingerprint, 'SHA256:short')).toBe(false);
  });
});
