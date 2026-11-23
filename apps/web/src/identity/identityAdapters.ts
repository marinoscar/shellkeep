/**
 * What the packaged identity pages take from this app (issue #47).
 *
 * `@marinoscar/platform-web/identity/ui` renders the login, callback, device
 * activation and Users & Allowlist pages. What is this app's is handed in here,
 * once, as a module constant:
 *
 *   - `appName`: the product name the sign-in error copy names.
 *   - `Spinner`: the app's `LoadingSpinner`, for whole-page waits.
 *   - `api`: the identity calls over the app's one HTTP client
 *     (`platformApi`, `services/api.ts`). Passed explicitly, so the pages need
 *     no `PlatformHostProvider`.
 *
 * The users, allowlist and token lists use the package's plain MUI table until
 * the app adopts the packaged `DataTable` with the shell (#76).
 */

import { createIdentityApi } from '@marinoscar/platform-web/identity/headless';
import type { IdentityWebAdapters } from '@marinoscar/platform-web/identity/headless';
import { APP_NAME } from '../config/app';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { platformApi } from '../services/api';

export const appIdentityAdapters: IdentityWebAdapters = {
  appName: APP_NAME,
  Spinner: LoadingSpinner,
  api: createIdentityApi(platformApi),
};
