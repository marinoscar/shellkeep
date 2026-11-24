// The share dialog of a ShellKeep record (issue #71): the role vocabulary per resource type, and
// no link section (links are off for both types).
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

const shareDialog = vi.fn((_props: unknown) => null);
vi.mock('@marinoscar/platform-web/sharing/ui', () => ({
  ShareDialog: (props: unknown) => shareDialog(props),
}));

import {
  RUNBOOK_SHARE_ROLES,
  SERVER_PROFILE_SHARE_ROLES,
  ShareResourceDialog,
} from '../../../components/common/ShareResourceDialog';

describe('ShareResourceDialog', () => {
  it('offers the three server profile roles, weakest first, and never a link', () => {
    render(<ShareResourceDialog open onClose={() => undefined} resourceType="server_profile" resourceId="s-1" title="Box" />);
    expect(shareDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({
        resource: { type: 'server_profile', id: 's-1' },
        resourceTitle: 'Box',
        allowGroups: true,
        allowLinks: false,
        roles: SERVER_PROFILE_SHARE_ROLES,
      }),
    );
    expect(SERVER_PROFILE_SHARE_ROLES.map((role) => role.value)).toEqual(['viewer', 'operator', 'editor']);
  });

  it('offers the runbook roles viewer, runner and editor', () => {
    render(<ShareResourceDialog open onClose={() => undefined} resourceType="runbook" resourceId="r-1" />);
    expect(shareDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ resource: { type: 'runbook', id: 'r-1' }, allowLinks: false, roles: RUNBOOK_SHARE_ROLES }),
    );
    expect(RUNBOOK_SHARE_ROLES.map((role) => role.value)).toEqual(['viewer', 'runner', 'editor']);
  });
});
