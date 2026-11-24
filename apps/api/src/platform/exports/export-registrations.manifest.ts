// =============================================================================
// Export source and writer registrations (issue #68)
// =============================================================================
//
// Imported once, by `exports.config.ts`, before `ExportsModule.forRoot()`
// registers the platform's own sources and writers (both orders work: a
// source's formats are resolved when the sources are listed, and a
// re-registration of the same object is a no-op). The app's own entries come
// from `app-registrations/exports.ts`, which is pure data: this folder is base
// code and does not name the domain.
// =============================================================================

import { registerExportSource, registerExportWriter } from '@marinoscar/platform-api/exports';

import { APP_EXPORT_SOURCES, APP_EXPORT_WRITERS } from '../../app-registrations/exports';

for (const writer of APP_EXPORT_WRITERS) registerExportWriter(writer);
for (const source of APP_EXPORT_SOURCES) registerExportSource(source);
