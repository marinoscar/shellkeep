import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AuthService,
  PatService,
  requireJwtSecret,
  toPrincipal,
  type JwtPayload,
} from '@marinoscar/platform-api/identity';

/** Who a WebSocket client is, as the platform's identity slice resolves it. */
export interface TerminalPrincipal {
  readonly userId: string;
  /** The organization the access token acts in (its `org` claim, validated against the memberships). */
  readonly orgId: string;
  /** Effective permissions in that organization (system roles plus the membership role). */
  readonly permissions: readonly string[];
  /** The principal's role names: the system roles it holds plus its role in the organization. */
  readonly roles: readonly string[];
  /** When the access token expires, in epoch milliseconds (its `exp` claim). */
  readonly expiresAtMs: number;
}

export type TerminalPrincipalResult =
  | { readonly ok: true; readonly principal: TerminalPrincipal }
  | { readonly ok: false; readonly reason: 'invalid_token' | 'expired' | 'invalid_user' };

/**
 * Resolves an access token presented on the terminal WebSocket to a principal.
 *
 * PLATFORM-ADOPTION-SHIM(#47): the identity slice resolves a bearer token to a
 * principal only inside its HTTP guard (`JwtAuthGuard`). A WebSocket frame has no
 * `Authorization` header, so this class repeats the guard's steps with what the
 * package exports: verify the signature and expiry with the slice's own secret
 * (`requireJwtSecret`), then `AuthService.validateJwtPayload` (the slice's
 * principal cache, device-session and active-organization checks, so a revoked
 * device or a removed member is refused here exactly as on HTTP) and
 * `toPrincipal` (the guard's own principal mapper: active organization and
 * effective permissions). The seam request "verify an access token for a non-HTTP
 * transport and return the principal" is pending (EAB); see
 * docs/platform-adoption/local-exceptions.md. When the platform ships it, this
 * class becomes a one-line delegation and the shim is removed.
 *
 * Two kinds of token are accepted: a session or device JWT, and a personal access
 * token (`pat_`, what `shellkeep login` stores for the CLI's `sessions attach`).
 * A PAT is verified by the identity slice's own `PatService.resolveToken` (hash
 * lookup, revoked, expired, inactive user, organization binding), then mapped to
 * the principal the HTTP guard would build. A PAT carries no JWT `exp`, so the
 * socket it authenticates expires after `PAT_SOCKET_TTL_MS`; the client re-sends
 * `auth` before then (the gateway's re-auth path), which re-validates the token,
 * so a revoked PAT ends the terminal within that window. A worker-node token
 * (`nod_`) and an OAuth token are neither and fail verification. The token is
 * never logged.
 */
/**
 * How long a socket authenticated with a personal access token stays authorized
 * without a fresh `auth` message: the access JWT's lifetime, so a PAT is
 * re-validated as often as a session token is refreshed.
 */
export const PAT_SOCKET_TTL_MS = 15 * 60 * 1000;

/** The prefix of a personal access token. */
const PAT_PREFIX = 'pat_';

@Injectable()
export class TerminalPrincipalResolver {
  private readonly secret: string;

  constructor(
    config: ConfigService,
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
    private readonly pat: PatService,
  ) {
    this.secret = requireJwtSecret(config);
  }

  async resolve(token: unknown): Promise<TerminalPrincipalResult> {
    if (typeof token !== 'string' || token.length === 0) {
      return { ok: false, reason: 'invalid_token' };
    }

    if (token.startsWith(PAT_PREFIX)) return this.resolvePat(token);

    let payload: JwtPayload & { exp?: number };
    try {
      payload = await this.jwt.verifyAsync<JwtPayload & { exp?: number }>(token, {
        secret: this.secret,
        algorithms: ['HS256'],
      });
    } catch (error) {
      // An expired but otherwise valid token is told apart from a malformed or forged one (a
      // bounded metric reason); the client sees the same refusal either way.
      return { ok: false, reason: (error as { name?: unknown } | null)?.name === 'TokenExpiredError' ? 'expired' : 'invalid_token' };
    }
    if (typeof payload.exp !== 'number') {
      // A token with no expiry would keep a terminal open forever.
      return { ok: false, reason: 'invalid_token' };
    }

    const user = await this.auth.validateJwtPayload(payload);
    if (!user || !user.isActive) {
      return { ok: false, reason: 'invalid_user' };
    }

    // The guard's own step: the request principal, with the active organization
    // (the token's `org` claim, or the default organization for a legacy token in
    // single-organization mode) and the effective permissions in it.
    const principal = toPrincipal(user, user.tokenKind ?? 'session');
    if (principal.kind !== 'user' || !principal.activeOrgId) {
      return { ok: false, reason: 'invalid_user' };
    }

    return {
      ok: true,
      principal: {
        userId: principal.userId,
        orgId: principal.activeOrgId,
        permissions: principal.permissions,
        roles: principal.roles,
        expiresAtMs: payload.exp * 1000,
      },
    };
  }

  /** A personal access token, through the identity slice's verifier. */
  private async resolvePat(token: string): Promise<TerminalPrincipalResult> {
    const resolved = await this.pat.resolveToken(token);
    if (!resolved) return { ok: false, reason: 'invalid_token' };

    const { user } = resolved;
    if (!user.isActive) return { ok: false, reason: 'invalid_user' };

    const principal = toPrincipal(user, user.tokenKind ?? 'pat');
    if (principal.kind !== 'user' || !principal.activeOrgId) {
      return { ok: false, reason: 'invalid_user' };
    }

    return {
      ok: true,
      principal: {
        userId: principal.userId,
        orgId: principal.activeOrgId,
        permissions: principal.permissions,
        roles: principal.roles,
        expiresAtMs: Date.now() + PAT_SOCKET_TTL_MS,
      },
    };
  }
}
