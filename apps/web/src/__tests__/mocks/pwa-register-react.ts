export function useRegisterSW() {
  return {
    needRefresh: [false, () => {}] as [boolean, (val: boolean) => void],
    offlineReady: [false, () => {}] as [boolean, (val: boolean) => void],
    updateServiceWorker: () => Promise.resolve(),
  };
}
