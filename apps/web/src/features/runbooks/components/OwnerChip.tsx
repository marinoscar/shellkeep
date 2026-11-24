import { Chip } from '@mui/material';
import PersonOutlineIcon from '@mui/icons-material/PersonOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import type { RunbookAccess, RunbookOwner } from '../api/types';

/** Who owns a runbook (#71): the user or the group, and "shared with you" when it is not yours. */
export function OwnerChip({ owner, access }: { owner: RunbookOwner; access?: RunbookAccess }) {
  const mine = access?.role === 'owner' && owner.kind === 'user';
  const name = owner.name ?? (owner.kind === 'group' ? 'A group' : 'Unknown user');
  const label = mine ? 'You' : access?.shared && access.via !== 'group_member' ? `${name} · shared` : name;
  return (
    <Chip
      size="small"
      variant="outlined"
      icon={owner.kind === 'group' ? <GroupsOutlinedIcon aria-hidden="true" /> : <PersonOutlineIcon aria-hidden="true" />}
      label={label}
      aria-label={`Owner: ${mine ? 'you' : name}${access?.shared && !mine ? ', shared with you' : ''}`}
    />
  );
}
