/**
 * A short haptic tick (#166, epic #171) where the device supports it (Android
 * Chrome; iOS Safari has no `navigator.vibrate`). Does nothing when `enabled`
 * is false (the user's `shortcuts.options.haptics`).
 */
export function hapticTick(enabled: boolean): void {
  if (!enabled || typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    navigator.vibrate(10);
  } catch {
    // Some browsers refuse vibration without a user activation: no feedback then.
  }
}
