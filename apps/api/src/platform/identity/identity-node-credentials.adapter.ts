import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser, IdentityNodeCredentials } from '@marinoscar/platform-api/identity';

/**
 * Identity's `IDENTITY_NODE_CREDENTIALS`: how a `nod_` worker-node bearer token
 * is resolved.
 *
 * PLATFORM-ADOPTION-SHIM(#49): ShellKeep has no worker nodes until #49, so no
 * `nod_` token is ever valid and every one resolves to nobody (a 401). #49 binds
 * the platform's `NodeCredentialService`. See
 * docs/platform-adoption/local-exceptions.md.
 */
@Injectable()
export class IdentityNodeCredentialsAdapter implements IdentityNodeCredentials {
  async validateToken(_token: string): Promise<AuthenticatedUser | null> {
    return null;
  }
}
