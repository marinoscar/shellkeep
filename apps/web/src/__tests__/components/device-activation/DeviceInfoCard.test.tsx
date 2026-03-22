import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { DeviceInfoCard } from '../../../components/device-activation/DeviceInfoCard';
import type { DeviceActivationInfo } from '../../../types';

function makeDeviceInfo(
  overrides: Partial<DeviceActivationInfo> = {},
): DeviceActivationInfo {
  return {
    userCode: 'ABCD-1234',
    clientInfo: {
      deviceName: 'Living Room TV',
      userAgent: 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36',
      ipAddress: '192.168.1.100',
    },
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), // 15 min from now
    ...overrides,
  };
}

describe('DeviceInfoCard', () => {
  let mockOnApprove: ReturnType<typeof vi.fn>;
  let mockOnDeny: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnApprove = vi.fn().mockResolvedValue(undefined);
    mockOnDeny = vi.fn().mockResolvedValue(undefined);
    vi.clearAllMocks();
    vi.useFakeTimers({ now: Date.now() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('Info Alert', () => {
    it('should render the introductory info alert', () => {
      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(
        screen.getByText(/a device is requesting access to your account/i),
      ).toBeInTheDocument();
    });
  });

  describe('Device Details', () => {
    it('should display the device name when provided', () => {
      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(screen.getByText('Living Room TV')).toBeInTheDocument();
    });

    it('should display the user agent when provided', () => {
      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(
        screen.getByText(/Mozilla\/5\.0.*Android.*WebKit/),
      ).toBeInTheDocument();
    });

    it('should display the IP address when provided', () => {
      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(screen.getByText('192.168.1.100')).toBeInTheDocument();
    });

    it('should omit device name section when deviceName is not provided', () => {
      const deviceInfo = makeDeviceInfo();
      deviceInfo.clientInfo.deviceName = undefined;

      render(
        <DeviceInfoCard
          deviceInfo={deviceInfo}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(
        screen.queryByText(/device name/i),
      ).not.toBeInTheDocument();
    });

    it('should omit user agent section when userAgent is not provided', () => {
      const deviceInfo = makeDeviceInfo();
      deviceInfo.clientInfo.userAgent = undefined;

      render(
        <DeviceInfoCard
          deviceInfo={deviceInfo}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(
        screen.queryByText(/browser \/ device/i),
      ).not.toBeInTheDocument();
    });

    it('should omit IP address section when ipAddress is not provided', () => {
      const deviceInfo = makeDeviceInfo();
      deviceInfo.clientInfo.ipAddress = undefined;

      render(
        <DeviceInfoCard
          deviceInfo={deviceInfo}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(
        screen.queryByText(/ip address/i),
      ).not.toBeInTheDocument();
    });
  });

  describe('Countdown Timer', () => {
    it('should display a time remaining chip', () => {
      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(screen.getByText(/time remaining/i)).toBeInTheDocument();
    });

    it('should show "Expired" when the expiration time has passed', () => {
      const expiredInfo = makeDeviceInfo({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      render(
        <DeviceInfoCard
          deviceInfo={expiredInfo}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(screen.getByText('Expired')).toBeInTheDocument();
    });

    it('should show "Expired" expired alert when timer runs out', async () => {
      const nearlyExpiredInfo = makeDeviceInfo({
        expiresAt: new Date(Date.now() + 1500).toISOString(), // expires in 1.5s
      });

      render(
        <DeviceInfoCard
          deviceInfo={nearlyExpiredInfo}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      await waitFor(() => {
        expect(screen.getByText('Expired')).toBeInTheDocument();
        expect(
          screen.getByText(/this code has expired/i),
        ).toBeInTheDocument();
      });
    });
  });

  describe('Action Buttons', () => {
    it('should render an Approve button', () => {
      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(
        screen.getByRole('button', { name: /approve/i }),
      ).toBeInTheDocument();
    });

    it('should render a Deny button', () => {
      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(
        screen.getByRole('button', { name: /deny/i }),
      ).toBeInTheDocument();
    });

    it('should call onApprove when Approve is clicked', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      await user.click(screen.getByRole('button', { name: /approve/i }));

      await waitFor(() => {
        expect(mockOnApprove).toHaveBeenCalledTimes(1);
      });
    });

    it('should call onDeny when Deny is clicked', async () => {
      const user = userEvent.setup({ delay: null });

      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      await user.click(screen.getByRole('button', { name: /deny/i }));

      await waitFor(() => {
        expect(mockOnDeny).toHaveBeenCalledTimes(1);
      });
    });

    it('should show "Approving..." text while onApprove is in progress', async () => {
      const user = userEvent.setup({ delay: null });

      let resolveApprove!: () => void;
      mockOnApprove.mockReturnValue(
        new Promise<void>((res) => {
          resolveApprove = res;
        }),
      );

      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      await user.click(screen.getByRole('button', { name: /approve/i }));

      expect(screen.getByText(/approving/i)).toBeInTheDocument();

      resolveApprove();
    });

    it('should show "Denying..." text while onDeny is in progress', async () => {
      const user = userEvent.setup({ delay: null });

      let resolveDeny!: () => void;
      mockOnDeny.mockReturnValue(
        new Promise<void>((res) => {
          resolveDeny = res;
        }),
      );

      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      await user.click(screen.getByRole('button', { name: /deny/i }));

      expect(screen.getByText(/denying/i)).toBeInTheDocument();

      resolveDeny();
    });

    it('should disable both buttons while approving', async () => {
      const user = userEvent.setup({ delay: null });

      let resolveApprove!: () => void;
      mockOnApprove.mockReturnValue(
        new Promise<void>((res) => {
          resolveApprove = res;
        }),
      );

      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      await user.click(screen.getByRole('button', { name: /approve/i }));

      expect(screen.getByRole('button', { name: /approving/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /deny/i })).toBeDisabled();

      resolveApprove();
    });

    it('should disable both buttons while denying', async () => {
      const user = userEvent.setup({ delay: null });

      let resolveDeny!: () => void;
      mockOnDeny.mockReturnValue(
        new Promise<void>((res) => {
          resolveDeny = res;
        }),
      );

      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      await user.click(screen.getByRole('button', { name: /deny/i }));

      expect(screen.getByRole('button', { name: /denying/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();

      resolveDeny();
    });

    it('should disable both buttons when the code is expired', () => {
      const expiredInfo = makeDeviceInfo({
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });

      render(
        <DeviceInfoCard
          deviceInfo={expiredInfo}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /deny/i })).toBeDisabled();
    });
  });

  describe('Error Display', () => {
    it('should display an error alert when error prop is set', () => {
      render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error="Failed to authorize device."
        />,
      );

      expect(
        screen.getByText('Failed to authorize device.'),
      ).toBeInTheDocument();
    });

    it('should NOT display an error alert when error prop is null', () => {
      const { container } = render(
        <DeviceInfoCard
          deviceInfo={makeDeviceInfo()}
          onApprove={mockOnApprove}
          onDeny={mockOnDeny}
          error={null}
        />,
      );

      // Only the info alert should be present (not an error one)
      const errorAlerts = container.querySelectorAll('.MuiAlert-colorError');
      expect(errorAlerts.length).toBe(0);
    });
  });
});
