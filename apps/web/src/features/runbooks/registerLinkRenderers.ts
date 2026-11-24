import { freezeLinkRenderers, linkRenderers, registerLinkRenderer } from '@marinoscar/platform-web/sharing/headless';
import { PublicRunBundle } from './components/PublicRunBundle';

/**
 * Registers how the public `/s` page shows a `runbook_run` link (#63), then freezes the registry so a late import
 * cannot swap a public renderer. Idempotent (a hot reload or a second test file runs it again).
 */
export function registerRunbookLinkRenderers(): void {
  if (linkRenderers.isFrozen()) return;
  if (!linkRenderers.get('runbook_run')) registerLinkRenderer('runbook_run', PublicRunBundle);
  freezeLinkRenderers();
}
