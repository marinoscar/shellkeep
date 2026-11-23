// =============================================================================
// SYSTEM_SETTINGS_STORE adapter: packaged slices read and patch ShellKeep's
// system settings, one namespace at a time (issue #48)
// =============================================================================
//
// A thin wrapper over the platform's `SystemSettingsService`. `read` goes through
// `getSettings()` (the one `system_settings` row and its integer `version`);
// `patch` is parsed with the same composed PATCH schema the route applies (a bad
// patch is the same 400), then goes through `patchSettings(...)`, so the merge
// validation, the If-Match check (a stale version is the same 409) and the
// settings audit trail stay where they are. Nothing here writes on its own.
// =============================================================================

import { BadRequestException, Injectable } from '@nestjs/common';
import type { SystemSettingsSnapshot, SystemSettingsStore } from '@marinoscar/platform-api/core';
import { SystemSettingsService, currentPatchSystemSettingsSchema } from '@marinoscar/platform-api/settings';

type SettingsDocument = Record<string, unknown> & { version: number };

/** Response fields of the document that are not settings namespaces. */
const NOT_NAMESPACES = new Set(['version', 'updatedAt', 'updatedBy', 'security']);

@Injectable()
export class SystemSettingsStoreAdapter implements SystemSettingsStore {
  constructor(private readonly settings: SystemSettingsService) {}

  async read(namespace: string): Promise<SystemSettingsSnapshot> {
    const document = (await this.settings.getSettings()) as unknown as SettingsDocument;

    return this.pick(document, namespace);
  }

  async patch(
    namespace: string,
    patch: Record<string, unknown>,
    ctx: { actorUserId: string; ifMatchVersion?: number },
  ): Promise<SystemSettingsSnapshot> {
    const schema = currentPatchSystemSettingsSchema();
    // Before a patch, the namespace must be one the PATCH schema knows: zod strips an
    // unknown key, which would turn a typo into an empty patch that still bumps the
    // version and writes an audit event.
    if (NOT_NAMESPACES.has(namespace) || !Object.hasOwn(schema.shape, namespace)) {
      throw new Error(`Unknown settings namespace "${namespace}".`);
    }
    const parsed = schema.safeParse({ [namespace]: patch });
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid "${namespace}" settings patch: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
      );
    }
    const document = (await this.settings.patchSettings(
      parsed.data as Parameters<SystemSettingsService['patchSettings']>[0],
      ctx.actorUserId,
      ctx.ifMatchVersion,
    )) as unknown as SettingsDocument;

    return this.pick(document, namespace);
  }

  private pick(document: SettingsDocument, namespace: string): SystemSettingsSnapshot {
    if (NOT_NAMESPACES.has(namespace) || !Object.hasOwn(document, namespace)) {
      throw new Error(`Unknown settings namespace "${namespace}".`);
    }

    return { value: document[namespace], version: document.version };
  }
}
