/// <reference lib="webworker" />

/**
 * ShellKeep's service worker (issue #51), built by `vite-plugin-pwa` with the
 * `injectManifest` strategy (`vite.config.ts`). Before #51 the plugin
 * generated the worker (`generateSW`); the notifications slice's Web Push
 * handlers have to live in the worker itself, so the app now owns this file
 * and keeps the same jobs the generated worker did:
 *
 *   1. Precache the built app shell (`self.__WB_MANIFEST`, replaced at build
 *      time) and drop the precaches of earlier revisions.
 *   2. Answer in-app navigations from the precached `index.html`, never one
 *      under `/api/` (the API, its reference, the terminal WebSocket and the
 *      notification SSE stream, which never ends) or `/.well-known/`.
 *   3. The update handshake of `registerType: 'prompt'`: a new worker waits
 *      until the page's `UpdatePrompt` (#46, `useRegisterSW`) posts
 *      `{ type: 'SKIP_WAITING' }`. No top-level `skipWaiting()`.
 *   4. `push`, `notificationclick` and `pushsubscriptionchange`: the packaged
 *      handlers (`@marinoscar/platform-web/notifications/service-worker`, the
 *      React-free entry, never the `/headless` barrel).
 *
 * THIS WORKER NEVER CALLS THE API. It has no token: the access token lives in
 * the page's memory only, and the refresh cookie rotates on every use, so a
 * worker refreshing on its own would sign the page out. A push renders the
 * payload it was given; a click is handed to an open page (`postMessage`) or
 * opens one with the id in `?n=`, and the PAGE marks it read.
 *
 * NOTHING UNDER `/api` IS CACHED. Cache Storage outlives the session and is
 * shared by every account on the device, so no runtime caching route is
 * registered (the generated worker's `/api` NetworkFirst route never matched,
 * its pattern being tested against the full URL; it is not carried over), and
 * the precache globs match built static assets only. The generated worker's
 * image and script runtime caches are not carried over either: every built
 * asset is in the precache.
 */

import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { registerNotificationServiceWorkerHandlers } from '@marinoscar/platform-web/notifications/service-worker';

declare let self: ServiceWorkerGlobalScope;

// 1. The app shell.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// 2. The SPA fallback, with the API and the server's own documents denied.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/\.well-known\//],
  }),
);

// Control open pages as soon as this worker activates: an uncontrolled page
// has no active registration, so on Android (where notifications are
// service-worker-only) a first-visit user would allow notifications and then
// see nothing until a reload.
clientsClaim();

// 3. The update handshake; the page decides when to hand over.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

// 4. Web Push and notification clicks.
registerNotificationServiceWorkerHandlers(self, {
  icon: '/pwa-192x192.png',
  badge: '/pwa-maskable-192x192.png',
});
