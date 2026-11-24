import { checkRunParams } from './run-params';

const definition = {
  parameters: [
    { name: 'NAME', type: 'string' as const, required: true, pattern: '^[a-z]+$' },
    { name: 'COUNT', type: 'number' as const, required: false, default: 3 },
    { name: 'FLAG', type: 'boolean' as const, required: false },
    { name: 'MODE', type: 'enum' as const, required: false, options: ['fast', 'safe'], default: 'safe' },
    { name: 'TOKEN', type: 'secret' as const, required: true },
  ],
};

describe('checkRunParams', () => {
  it('accepts valid values, applies defaults and keeps the secret as a reference', () => {
    const result = checkRunParams(definition, { NAME: 'web' }, { TOKEN: 'deploy-token' });
    expect(result.issues).toEqual([]);
    expect(result.values).toEqual({ NAME: 'web', COUNT: 3, MODE: 'safe' });
    expect(result.secretRefs).toEqual({ TOKEN: 'deploy-token' });
  });

  it('reports required, type, enum and pattern problems with their paths', () => {
    const result = checkRunParams(definition, { NAME: 'BAD1', COUNT: 'x' as unknown as number, MODE: 'wild' }, {});
    expect(result.issues.map((i) => i.path).sort()).toEqual(['params.COUNT', 'params.MODE', 'params.NAME', 'secretRefs.TOKEN']);
  });

  it('refuses unknown names and a value for a secret parameter', () => {
    const result = checkRunParams(definition, { NAME: 'a', TOKEN: 'raw', EXTRA: 1 }, { TOKEN: 't', NAME: 'x' });
    expect(result.issues.map((i) => i.path).sort()).toEqual(['params.EXTRA', 'params.TOKEN', 'secretRefs.NAME']);
  });
});
