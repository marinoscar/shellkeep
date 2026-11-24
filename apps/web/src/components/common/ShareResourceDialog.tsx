import { ShareDialog } from '@marinoscar/platform-web/sharing/ui';
import type { ShareDialogProps } from '@marinoscar/platform-web/sharing/ui';

/**
 * The share dialog of a ShellKeep record (issue #71): the platform's `ShareDialog` with the role
 * vocabulary of each resource type the API registers (`app-registrations/sharing.ts`). Weakest role
 * first: the first is the default. Link sharing is OFF for both types (the API answers 422
 * `ROLE_NOT_GRANTABLE`), so the dialog never offers it.
 *
 * Mount it from the row menu of a server profile and from the runbook detail page (#65).
 */
export type ShareableResourceType = 'server_profile' | 'runbook';

type RoleOptions = ShareDialogProps['roles'];

/** Roles of a shared server profile: see it, connect and run on it, change it. */
export const SERVER_PROFILE_SHARE_ROLES: RoleOptions = [
  { value: 'viewer', label: 'Can view (no connection)' },
  { value: 'operator', label: 'Can connect and run runbooks' },
  { value: 'editor', label: 'Can edit' },
];

/** Roles of a shared runbook: read it, run it, change it. */
export const RUNBOOK_SHARE_ROLES: RoleOptions = [
  { value: 'viewer', label: 'Can view' },
  { value: 'runner', label: 'Can view and run' },
  { value: 'editor', label: 'Can edit' },
];

const ROLES_BY_TYPE: Readonly<Record<ShareableResourceType, RoleOptions>> = {
  server_profile: SERVER_PROFILE_SHARE_ROLES,
  runbook: RUNBOOK_SHARE_ROLES,
};

export interface ShareResourceDialogProps {
  open: boolean;
  onClose: () => void;
  resourceType: ShareableResourceType;
  resourceId: string;
  /** Shown in the title: `Share "<title>"`. */
  title?: string;
  /** After every successful share, role change or revoke. */
  onChanged?: () => void;
}

export function ShareResourceDialog({
  open,
  onClose,
  resourceType,
  resourceId,
  title,
  onChanged,
}: ShareResourceDialogProps) {
  return (
    <ShareDialog
      open={open}
      onClose={onClose}
      resource={{ type: resourceType, id: resourceId }}
      resourceTitle={title}
      roles={ROLES_BY_TYPE[resourceType]}
      allowGroups
      allowLinks={false}
      onChanged={onChanged}
    />
  );
}
