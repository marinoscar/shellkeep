import { useEffect } from 'react';

export const UNSAVED_MESSAGE = 'You have unsaved changes. Leave without saving?';

/**
 * Warns before leaving with unsaved changes (issue #65). The app uses `BrowserRouter`, which has
 * no navigation blocker, so this covers the two ways out: closing or reloading the tab
 * (`beforeunload`) and following an in-app link (a capture-phase click on an `<a href>`, which
 * every rail, menu and breadcrumb link is).
 */
const windowConfirm = (message: string): boolean => window.confirm(message);

export function useUnsavedChangesGuard(dirty: boolean, confirm: (message: string) => boolean = windowConfirm): void {
  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
      const anchor = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      if (!confirm(UNSAVED_MESSAGE)) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirm]);
}
