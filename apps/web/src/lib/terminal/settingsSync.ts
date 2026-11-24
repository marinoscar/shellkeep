// =============================================================================
// Live terminal preferences across hook instances and tabs (issue #80)
// =============================================================================
//
// The packaged `useUserSettings` keeps its document per hook instance, so a
// change saved on the Terminal settings page (or by a workspace toolbar toggle)
// would otherwise reach an open terminal only after a reload. Every
// `useTerminalSettings` instance publishes the document it holds here; the
// others, in this tab and (through a BroadcastChannel) in other tabs of the
// same origin, take it when its `version` is newer than theirs. Equal or older
// versions are ignored, so a republished document never ping-pongs.
// =============================================================================

import type { TerminalUserSettingsDocument } from '../../types/terminal';

type Listener = (document: TerminalUserSettingsDocument) => void;

const CHANNEL_NAME = 'shellkeep:user-settings';
const listeners = new Set<Listener>();
let channel: BroadcastChannel | null | undefined;

function getChannel(): BroadcastChannel | null {
  if (channel !== undefined) return channel;
  try {
    channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL_NAME) : null;
  } catch {
    channel = null;
  }
  if (channel) {
    channel.onmessage = (event: MessageEvent<TerminalUserSettingsDocument>) => {
      if (event.data && typeof event.data.version === 'number') {
        for (const listener of listeners) listener(event.data);
      }
    };
  }
  return channel;
}

/** Subscribes to documents published by other instances; returns the unsubscribe. */
export function subscribeTerminalSettings(listener: Listener): () => void {
  getChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hands `document` to every other instance in this tab and to other tabs. */
export function publishTerminalSettings(
  document: TerminalUserSettingsDocument,
  source: Listener,
): void {
  for (const listener of listeners) {
    if (listener !== source) listener(document);
  }
  try {
    getChannel()?.postMessage(document);
  } catch {
    // A document that cannot be cloned stays in this tab.
  }
}
