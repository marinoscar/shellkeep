/** The owner of a server profile (#71): "You" for one the viewer owns outright, else the user or the group. */

import { Chip } from '@mui/material';
import { Groups as GroupsIcon, Person as PersonIcon } from '@mui/icons-material';
import type { ServerProfile } from '../../types';

/** Whether the viewer owns the profile outright (not through a group, not a share). */
export function isOwnedByViewer(profile: Pick<ServerProfile, 'owner' | 'access'>): boolean {
  return profile.owner?.kind === 'user' && profile.access?.shared === false;
}

export function ownerLabel(profile: Pick<ServerProfile, 'owner' | 'access'>): string {
  const owner = profile.owner;
  if (!owner) return 'You';
  if (isOwnedByViewer(profile)) return 'You';
  return owner.name ?? (owner.kind === 'group' ? 'A group' : 'Someone');
}

export function ServerOwnerChip({ profile }: { profile: Pick<ServerProfile, 'owner' | 'access'> }) {
  if (!profile.owner) return null;
  const mine = isOwnedByViewer(profile);
  const label = ownerLabel(profile);
  return (
    <Chip
      size="small"
      variant={mine ? 'outlined' : 'filled'}
      icon={profile.owner.kind === 'group' ? <GroupsIcon /> : <PersonIcon />}
      label={label}
      data-testid="owner-chip"
      aria-label={`Owner: ${label}`}
    />
  );
}
