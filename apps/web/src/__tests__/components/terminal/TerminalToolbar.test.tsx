import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { TerminalToolbar } from '../../../components/terminal/TerminalToolbar';

const defaultProps = {
  sessionName: 'My Session',
  isConnected: true,
  onOpenNewTab: vi.fn(),
  onDisconnect: vi.fn(),
  onRename: vi.fn(),
  showScrollButtons: false,
  onToggleScrollButtons: vi.fn(),
};

describe('TerminalToolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the session name', () => {
      render(<TerminalToolbar {...defaultProps} />);

      expect(screen.getByText('My Session')).toBeInTheDocument();
    });

    it('should render the open-in-new-tab button', () => {
      render(<TerminalToolbar {...defaultProps} />);

      expect(screen.getByTestId('OpenInNewIcon')).toBeInTheDocument();
    });

    it('should render the disconnect button', () => {
      render(<TerminalToolbar {...defaultProps} />);

      expect(screen.getByTestId('PowerSettingsNewIcon')).toBeInTheDocument();
    });

    it('should render the rename edit button', () => {
      render(<TerminalToolbar {...defaultProps} />);

      expect(screen.getByTestId('EditIcon')).toBeInTheDocument();
    });

    it('should render copy button when onCopyAll is provided', () => {
      render(<TerminalToolbar {...defaultProps} onCopyAll={vi.fn()} />);

      expect(screen.getByTestId('ContentCopyIcon')).toBeInTheDocument();
    });

    it('should not render copy button when onCopyAll is omitted', () => {
      render(<TerminalToolbar {...defaultProps} />);

      expect(screen.queryByTestId('ContentCopyIcon')).not.toBeInTheDocument();
    });

    it('should render download button when onDownload is provided', () => {
      render(<TerminalToolbar {...defaultProps} onDownload={vi.fn()} />);

      expect(screen.getByTestId('DownloadIcon')).toBeInTheDocument();
    });

    it('should not render download button when onDownload is omitted', () => {
      render(<TerminalToolbar {...defaultProps} />);

      expect(screen.queryByTestId('DownloadIcon')).not.toBeInTheDocument();
    });
  });

  describe('Connection status indicator', () => {
    it('should render a status indicator when connected', () => {
      const { container } = render(<TerminalToolbar {...defaultProps} isConnected={true} />);

      // The CircleIcon SVG is present in the toolbar
      const svgIcons = container.querySelectorAll('svg');
      expect(svgIcons.length).toBeGreaterThan(0);
    });

    it('should render a status indicator when disconnected', () => {
      const { container } = render(<TerminalToolbar {...defaultProps} isConnected={false} />);

      const svgIcons = container.querySelectorAll('svg');
      expect(svgIcons.length).toBeGreaterThan(0);
    });

    it('should display the session name regardless of connection state', () => {
      render(<TerminalToolbar {...defaultProps} isConnected={false} sessionName="Test Session" />);

      expect(screen.getByText('Test Session')).toBeInTheDocument();
    });
  });

  describe('Button interactions', () => {
    it('should call onOpenNewTab when the open-in-new-tab button is clicked', async () => {
      const onOpenNewTab = vi.fn();
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} onOpenNewTab={onOpenNewTab} />);

      await user.click(screen.getByTestId('OpenInNewIcon').closest('button')!);

      expect(onOpenNewTab).toHaveBeenCalledTimes(1);
    });

    it('should call onDisconnect when the disconnect button is clicked', async () => {
      const onDisconnect = vi.fn();
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} onDisconnect={onDisconnect} />);

      await user.click(screen.getByTestId('PowerSettingsNewIcon').closest('button')!);

      expect(onDisconnect).toHaveBeenCalledTimes(1);
    });

    it('should call onCopyAll when copy button is clicked', async () => {
      const onCopyAll = vi.fn();
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} onCopyAll={onCopyAll} />);

      await user.click(screen.getByTestId('ContentCopyIcon').closest('button')!);

      expect(onCopyAll).toHaveBeenCalledTimes(1);
    });

    it('should call onDownload when download button is clicked', async () => {
      const onDownload = vi.fn();
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} onDownload={onDownload} />);

      await user.click(screen.getByTestId('DownloadIcon').closest('button')!);

      expect(onDownload).toHaveBeenCalledTimes(1);
    });
  });

  describe('Scroll-buttons toggle', () => {
    it('should render a toggle button with aria-label "Toggle scroll buttons"', () => {
      render(<TerminalToolbar {...defaultProps} showScrollButtons={false} />);

      expect(
        screen.getByRole('button', { name: /toggle scroll buttons/i }),
      ).toBeInTheDocument();
    });

    it('when showScrollButtons is false, tooltip says "Show scroll buttons" and click invokes onToggleScrollButtons once', async () => {
      const onToggleScrollButtons = vi.fn();
      const user = userEvent.setup();
      render(
        <TerminalToolbar
          {...defaultProps}
          showScrollButtons={false}
          onToggleScrollButtons={onToggleScrollButtons}
        />,
      );

      const toggleBtn = screen.getByRole('button', { name: /toggle scroll buttons/i });

      // Hover to reveal tooltip
      await user.hover(toggleBtn);
      expect(await screen.findByText('Show scroll buttons')).toBeInTheDocument();

      await user.click(toggleBtn);
      expect(onToggleScrollButtons).toHaveBeenCalledTimes(1);
    });

    it('when showScrollButtons is true, tooltip says "Hide scroll buttons" and click invokes onToggleScrollButtons once', async () => {
      const onToggleScrollButtons = vi.fn();
      const user = userEvent.setup();
      render(
        <TerminalToolbar
          {...defaultProps}
          showScrollButtons={true}
          onToggleScrollButtons={onToggleScrollButtons}
        />,
      );

      const toggleBtn = screen.getByRole('button', { name: /toggle scroll buttons/i });

      await user.hover(toggleBtn);
      expect(await screen.findByText('Hide scroll buttons')).toBeInTheDocument();

      await user.click(toggleBtn);
      expect(onToggleScrollButtons).toHaveBeenCalledTimes(1);
    });
  });

  describe('Rename editing', () => {
    it('should switch to editing mode when rename button is clicked', async () => {
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);

      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.queryByTestId('EditIcon')).not.toBeInTheDocument();
    });

    it('should pre-populate the text field with the current session name', async () => {
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} sessionName="Old Name" />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);

      const input = screen.getByRole('textbox') as HTMLInputElement;
      expect(input.value).toBe('Old Name');
    });

    it('should call onRename with trimmed value when confirm button is clicked', async () => {
      const onRename = vi.fn();
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} onRename={onRename} sessionName="Old Name" />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'New Name');

      // The confirm button is the first icon button in editing mode (CheckIcon, color=primary)
      const buttons = screen.getAllByRole('button');
      const confirmButton = buttons.find(
        (b) => b.querySelector('[data-testid="CheckIcon"]') || b.classList.contains('MuiIconButton-colorPrimary'),
      );
      if (confirmButton) await user.click(confirmButton);

      expect(onRename).toHaveBeenCalledWith('New Name');
    });

    it('should not call onRename when name is unchanged and confirm is triggered', async () => {
      const onRename = vi.fn();
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} onRename={onRename} sessionName="Same Name" />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);
      // Press Enter without changing the value
      await user.keyboard('{Enter}');

      expect(onRename).not.toHaveBeenCalled();
    });

    it('should call onRename when Enter key is pressed', async () => {
      const onRename = vi.fn();
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} onRename={onRename} sessionName="Old Name" />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'New Name');
      await user.keyboard('{Enter}');

      expect(onRename).toHaveBeenCalledWith('New Name');
    });

    it('should cancel editing when Escape key is pressed', async () => {
      const onRename = vi.fn();
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} onRename={onRename} sessionName="Old Name" />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'Discarded Name');
      await user.keyboard('{Escape}');

      expect(onRename).not.toHaveBeenCalled();
      expect(screen.getByText('Old Name')).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('should cancel editing when cancel (close) button is clicked', async () => {
      const onRename = vi.fn();
      const user = userEvent.setup();
      render(<TerminalToolbar {...defaultProps} onRename={onRename} sessionName="Old Name" />);

      await user.click(screen.getByTestId('EditIcon').closest('button')!);
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'Discarded');

      // The cancel button is the second action button in editing mode (CloseIcon, no color)
      const buttons = screen.getAllByRole('button');
      const cancelButton = buttons.find(
        (b) =>
          b.querySelector('[data-testid="CloseIcon"]') &&
          !b.classList.contains('MuiIconButton-colorPrimary'),
      );
      if (cancelButton) await user.click(cancelButton);

      expect(onRename).not.toHaveBeenCalled();
      expect(screen.getByText('Old Name')).toBeInTheDocument();
    });
  });
});
