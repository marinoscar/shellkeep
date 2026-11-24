import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  openTab,
  parseWorkspaceSearch,
  readStoredLayout,
  resolveLayout,
  sameLayout,
  workspaceHref,
  writeStoredLayout,
  type WorkspaceLayout,
} from './workspaceLayout';

export interface UseWorkspaceLayoutResult {
  /** The current layout, or `null` before a route id is known. */
  layout: WorkspaceLayout | null;
  /**
   * Apply a new layout: state, the URL (replaced, so tab switches do not fill
   * the history) and the stored copy. `null` closes the workspace.
   */
  commit: (next: WorkspaceLayout | null) => void;
  /** The latest layout, for callbacks that must not re-subscribe on every change. */
  current: () => WorkspaceLayout | null;
}

/**
 * The workspace layout bound to the route (issue #77). The URL carries it
 * (`/sessions/<active>?tabs=...&split=...`); a bare `/sessions/<id>` (a link
 * from the session list or the switcher) opens `<id>` as a tab of the layout
 * already on screen, or of the stored one after a reload, without remounting
 * the page. The stored copy holds tab ids and the split only.
 */
export function useWorkspaceLayout(routeId: string | undefined, userId: string | null): UseWorkspaceLayoutResult {
  const location = useLocation();
  const navigate = useNavigate();
  const [layout, setLayout] = useState<WorkspaceLayout | null>(() =>
    routeId ? resolveLayout(routeId, parseWorkspaceSearch(location.search), readStoredLayout(userId)) : null,
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const hrefRef = useRef(location.pathname + location.search);
  hrefRef.current = location.pathname + location.search;

  // Refs keep `commit` stable, so the route effect below runs on route changes only.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const userRef = useRef(userId);
  userRef.current = userId;

  const commit = useCallback((next: WorkspaceLayout | null) => {
    const previous = layoutRef.current;
    const href = next ? workspaceHref(next) : null;
    if (next && previous && sameLayout(next, previous) && href === hrefRef.current) return;
    layoutRef.current = next;
    setLayout(next);
    writeStoredLayout(userRef.current, next);
    if (!next || !href) {
      navigateRef.current('/sessions');
      return;
    }
    if (href !== hrefRef.current) {
      hrefRef.current = href;
      navigateRef.current(href, { replace: true });
    }
  }, []);

  useEffect(() => {
    if (!routeId) return;
    const current = layoutRef.current;
    const fromUrl = parseWorkspaceSearch(location.search);
    if (fromUrl) {
      // A full URL (a reload, back/forward, a shared link): it wins.
      commit(resolveLayout(routeId, fromUrl, null));
      return;
    }
    // A bare `/sessions/<id>`: open it in the layout on screen (or the stored one).
    commit(current ? openTab(current, routeId) : resolveLayout(routeId, null, readStoredLayout(userRef.current)));
  }, [routeId, location.search, commit]);

  const current = useCallback(() => layoutRef.current, []);
  return { layout, commit, current };
}
