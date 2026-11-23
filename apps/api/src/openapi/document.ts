// =============================================================================
// ShellKeep's OpenAPI document (issue #46)
// =============================================================================
//
// The builder, the post-processing passes and the docs routes are the host
// slice's (`@marinoscar/platform-api/host`). What stays here is the app's
// identity (`APP_OPENAPI`); its tag taxonomy is `app-registrations/openapi-tags.ts`,
// registered into core's `openApiTags` by `shellkeep.manifest.ts`. `main.ts` (`registerPlatformDocs`),
// `scripts/dump-openapi.ts` and the tests all build the document through here, so
// the document CI lints is the document users get.
// =============================================================================

import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  createOpenApiDocument as createPlatformOpenApiDocument,
  type PlatformOpenApiOptions,
} from '@marinoscar/platform-api/host';

import { resolveApiVersion } from './version';

/** The product name and repository (mirrors `packages/shared/identity.json`). */
export const APP_NAME = 'ShellKeep';
export const REPO_URL = 'https://github.com/marinoscar/shellkeep';

/** This app's identity in the document: `<APP_NAME> API`, the repository and the resolved version. */
export const APP_OPENAPI: PlatformOpenApiOptions = {
  appName: APP_NAME,
  repoUrl: REPO_URL,
  version: resolveApiVersion,
};

/** Builds the finished document for this app. Call it after `setGlobalPrefix('api')`. */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return createPlatformOpenApiDocument(app, APP_OPENAPI);
}
