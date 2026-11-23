import type { ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material';
import {
  Home as HomeIcon,
  Terminal as TerminalIcon,
  Dns as DnsIcon,
  People as PeopleIcon,
} from '@mui/icons-material';

/**
 * One navigation destination. The shape maps onto the platform shell's
 * `ShellDestination` (`@marinoscar/platform-web/shell`) when #76 adopts it:
 * `id` becomes `key`, `icon` becomes `Icon` (a component, never an element),
 * `label`, `path` and `permission` carry over unchanged.
 */
export interface AppDestination {
  /** Stable key (React key and, from #76, the shell's active-state key). */
  id: string;
  /** The label drawn in the navigation. */
  label: string;
  /** The route the destination navigates to. */
  path: string;
  /** The icon component (rendered by the navigation, not here). */
  icon: ComponentType<SvgIconProps>;
  /**
   * The API permission that makes the destination reachable: the exact
   * string the controller enforces. Absent means any authenticated user.
   */
  permission?: string;
  /**
   * The role that makes the destination reachable. Transitional: the
   * identity slice (#47) replaces it with the `users:read` permission.
   */
  role?: string;
}

/**
 * The app's navigation destinations, in display order. Domain destinations
 * (Sessions, Servers) are declared here, in the composition root, so the base
 * navigation component never names them.
 */
export const DESTINATIONS: readonly AppDestination[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: HomeIcon },
  { id: 'sessions', label: 'Sessions', path: '/sessions', icon: TerminalIcon },
  { id: 'servers', label: 'Servers', path: '/servers', icon: DnsIcon },
  {
    id: 'user-management',
    label: 'User Management',
    path: '/admin/users',
    icon: PeopleIcon,
    role: 'admin',
  },
];

/**
 * Whether a viewer with these permissions and roles may reach the
 * destination.
 */
export function isDestinationVisible(
  destination: AppDestination,
  permissions: ReadonlySet<string>,
  roles: ReadonlySet<string>,
): boolean {
  if (destination.permission && !permissions.has(destination.permission)) return false;
  if (destination.role && !roles.has(destination.role)) return false;
  return true;
}
