import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PAT_SOCKET_TTL_MS, TerminalPrincipalResolver } from './terminal-principal.resolver';
import { createMockUserWithRelations } from '../../../test/fixtures/test-data.factory';

const SECRET = 'a-test-secret-with-at-least-32-characters!!';

describe('TerminalPrincipalResolver', () => {
  const jwt = new JwtService({ secret: SECRET });
  const config = { get: (key: string) => (key === 'jwt.secret' ? SECRET : undefined) } as unknown as ConfigService;
  let auth: { validateJwtPayload: jest.Mock };
  let pat: { resolveToken: jest.Mock };
  let resolver: TerminalPrincipalResolver;

  const sign = (claims: object = {}, options: object = { expiresIn: 60 }) =>
    jwt.sign({ sub: 'user-1', email: 'user@example.test', roles: [], ...claims }, options);

  beforeEach(() => {
    auth = {
      validateJwtPayload: jest
        .fn()
        .mockResolvedValue(createMockUserWithRelations({ id: 'user-1', roleName: 'contributor' })),
    };
    pat = {
      resolveToken: jest
        .fn()
        .mockResolvedValue({
          user: { ...createMockUserWithRelations({ id: 'user-1', roleName: 'contributor' }), tokenKind: 'pat' },
          tokenId: 'pat-1',
        }),
    };
    resolver = new TerminalPrincipalResolver(config, jwt, auth as never, pat as never);
  });

  it('resolves a Contributor token to the user, the organization, the permissions and the expiry', async () => {
    const token = sign();
    const exp = (jwt.decode(token) as { exp: number }).exp;

    const result = await resolver.resolve(token);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.userId).toBe('user-1');
    expect(result.principal.orgId).toBe('org-default');
    expect(result.principal.permissions).toEqual(expect.arrayContaining(['sessions:read', 'sessions:write']));
    expect(result.principal.expiresAtMs).toBe(exp * 1000);
  });

  it("gives a Viewer the read permissions and not sessions:write", async () => {
    auth.validateJwtPayload.mockResolvedValue(createMockUserWithRelations({ id: 'user-1', roleName: 'viewer' }));

    const result = await resolver.resolve(sign());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.principal.permissions).toContain('sessions:read');
    expect(result.principal.permissions).not.toContain('sessions:write');
  });

  it.each([undefined, null, '', 42, {}])('refuses a non-string token (%p)', async (token) => {
    expect(await resolver.resolve(token)).toEqual({ ok: false, reason: 'invalid_token' });
    expect(auth.validateJwtPayload).not.toHaveBeenCalled();
  });

  it('refuses a token signed with another secret', async () => {
    const forged = new JwtService({ secret: 'another-secret-with-at-least-32-characters!' }).sign(
      { sub: 'user-1' },
      { expiresIn: 60 },
    );

    expect(await resolver.resolve(forged)).toEqual({ ok: false, reason: 'invalid_token' });
    expect(auth.validateJwtPayload).not.toHaveBeenCalled();
  });

  it('refuses an expired token', async () => {
    const expired = sign({}, { expiresIn: -10 });

    expect(await resolver.resolve(expired)).toEqual({ ok: false, reason: 'expired' });
  });

  it('refuses a token with no expiry (it would keep a terminal open forever)', async () => {
    const forever = sign({}, {});

    expect(await resolver.resolve(forever)).toEqual({ ok: false, reason: 'invalid_token' });
    expect(auth.validateJwtPayload).not.toHaveBeenCalled();
  });

  it('refuses a token whose algorithm is not HS256', async () => {
    const unsigned = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(
      JSON.stringify({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString('base64url')}.`;

    expect(await resolver.resolve(unsigned)).toEqual({ ok: false, reason: 'invalid_token' });
  });

  describe('a personal access token (the shellkeep CLI, #72)', () => {
    const PAT = 'pat_0123456789abcdef0123456789abcdef';

    it('is verified by the identity slice and never treated as a JWT', async () => {
      const verify = jest.spyOn(jwt, 'verifyAsync');

      await resolver.resolve(PAT);

      expect(pat.resolveToken).toHaveBeenCalledWith(PAT);
      expect(verify).not.toHaveBeenCalled();
      expect(auth.validateJwtPayload).not.toHaveBeenCalled();
      verify.mockRestore();
    });

    it('resolves to the same principal a JWT of that user gets, expiring after the socket window', async () => {
      const before = Date.now();

      const result = await resolver.resolve(PAT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.principal.userId).toBe('user-1');
      expect(result.principal.orgId).toBe('org-default');
      expect(result.principal.permissions).toEqual(expect.arrayContaining(['sessions:read', 'sessions:write']));
      expect(result.principal.expiresAtMs).toBeGreaterThanOrEqual(before + PAT_SOCKET_TTL_MS);
      expect(result.principal.expiresAtMs).toBeLessThanOrEqual(Date.now() + PAT_SOCKET_TTL_MS);
    });

    it('keeps the role limits: a Viewer PAT has no sessions:write', async () => {
      pat.resolveToken.mockResolvedValue({
        user: { ...createMockUserWithRelations({ id: 'user-1', roleName: 'viewer' }), tokenKind: 'pat' },
        tokenId: 'pat-1',
      });

      const result = await resolver.resolve(PAT);

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.principal.permissions).not.toContain('sessions:write');
    });

    it('refuses a PAT the slice does not resolve (unknown, revoked, expired, user inactive, org binding)', async () => {
      pat.resolveToken.mockResolvedValue(null);

      expect(await resolver.resolve(PAT)).toEqual({ ok: false, reason: 'invalid_token' });
    });

    it('refuses an inactive user and a user with no organization', async () => {
      pat.resolveToken.mockResolvedValue({
        user: { ...createMockUserWithRelations({ id: 'user-1', roleName: 'contributor', isActive: false }), tokenKind: 'pat' },
        tokenId: 'pat-1',
      });
      expect(await resolver.resolve(PAT)).toEqual({ ok: false, reason: 'invalid_user' });

      pat.resolveToken.mockResolvedValue({
        user: { ...createMockUserWithRelations({ id: 'user-1', roleName: 'contributor' }), memberships: [], tokenKind: 'pat' },
        tokenId: 'pat-1',
      });
      expect(await resolver.resolve(PAT)).toEqual({ ok: false, reason: 'invalid_user' });
    });

    it('still refuses a worker-node token and an OAuth token (neither is a JWT or a PAT)', async () => {
      expect(await resolver.resolve('nod_0123456789abcdef')).toEqual({ ok: false, reason: 'invalid_token' });
      expect(await resolver.resolve('oat_0123456789abcdef')).toEqual({ ok: false, reason: 'invalid_token' });
      expect(pat.resolveToken).not.toHaveBeenCalled();
    });
  });

  it('refuses a user the identity slice no longer resolves (revoked device session, removed member)', async () => {
    auth.validateJwtPayload.mockResolvedValue(null);

    expect(await resolver.resolve(sign())).toEqual({ ok: false, reason: 'invalid_user' });
  });

  it('refuses an inactive user', async () => {
    auth.validateJwtPayload.mockResolvedValue(
      createMockUserWithRelations({ id: 'user-1', roleName: 'contributor', isActive: false }),
    );

    expect(await resolver.resolve(sign())).toEqual({ ok: false, reason: 'invalid_user' });
  });

  it('refuses a user with no organization', async () => {
    const user = createMockUserWithRelations({ id: 'user-1', roleName: 'contributor' });
    auth.validateJwtPayload.mockResolvedValue({ ...user, memberships: [] });

    expect(await resolver.resolve(sign())).toEqual({ ok: false, reason: 'invalid_user' });
  });
});
