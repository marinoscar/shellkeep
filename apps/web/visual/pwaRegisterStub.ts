/**
 * Stands in for `virtual:pwa-register/react` (the `vite-plugin-pwa` virtual
 * module `App.tsx` imports). The harness registers no service worker: a worker
 * caches and serves the app shell, so a pixel suite could screenshot the
 * previous run's assets, and its activation races the first navigation.
 */
export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (value: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (value: boolean) => void],
    updateServiceWorker: () => Promise.resolve(),
  };
}
