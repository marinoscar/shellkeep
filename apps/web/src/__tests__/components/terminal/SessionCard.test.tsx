import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { SessionCard } from '../../../components/terminal/SessionCard';
import type { TerminalSession } from '../../../types';

const baseSession: TerminalSession = {
  id: 'session-1',
  name: 'My Terminal',
  status: 'active',
  tmuxSessionId: 'tmux-abc',
  cols: 80,
  rows: 24,
  lastActivityAt: new Date().toISOString(),
  terminatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  serverProfile: {
    id: 'profile-1',
    name: 'Dev Server',
    hostname: 'dev.example.com',
    port: 22,
    username: 'deploy',
  },
};

const defaultProps = {
  session: baseSession,
  onOpen: vi.fn(),
  onRename: vi.fn(),
  onTerminate: vi.fn(),
};

describe('SessionCard', () => {
  describe('Rendering', () => {
    it('should render session name', () => {
      render(<SessionCard {...defaultProps} />);

      expect(screen.getByText('My Terminal')).toBeInTheDocument();
    });

    it('should render server connection info', () => {
      render(<SessionCard {...defaultProps} />);

      expect(screen.getByText('deploy@dev.example.com:22')).toBeInTheDocument();
    });

    it('should render server profile name', () => {
      render(<SessionCard {...defaultProps} />);

      expect(screen.getByText('Dev Server')).toBeInTheDocument();
    });

    it('should render last activity time', () => {
      render(<SessionCard {...defaultProps} />);

      // "just now" since lastActivityAt is new Date()
      expect(screen.getByText(/Last activity:/)).toBeInTheDocument();
    });
  });

  describe('Status Badge', () => {
    it('should show active status chip', () => {
      render(<SessionCard {...defaultProps} />);

      const chip = screen.getByText('active');
      expect(chip).toBeInTheDocument();
    });

    it('should show detached status chip', () => {
      const detachedSession = { ...baseSession, status: 'detached' as const };
      render(<SessionCard {...defaultProps} session={detachedSession} />);

      const chip = screen.getByText('detached');
      expect(chip).toBeInTheDocument();
    });

    it('should show terminated status chip', () => {
      const terminatedSession = {
        ...baseSession,
        status: 'terminated' as const,
        terminatedAt: new Date().toISOString(),
      };
      render(<SessionCard {...defaultProps} session={terminatedSession} />);

      const chip = screen.getByText('terminated');
      expect(chip).toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('should render action buttons for active sessions', () => {
      render(<SessionCard {...defaultProps} />);

      expect(screen.getByTitle('Open terminal')).toBeInTheDocument();
      expect(screen.getByTitle('Rename')).toBeInTheDocument();
      expect(screen.getByTitle('Terminate')).toBeInTheDocument();
    });

    it('should render action buttons for detached sessions', () => {
      const detachedSession = { ...baseSession, status: 'detached' as const };
      render(<SessionCard {...defaultProps} session={detachedSession} />);

      expect(screen.getByTitle('Open terminal')).toBeInTheDocument();
      expect(screen.getByTitle('Rename')).toBeInTheDocument();
      expect(screen.getByTitle('Terminate')).toBeInTheDocument();
    });

    it('should hide action buttons for terminated sessions', () => {
      const terminatedSession = {
        ...baseSession,
        status: 'terminated' as const,
        terminatedAt: new Date().toISOString(),
      };
      render(<SessionCard {...defaultProps} session={terminatedSession} />);

      expect(screen.queryByTitle('Open terminal')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Rename')).not.toBeInTheDocument();
      expect(screen.queryByTitle('Terminate')).not.toBeInTheDocument();
    });
  });

  describe('Interactions', () => {
    it('should call onOpen when open button is clicked', async () => {
      const onOpen = vi.fn();
      render(<SessionCard {...defaultProps} onOpen={onOpen} />);

      const user = userEvent.setup();
      await user.click(screen.getByTitle('Open terminal'));

      expect(onOpen).toHaveBeenCalledWith(baseSession);
    });

    it('should call onRename when rename button is clicked', async () => {
      const onRename = vi.fn();
      render(<SessionCard {...defaultProps} onRename={onRename} />);

      const user = userEvent.setup();
      await user.click(screen.getByTitle('Rename'));

      expect(onRename).toHaveBeenCalledWith(baseSession);
    });

    it('should call onTerminate when terminate button is clicked', async () => {
      const onTerminate = vi.fn();
      render(<SessionCard {...defaultProps} onTerminate={onTerminate} />);

      const user = userEvent.setup();
      await user.click(screen.getByTitle('Terminate'));

      expect(onTerminate).toHaveBeenCalledWith(baseSession);
    });
  });

  describe('Relative Time Display', () => {
    it('should show "just now" for very recent activity', () => {
      render(<SessionCard {...defaultProps} />);

      expect(screen.getByText(/just now/)).toBeInTheDocument();
    });

    it('should show minutes for older activity', () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const session = { ...baseSession, lastActivityAt: fiveMinAgo };
      render(<SessionCard {...defaultProps} session={session} />);

      expect(screen.getByText(/5 min ago/)).toBeInTheDocument();
    });

    it('should show hours for activity hours ago', () => {
      const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const session = { ...baseSession, lastActivityAt: threeHoursAgo };
      render(<SessionCard {...defaultProps} session={session} />);

      expect(screen.getByText(/3h ago/)).toBeInTheDocument();
    });

    it('should show days for activity days ago', () => {
      const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const session = { ...baseSession, lastActivityAt: twoDaysAgo };
      render(<SessionCard {...defaultProps} session={session} />);

      expect(screen.getByText(/2d ago/)).toBeInTheDocument();
    });
  });
});
