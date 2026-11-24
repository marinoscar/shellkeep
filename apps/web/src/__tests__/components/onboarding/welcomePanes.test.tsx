import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  ADMIN_WELCOME,
  USER_WELCOME,
  adminWelcomePane,
  userWelcomePane,
} from '../../../components/onboarding/welcomePanes';

const props = { descriptionId: 'welcome-description', appName: 'ShellKeep', setExtra: () => undefined };

describe('ShellKeep welcome panes', () => {
  it("walks a user through ShellKeep's first steps, in checklist order", () => {
    const text = USER_WELCOME.points.join(' ');
    expect(text.indexOf('Add a server')).toBeLessThan(text.indexOf('Trust its host key'));
    expect(text.indexOf('Trust its host key')).toBeLessThan(text.indexOf('Open a session'));
  });

  it('points an administrator at the Setup guide', () => {
    expect(ADMIN_WELCOME.points.join(' ')).toMatch(/Setup guide/);
  });

  it('renders each pane on the element the dialog describes itself by', () => {
    const { unmount } = render(<>{userWelcomePane(props)}</>);
    expect(document.getElementById('welcome-description')).toHaveTextContent(USER_WELCOME.lead);
    expect(screen.getAllByRole('listitem')).toHaveLength(USER_WELCOME.points.length);
    unmount();
    render(<>{adminWelcomePane(props)}</>);
    expect(document.getElementById('welcome-description')).toHaveTextContent(ADMIN_WELCOME.lead);
  });
});
