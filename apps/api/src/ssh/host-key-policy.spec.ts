import { HOST_KEY_POLICIES, decideHostKey, type SshPurpose } from './host-key-policy';

const TRUSTED = 'SHA256:' + 'T'.repeat(43);
const OTHER = 'SHA256:' + 'O'.repeat(43);
const PURPOSES: SshPurpose[] = ['interactive', 'test', 'exec'];

describe('decideHostKey: the policy table', () => {
  describe.each(PURPOSES)('purpose %s', (purpose) => {
    it.each(HOST_KEY_POLICIES)('equal fingerprint is accepted under %s', (policy) => {
      expect(decideHostKey({ trusted: TRUSTED, presented: TRUSTED, policy, purpose })).toEqual({
        action: 'accept',
        outcome: 'match',
      });
    });

    it.each(HOST_KEY_POLICIES)('a different fingerprint is ALWAYS refused as a mismatch under %s', (policy) => {
      expect(decideHostKey({ trusted: TRUSTED, presented: OTHER, policy, purpose })).toEqual({
        action: 'refuse',
        outcome: 'mismatch',
        code: 'HOST_KEY_MISMATCH',
      });
    });

    it('no trusted key + tofu_prompt is refused as unknown', () => {
      expect(decideHostKey({ trusted: null, presented: OTHER, policy: 'tofu_prompt', purpose })).toEqual({
        action: 'refuse',
        outcome: 'unknown',
        code: 'HOST_KEY_UNKNOWN',
      });
    });

    it('no trusted key + strict is refused as unknown', () => {
      expect(decideHostKey({ trusted: null, presented: OTHER, policy: 'strict', purpose })).toMatchObject({
        action: 'refuse',
        code: 'HOST_KEY_UNKNOWN',
      });
    });

    it('no trusted key + tofu_auto stores the presented key and accepts (audited by the factory)', () => {
      expect(decideHostKey({ trusted: null, presented: OTHER, policy: 'tofu_auto', purpose })).toEqual({
        action: 'trust',
        outcome: 'auto_trusted',
      });
    });
  });

  it('treats an undefined or empty trusted fingerprint as untrusted', () => {
    expect(decideHostKey({ trusted: undefined, presented: OTHER, policy: 'tofu_prompt', purpose: 'test' })).toMatchObject({
      code: 'HOST_KEY_UNKNOWN',
    });
    expect(decideHostKey({ trusted: '', presented: OTHER, policy: 'tofu_auto', purpose: 'exec' })).toMatchObject({
      action: 'trust',
    });
  });

  it.each(HOST_KEY_POLICIES)('a scan only captures, whatever the key or policy (%s)', (policy) => {
    for (const trusted of [null, TRUSTED]) {
      expect(decideHostKey({ trusted, presented: OTHER, policy, purpose: 'scan' })).toEqual({ action: 'capture' });
    }
  });
});
