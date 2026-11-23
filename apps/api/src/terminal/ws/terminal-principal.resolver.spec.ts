import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { TerminalPrincipalResolver } from './terminal-principal.resolver';
import { createMockUserWithRelations } from '../../../test/fixtures/test-data.factory';

const SECRET = 'a-test-secret-with-at-least-32-characters!!';

describe('TerminalPrincipalResolver', () => {
  const jwt = new JwtService({ secret: SECRET });
  const config = { get: (key: string) => (key === 'jwt.secret' ? SECRET : undefined) } as unknown as ConfigService;
  let auth: { validateJwtPayload: jest.Mock };
  let resolver: TerminalPrincipalResolver;

  const sign = (claims: object = {}, options: object = { expiresIn: 60 }) =>
    jwt.sign({ sub: 'user-1', email: 'user@example.test', roles: [], ...claims }, options);

  beforeEach(() => {
    auth = {
      validateJwtPayload: jest
        .fn()
        .mockResolvedValue(createMockUserWithRelations({ id: 'user-1', roleName: 'contributor' })),
    };
    resolver = new TerminalPrincipalResolver(config, jwt, auth as never);
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

    expect(await resolver.resolve(expired)).toEqual({ ok: false, reason: 'invalid_token' });
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

  it('refuses a personal access token (not a JWT)', async () => {
    expect(await resolver.resolve('pat_0123456789abcdef')).toEqual({ ok: false, reason: 'invalid_token' });
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
