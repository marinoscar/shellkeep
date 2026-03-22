import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../utils/test-utils';
import { ActivationSuccess } from '../../../components/device-activation/ActivationSuccess';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

describe('ActivationSuccess', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Success State', () => {
    it('should render the "Device Authorized!" heading', () => {
      render(<ActivationSuccess success message="Device has been authorized." />);

      expect(
        screen.getByRole('heading', { name: /device authorized!/i }),
      ).toBeInTheDocument();
    });

    it('should render the provided success message in an alert', () => {
      render(
        <ActivationSuccess
          success
          message="Your Smart TV has been connected."
        />,
      );

      expect(
        screen.getByText('Your Smart TV has been connected.'),
      ).toBeInTheDocument();
    });

    it('should render a success-severity Alert when success is true', () => {
      const { container } = render(
        <ActivationSuccess success message="All good." />,
      );

      // MUI Alert with severity=success has class MuiAlert-colorSuccess
      const alert = container.querySelector('.MuiAlert-colorSuccess');
      expect(alert).toBeInTheDocument();
    });

    it('should display instructions to close the page and return to device', () => {
      render(<ActivationSuccess success message="Done." />);

      expect(
        screen.getByText(/close this page and return to your device/i),
      ).toBeInTheDocument();
    });

    it('should render "Go to Home" button', () => {
      render(<ActivationSuccess success message="Done." />);

      expect(
        screen.getByRole('button', { name: /go to home/i }),
      ).toBeInTheDocument();
    });

    it('should NOT render "Try Another Code" button when success is true', () => {
      render(<ActivationSuccess success message="Done." />);

      expect(
        screen.queryByRole('button', { name: /try another code/i }),
      ).not.toBeInTheDocument();
    });
  });

  describe('Failure State', () => {
    it('should render the "Device Access Denied" heading', () => {
      render(<ActivationSuccess success={false} message="Access was denied." />);

      expect(
        screen.getByRole('heading', { name: /device access denied/i }),
      ).toBeInTheDocument();
    });

    it('should render the provided denial message', () => {
      render(
        <ActivationSuccess success={false} message="The request has been denied." />,
      );

      expect(
        screen.getByText('The request has been denied.'),
      ).toBeInTheDocument();
    });

    it('should render an info-severity Alert when success is false', () => {
      const { container } = render(
        <ActivationSuccess success={false} message="Denied." />,
      );

      const alert = container.querySelector('.MuiAlert-colorInfo');
      expect(alert).toBeInTheDocument();
    });

    it('should NOT display "close this page" instructions when success is false', () => {
      render(<ActivationSuccess success={false} message="Denied." />);

      expect(
        screen.queryByText(/close this page and return to your device/i),
      ).not.toBeInTheDocument();
    });

    it('should render "Try Another Code" button when success is false', () => {
      render(<ActivationSuccess success={false} message="Denied." />);

      expect(
        screen.getByRole('button', { name: /try another code/i }),
      ).toBeInTheDocument();
    });

    it('should render "Go to Home" button when success is false', () => {
      render(<ActivationSuccess success={false} message="Denied." />);

      expect(
        screen.getByRole('button', { name: /go to home/i }),
      ).toBeInTheDocument();
    });
  });

  describe('Navigation', () => {
    it('should navigate to / when "Go to Home" is clicked after success', async () => {
      const user = userEvent.setup({ delay: null });

      render(<ActivationSuccess success message="Done." />);

      await user.click(screen.getByRole('button', { name: /go to home/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('should navigate to / when "Go to Home" is clicked after failure', async () => {
      const user = userEvent.setup({ delay: null });

      render(<ActivationSuccess success={false} message="Denied." />);

      await user.click(screen.getByRole('button', { name: /go to home/i }));

      expect(mockNavigate).toHaveBeenCalledWith('/');
    });

    it('should reload the page when "Try Another Code" is clicked', async () => {
      const user = userEvent.setup({ delay: null });
      const reloadSpy = vi.fn();
      Object.defineProperty(window, 'location', {
        value: { reload: reloadSpy },
        writable: true,
      });

      render(<ActivationSuccess success={false} message="Denied." />);

      await user.click(screen.getByRole('button', { name: /try another code/i }));

      expect(reloadSpy).toHaveBeenCalled();
    });
  });

  describe('Icon Rendering', () => {
    it('should render a CheckCircle icon when success is true', () => {
      const { container } = render(
        <ActivationSuccess success message="Done." />,
      );

      // MUI icon is an SVG
      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });

    it('should render a Cancel icon when success is false', () => {
      const { container } = render(
        <ActivationSuccess success={false} message="Denied." />,
      );

      const svg = container.querySelector('svg');
      expect(svg).toBeInTheDocument();
    });
  });
});
