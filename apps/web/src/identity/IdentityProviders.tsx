/**
 * This app's binding of the identity slice's providers (issue #47). One
 * component, so `App.tsx` and the tests mount the same wiring:
 *
 *   - `AuthProvider` drives the session through the app's one HTTP client
 *     (`client={api}`): the boot-time refresh from the HttpOnly cookie, the
 *     current user (`GET /api/auth/me`), the sign-in providers, sign-out and
 *     the "session expired" signal.
 *   - `IdentityWebAdaptersProvider` hands the identity pages this app's
 *     spinner, product name and identity client. It sits inside the auth
 *     provider and outside the routes: the login page renders outside the
 *     signed-in layout.
 *
 * Mount it once, inside the router.
 */

import type { ReactNode } from 'react';
import {
  AuthProvider,
  IdentityWebAdaptersProvider,
} from '@marinoscar/platform-web/identity/headless';
import { api } from '../services/api';
import { appIdentityAdapters } from './identityAdapters';

export function IdentityProviders({ children }: { children: ReactNode }) {
  return (
    <AuthProvider client={api}>
      <IdentityWebAdaptersProvider adapters={appIdentityAdapters}>
        {children}
      </IdentityWebAdaptersProvider>
    </AuthProvider>
  );
}
