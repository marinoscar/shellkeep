import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { DeviceCodeInput } from '../../../components/device-activation/DeviceCodeInput';

describe('DeviceCodeInput', () => {
  let mockOnVerify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnVerify = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('should render the instructional text', () => {
      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      expect(
        screen.getByText(/enter the code shown on your device/i),
      ).toBeInTheDocument();
    });

    it('should render the Device Code text field', () => {
      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      expect(screen.getByLabelText(/device code/i)).toBeInTheDocument();
    });

    it('should render the Verify Code submit button', () => {
      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      expect(
        screen.getByRole('button', { name: /verify code/i }),
      ).toBeInTheDocument();
    });

    it('should pre-populate the field with initialCode when provided', () => {
      render(
        <DeviceCodeInput
          initialCode="ABCD-1234"
          onVerify={mockOnVerify}
          error={null}
        />,
      );

      expect(screen.getByLabelText(/device code/i)).toHaveValue('ABCD-1234');
    });

    it('should default to empty string when no initialCode is provided', () => {
      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      expect(screen.getByLabelText(/device code/i)).toHaveValue('');
    });
  });

  describe('Input Formatting', () => {
    it('should format typed characters as XXXX-XXXX', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      expect(input).toHaveValue('ABCD-1234');
    });

    it('should uppercase all characters', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'abcd1234');

      expect(input).toHaveValue('ABCD-1234');
    });

    it('should strip non-alphanumeric characters', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'AB!@CD12#$');

      expect(input).toHaveValue('ABCD-12');
    });

    it('should not add a dash for less than 5 characters', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABC');

      expect(input).toHaveValue('ABC');
    });

    it('should add a dash after the 4th character', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCDE');

      expect(input).toHaveValue('ABCD-E');
    });
  });

  describe('Button State', () => {
    it('should disable Verify Code button when code is incomplete', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD');

      expect(
        screen.getByRole('button', { name: /verify code/i }),
      ).toBeDisabled();
    });

    it('should enable Verify Code button when code is exactly 9 characters (XXXX-XXXX)', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      expect(
        screen.getByRole('button', { name: /verify code/i }),
      ).toBeEnabled();
    });

    it('should start with Verify Code button disabled when field is empty', () => {
      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      expect(
        screen.getByRole('button', { name: /verify code/i }),
      ).toBeDisabled();
    });

    it('should enable button when initialCode is a valid 9-character code', () => {
      render(
        <DeviceCodeInput
          initialCode="ABCD-1234"
          onVerify={mockOnVerify}
          error={null}
        />,
      );

      expect(
        screen.getByRole('button', { name: /verify code/i }),
      ).toBeEnabled();
    });
  });

  describe('Form Submission', () => {
    it('should call onVerify with the formatted code when form is submitted', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      await user.click(screen.getByRole('button', { name: /verify code/i }));

      await waitFor(() => {
        expect(mockOnVerify).toHaveBeenCalledWith('ABCD-1234');
      });
    });

    it('should NOT call onVerify when code length is not 9', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABC');

      // Attempt form submit via keyboard Enter
      await user.keyboard('{Enter}');

      expect(mockOnVerify).not.toHaveBeenCalled();
    });

    it('should show "Verifying..." text while onVerify is in progress', async () => {
      const user = userEvent.setup({ delay: null });

      let resolveVerify!: () => void;
      mockOnVerify.mockReturnValue(
        new Promise<void>((res) => {
          resolveVerify = res;
        }),
      );

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      await user.click(screen.getByRole('button', { name: /verify code/i }));

      expect(screen.getByText(/verifying/i)).toBeInTheDocument();

      // Clean up
      resolveVerify();
    });

    it('should disable the Verify Code button while verifying', async () => {
      const user = userEvent.setup({ delay: null });

      let resolveVerify!: () => void;
      mockOnVerify.mockReturnValue(
        new Promise<void>((res) => {
          resolveVerify = res;
        }),
      );

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      const button = screen.getByRole('button', { name: /verify code/i });
      await user.click(button);

      expect(button).toBeDisabled();

      resolveVerify();
    });

    it('should re-enable the button after onVerify resolves', async () => {
      const user = userEvent.setup({ delay: null });

      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      const input = screen.getByLabelText(/device code/i);
      await user.type(input, 'ABCD1234');

      await user.click(screen.getByRole('button', { name: /verify code/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /verify code/i })).toBeEnabled();
      });
    });
  });

  describe('Error Display', () => {
    it('should display the error message when error prop is set', () => {
      render(
        <DeviceCodeInput
          onVerify={mockOnVerify}
          error="Invalid code. Please check and try again."
        />,
      );

      expect(
        screen.getByText(/invalid code\. please check and try again\./i),
      ).toBeInTheDocument();
    });

    it('should mark the text field as errored when error prop is set', () => {
      const { container } = render(
        <DeviceCodeInput onVerify={mockOnVerify} error="Something went wrong." />,
      );

      const inputWrapper = container.querySelector('.Mui-error');
      expect(inputWrapper).toBeInTheDocument();
    });

    it('should NOT display an error alert when error prop is null', () => {
      render(<DeviceCodeInput onVerify={mockOnVerify} error={null} />);

      expect(
        screen.queryByRole('alert'),
      ).not.toBeInTheDocument();
    });
  });
});
