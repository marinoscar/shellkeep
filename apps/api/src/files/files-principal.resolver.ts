import { Injectable } from '@nestjs/common';
import type { Principal } from '@marinoscar/platform-api/core';
import { AuthService, toPrincipal } from '@marinoscar/platform-api/identity';

/**
 * The CURRENT principal of a user in an organization, for the public download route, where no
 * bearer token is present. It asks the identity slice the way the HTTP guard does after
 * verifying a token (`AuthService.validateJwtPayload`, then `toPrincipal`): the user must still
 * be active, still a member of the organization, and the permissions are those held now.
 *
 * PLATFORM-ADOPTION-SHIM(#47): the slice has no "principal for a user id" entry point, so this
 * builds the minimal access-token payload the validation reads (`sub` and `org`; the email and
 * roles claims are informational). Same seam request as `TerminalPrincipalResolver`.
 */
@Injectable()
export class FilesPrincipalResolver {
  constructor(private readonly auth: AuthService) {}

  /** The principal, or `null` for an unknown, deactivated or removed user. */
  async resolve(userId: string, orgId: string): Promise<Principal | null> {
    const user = await this.auth.validateJwtPayload({ sub: userId, email: '', roles: [], org: orgId });
    if (!user || !user.isActive) return null;
    const principal = toPrincipal(user, user.tokenKind ?? 'session');
    if (principal.kind !== 'user' || principal.activeOrgId !== orgId) return null;
    return principal;
  }
}
