// The platform slices whose permissions ShellKeep registers (and so seeds).
// Side-effect free: read by `registrations.ts` and by the derived `PERMISSIONS`
// constant. Append a slice in the issue that adopts it.
export const ADOPTED_PLATFORM_SLICES = ['identity', 'settings', 'storage'] as const;
