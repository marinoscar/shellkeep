import { Injectable } from '@nestjs/common';
import { SettingsResolver } from '@marinoscar/platform-api/settings';

import {
  DEFAULT_RUNBOOKS_SYSTEM_SETTINGS,
  RUNBOOKS_SYSTEM_SETTINGS_KEY,
  type RunbooksSystemSettings,
} from '../settings/runbooks.system-settings';

/** The `runbooks` system settings as one organization sees them (org layer applied); the defaults when unreadable. */
@Injectable()
export class RunbookSettingsService {
  constructor(private readonly settings: SettingsResolver) {}

  async effective(orgId: string): Promise<RunbooksSystemSettings> {
    try {
      return await this.settings.resolveSystem<RunbooksSystemSettings>(RUNBOOKS_SYSTEM_SETTINGS_KEY, { orgId });
    } catch {
      return DEFAULT_RUNBOOKS_SYSTEM_SETTINGS;
    }
  }
}
