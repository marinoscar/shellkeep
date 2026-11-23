// =============================================================================
// Maintenance mode and the terminal WebSocket (issue #46)
// =============================================================================
//
// The platform's `MaintenanceGuard` covers HTTP only: a WebSocket frame is not a
// Nest HTTP route, so the gateway applies the same window itself, with the same
// rules, through this class:
//
//   1. no window open                                   -> allowed
//   2. `allowAdmins` and the caller holds the system
//      `admin` role                                      -> allowed (the guard's
//      built-in rule; here the role comes from the principal the identity slice
//      resolved, not from an unverified claim)
//   3. a registered maintenance bypass (`registerMaintenanceBypass`) says `true`
//      for a synthetic `GET /api/terminal/ws`            -> allowed (fail closed:
//      a throw, a timeout or any other value is "not bypassed")
//   4. otherwise                                         -> refused
//
// Only a NEW authentication or a NEW session attach is ever refused. A socket
// that is already streaming is never touched, and neither is the token refresh
// (`auth` re-sent on an authenticated socket), so a window does not cut off the
// people who are mid-work.
//
// FAIL OPEN on an unreadable window: the service already degrades an unreadable
// persisted setting to "not in maintenance" with one warning; if even that throws,
// refusing every terminal would turn a settings hiccup into an outage.
// =============================================================================

import { Injectable, Logger } from '@nestjs/common';
import {
  MAINTENANCE_BYPASS_TIMEOUT_MS,
  MaintenanceModeService,
  maintenanceBypassRegistry,
  type MaintenanceBypassPrincipal,
  type MaintenanceBypassRequest,
} from '@marinoscar/platform-api/host';
import { IDENTITY_ROLES } from '@marinoscar/platform-api/identity';

/** The path of the WebSocket the bypasses see (they key on `method` and `path`). */
const WS_PATH = '/api/terminal/ws';

/** Who is asking, as the principal resolver knows them. */
export interface MaintenanceSubject {
  readonly userId: string;
  readonly roles: readonly string[];
}

/** The `auth_fail` reason a refused client receives. The web mirrors this literal. */
export const TERMINAL_MAINTENANCE_REASON = 'maintenance';

@Injectable()
export class TerminalMaintenancePolicy {
  private readonly logger = new Logger(TerminalMaintenancePolicy.name);

  constructor(private readonly maintenance: MaintenanceModeService) {}

  /** Whether a window is open and refuses this caller a new authentication or session attach. */
  async refuses(subject: MaintenanceSubject): Promise<boolean> {
    let state;
    try {
      state = await this.maintenance.resolve();
    } catch (error) {
      this.logger.warn(
        `Maintenance state unreadable, allowing the terminal connection: ${error instanceof Error ? error.message : String(error)}`,
      );
      return false;
    }
    if (!state.enabled) return false;

    if (state.allowAdmins && subject.roles.includes(IDENTITY_ROLES.ADMIN.id)) return false;

    return !(await this.bypassed(subject));
  }

  /** `false` when `promise` has not settled within the bypass time limit; the timer never outlives it. */
  private async withinTimeout(promise: Promise<boolean>): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), MAINTENANCE_BYPASS_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async bypassed(subject: MaintenanceSubject): Promise<boolean> {
    const bypasses = maintenanceBypassRegistry.list();
    if (bypasses.length === 0) return false;

    const request: MaintenanceBypassRequest = Object.freeze({
      method: 'GET',
      path: WS_PATH,
      headers: Object.freeze({}),
      ip: undefined,
    });
    const principal: MaintenanceBypassPrincipal = Object.freeze({
      kind: 'session' as const,
      userId: subject.userId,
      roles: Object.freeze([...subject.roles]),
    });

    for (const bypass of bypasses) {
      try {
        const allowed = await this.withinTimeout(Promise.resolve(bypass.allows(request, principal)));
        if (allowed === true) return true;
      } catch (error) {
        this.logger.warn(
          `Maintenance bypass "${bypass.id}" failed and was treated as "not bypassed": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return false;
  }
}
