// =============================================================================
// ShellKeep's data export sources and writers (issue #68)
// =============================================================================
//
// Pure data: no `register()` calls, no Nest, no services. `platform/exports/export-registrations.manifest.ts`
// registers them, before `ExportsModule.forRoot()` adds the platform's `user-data` / `org-data` sources and
// the `json` / `csv` / `xlsx` writers. This file lives here, not in `platform/exports/`, because that folder
// is base code and may not name the domain (`test/architecture/base-domain-boundary.spec.ts`).
//
// EVERY source here lists its columns as an allowlist (never "the model minus the secrets") and selects
// exactly those: no credential column, tmux scrollback or log content is ever read. Their permissions are the
// exact strings the sources route enforces. Source ids and writer ids are permanent once exports carry them.
// =============================================================================

import type { ExportSource, ExportWriter } from '@marinoscar/platform-api/exports';

import { RUNBOOK_RUNS_EXPORT_SOURCE } from '../runbooks/export/runbook-runs.export-source';
import { SERVER_PROFILES_EXPORT_SOURCE } from '../server-profiles/export/server-profiles.export-source';
import { TERMINAL_SESSIONS_EXPORT_SOURCE } from '../terminal/export/terminal-sessions.export-source';

/** ShellKeep's own export sources, registered after the platform's. */
// `any`: each source is typed by its own request; the registry holds them as one list.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const APP_EXPORT_SOURCES: readonly ExportSource<any>[] = [
  SERVER_PROFILES_EXPORT_SOURCE,
  TERMINAL_SESSIONS_EXPORT_SOURCE,
  RUNBOOK_RUNS_EXPORT_SOURCE,
];

/** ShellKeep's own export writers (none: the platform's json, csv and xlsx cover every source). */
export const APP_EXPORT_WRITERS: readonly ExportWriter[] = [];
