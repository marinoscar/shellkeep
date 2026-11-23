import { Injectable, Logger } from '@nestjs/common';
import type {
  AllowlistInvitationNotice,
  IdentityNotifier,
  OrgInvitationNotice,
  RoleChangedNotice,
  UserWelcomeNotice,
} from '@marinoscar/platform-api/identity';

/**
 * Identity's `IDENTITY_NOTIFIER`: the four notifications identity raises.
 *
 * PLATFORM-ADOPTION-SHIM(#51): ShellKeep has no notifications slice (and no
 * email transport) until #51, so each notice is logged at debug level and
 * dropped. `orgInvitation` is dropped for good in single-organization mode (the
 * organization routes are unreachable). No address is logged: only the counts and
 * the event name. #51 binds the platform's `NotificationsService`. See
 * docs/platform-adoption/local-exceptions.md.
 *
 * Identity calls every method after the triggering write committed and outside
 * any transaction, so a failure here can never fail a sign-in.
 */
@Injectable()
export class IdentityNotifierAdapter implements IdentityNotifier {
  private readonly logger = new Logger(IdentityNotifierAdapter.name);

  async roleChanged(userId: string, _notice: RoleChangedNotice): Promise<void> {
    this.logger.debug(`security.role_changed for user ${userId} not delivered: no notifications slice yet`);
  }

  async userWelcomed(userId: string, _notice: UserWelcomeNotice): Promise<void> {
    this.logger.debug(`user.welcome for user ${userId} not delivered: no notifications slice yet`);
  }

  async allowlistInvitation(_email: string, _notice: AllowlistInvitationNotice): Promise<void> {
    this.logger.debug('allowlist.invitation not delivered: no notifications slice yet');
  }

  async orgInvitation(_email: string, notice: OrgInvitationNotice): Promise<void> {
    this.logger.debug(
      `Dropping an organization invitation to "${notice.orgName}": single-organization mode has none`,
    );
  }
}
