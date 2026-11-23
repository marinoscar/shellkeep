// =============================================================================
// The app's composition root for static registries
// =============================================================================
//
// IMPORT THIS FIRST. `main.ts`, `app.module.ts` and `test/setup.ts` import it
// before anything that reads the registries, because the platform settings
// slice's request bodies and OpenAPI document are COMPOSED FROM THEM when
// `SettingsModule.forRoot()` runs.
//
// This is the one file (with `app.module.ts`, `main.ts` and
// `app-registrations/`) that knows both base and domain: base modules import
// no domain code (`test/architecture/base-domain-boundary.spec.ts`).
//
// ORDER IS THE STORED KEY ORDER: append, never insert.
//   settings namespaces: platform/settings/registry.ts (app-registrations/settings.ts)
//   platform roles, permissions and ownership: app-registrations/registrations.ts
//
// Registration is once per module registry (once per process, once per Jest
// test file): registering a namespace twice is a `DUPLICATE_ID` error.
// =============================================================================

// Registers the settings namespaces with the platform settings slice.
import './platform/settings/registry';
// Fills core's role, permission, user-owned-model and model-ownership registries.
import './app-registrations/registrations';
// The OpenAPI tags of the app's controllers.
import './app-registrations/openapi-tags';
