import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../../mocks/server';
import { render } from '../../utils/test-utils';
import { ImageUpload } from '../../../components/settings/ImageUpload';

// Mock the api service so we can control getAccessToken
vi.mock('../../../services/api', () => ({
  api: {
    getAccessToken: vi.fn().mockReturnValue('mock-token'),
  },
}));

const API_BASE = '*/api';

function makeFile(
  name = 'photo.jpg',
  type = 'image/jpeg',
  size = 1024,
): File {
  const content = new Array(size).fill('a').join('');
  return new File([content], name, { type });
}

describe('ImageUpload', () => {
  let mockOnUpload: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnUpload = vi.fn();
    vi.clearAllMocks();
    server.resetHandlers();

    // Default successful upload handler
    server.use(
      http.post(`${API_BASE}/users/profile-image`, () =>
        HttpResponse.json({ url: 'https://example.com/uploaded.jpg' }),
      ),
    );
  });

  describe('Rendering', () => {
    it('should render the Upload Custom Image button', () => {
      render(<ImageUpload onUpload={mockOnUpload} />);

      expect(
        screen.getByRole('button', { name: /upload custom image/i }),
      ).toBeInTheDocument();
    });

    it('should render a hidden file input', () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input).toBeInTheDocument();
      expect(input.style.display).toBe('none');
    });

    it('should accept only image MIME types on the file input', () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.accept).toContain('image/jpeg');
      expect(input.accept).toContain('image/png');
      expect(input.accept).toContain('image/gif');
      expect(input.accept).toContain('image/webp');
    });

    it('should render button as enabled by default', () => {
      render(<ImageUpload onUpload={mockOnUpload} />);

      expect(
        screen.getByRole('button', { name: /upload custom image/i }),
      ).toBeEnabled();
    });

    it('should not show an error message initially', () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      // No error caption should be present
      const caption = container.querySelector('.MuiTypography-caption');
      expect(caption).not.toBeInTheDocument();
    });
  });

  describe('Disabled State', () => {
    it('should disable the button when disabled prop is true', () => {
      render(<ImageUpload onUpload={mockOnUpload} disabled />);

      expect(
        screen.getByRole('button', { name: /upload custom image/i }),
      ).toBeDisabled();
    });

    it('should disable the file input when disabled prop is true', () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} disabled />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });
  });

  describe('File Type Validation', () => {
    it('should show an error for non-image file types', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const pdfFile = makeFile('document.pdf', 'application/pdf');

      // Use applyAccept: false to bypass the accept attribute filter
      await userEvent.upload(input, pdfFile, { applyAccept: false });

      expect(
        screen.getByText(/please select a valid image file/i),
      ).toBeInTheDocument();
      expect(mockOnUpload).not.toHaveBeenCalled();
    });

    it('should show an error for text files', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const textFile = makeFile('script.sh', 'text/plain');

      await userEvent.upload(input, textFile, { applyAccept: false });

      expect(
        screen.getByText(/please select a valid image file/i),
      ).toBeInTheDocument();
    });

    it('should accept image/jpeg files', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const jpegFile = makeFile('photo.jpg', 'image/jpeg');

      await userEvent.upload(input, jpegFile);

      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalled();
      });
    });

    it('should accept image/png files', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const pngFile = makeFile('image.png', 'image/png');

      await userEvent.upload(input, pngFile);

      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalled();
      });
    });

    it('should accept image/gif files', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const gifFile = makeFile('anim.gif', 'image/gif');

      await userEvent.upload(input, gifFile);

      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalled();
      });
    });

    it('should accept image/webp files', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const webpFile = makeFile('photo.webp', 'image/webp');

      await userEvent.upload(input, webpFile);

      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalled();
      });
    });
  });

  describe('File Size Validation', () => {
    it('should show an error when file exceeds 5MB', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      // Create a file larger than 5MB (5 * 1024 * 1024 = 5242880 bytes)
      const oversizedFile = makeFile('huge.jpg', 'image/jpeg', 5 * 1024 * 1024 + 1);

      await userEvent.upload(input, oversizedFile);

      expect(
        screen.getByText(/file size must be less than 5mb/i),
      ).toBeInTheDocument();
      expect(mockOnUpload).not.toHaveBeenCalled();
    });

    it('should accept a file exactly at the 5MB boundary', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const exactFile = makeFile('exact.jpg', 'image/jpeg', 5 * 1024 * 1024);

      await userEvent.upload(input, exactFile);

      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalled();
      });
    });
  });

  describe('Upload Trigger', () => {
    it('should POST to /api/users/profile-image with the file', async () => {
      let capturedRequest: Request | null = null;

      server.use(
        http.post(`${API_BASE}/users/profile-image`, ({ request }) => {
          capturedRequest = request;
          return HttpResponse.json({ url: 'https://example.com/uploaded.jpg' });
        }),
      );

      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(capturedRequest).not.toBeNull();
        expect(capturedRequest!.method).toBe('POST');
      });
    });

    it('should include the Authorization header with the Bearer token', async () => {
      let capturedHeaders: Record<string, string> = {};

      server.use(
        http.post(`${API_BASE}/users/profile-image`, ({ request }) => {
          capturedHeaders = Object.fromEntries(request.headers.entries());
          return HttpResponse.json({ url: 'https://example.com/uploaded.jpg' });
        }),
      );

      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(capturedHeaders['authorization']).toBe('Bearer mock-token');
      });
    });

    it('should call onUpload with the returned URL on success', async () => {
      server.use(
        http.post(`${API_BASE}/users/profile-image`, () =>
          HttpResponse.json({ url: 'https://cdn.example.com/avatar.jpg' }),
        ),
      );

      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(mockOnUpload).toHaveBeenCalledWith('https://cdn.example.com/avatar.jpg');
      });
    });

    it('should show "Uploading..." text while upload is in progress', async () => {
      let resolveUpload!: () => void;
      server.use(
        http.post(`${API_BASE}/users/profile-image`, async () => {
          await new Promise<void>((resolve) => {
            resolveUpload = resolve;
          });
          return HttpResponse.json({ url: 'https://example.com/done.jpg' });
        }),
      );

      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      expect(screen.getByText(/uploading/i)).toBeInTheDocument();

      // Clean up
      resolveUpload();
    });

    it('should disable the button while uploading', async () => {
      let resolveUpload!: () => void;
      server.use(
        http.post(`${API_BASE}/users/profile-image`, async () => {
          await new Promise<void>((resolve) => {
            resolveUpload = resolve;
          });
          return HttpResponse.json({ url: 'https://example.com/done.jpg' });
        }),
      );

      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      expect(
        screen.getByRole('button', { name: /uploading/i }),
      ).toBeDisabled();

      resolveUpload();
    });

    it('should re-enable the button after upload completes', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /upload custom image/i }),
        ).toBeEnabled();
      });
    });
  });

  describe('Upload Error Handling', () => {
    it('should show an error message when the upload response is not ok', async () => {
      server.use(
        http.post(`${API_BASE}/users/profile-image`, () =>
          new HttpResponse(null, { status: 500 }),
        ),
      );

      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(screen.getByText(/upload failed/i)).toBeInTheDocument();
      });
      expect(mockOnUpload).not.toHaveBeenCalled();
    });

    it('should show an error message when fetch throws a network error', async () => {
      server.use(
        http.post(`${API_BASE}/users/profile-image`, () => HttpResponse.error()),
      );

      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      await waitFor(() => {
        // Network errors show "Failed to fetch" or similar generic message
        const errorEl = screen.queryByText(/failed to upload image/i) ||
                        screen.queryByText(/failed to fetch/i) ||
                        screen.queryByText(/network/i);
        expect(errorEl).toBeInTheDocument();
      });
      expect(mockOnUpload).not.toHaveBeenCalled();
    });

    it('should show a generic error for non-Error exceptions', async () => {
      server.use(
        http.post(`${API_BASE}/users/profile-image`, () => HttpResponse.error()),
      );

      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      await waitFor(() => {
        // Some error text should be visible
        const errorEl = container.querySelector('.MuiTypography-caption');
        expect(errorEl).toBeInTheDocument();
      });
    });

    it('should clear the file input value after upload attempt', async () => {
      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file);

      await waitFor(() => {
        expect(input.value).toBe('');
      });
    });

    it('should clear a previous error when a new valid file is selected successfully', async () => {
      // First upload fails (500 error)
      server.use(
        http.post(`${API_BASE}/users/profile-image`, () =>
          new HttpResponse(null, { status: 500 }),
        ),
      );

      const { container } = render(<ImageUpload onUpload={mockOnUpload} />);

      const input = container.querySelector('input[type="file"]') as HTMLInputElement;
      const file1 = makeFile('avatar.jpg', 'image/jpeg');

      await userEvent.upload(input, file1);

      await waitFor(() => {
        expect(screen.getByText(/upload failed/i)).toBeInTheDocument();
      });

      // Second upload succeeds
      server.use(
        http.post(`${API_BASE}/users/profile-image`, () =>
          HttpResponse.json({ url: 'https://example.com/ok.jpg' }),
        ),
      );

      const file2 = makeFile('new.jpg', 'image/jpeg');
      await userEvent.upload(input, file2);

      await waitFor(() => {
        expect(screen.queryByText(/upload failed/i)).not.toBeInTheDocument();
        expect(mockOnUpload).toHaveBeenCalledWith('https://example.com/ok.jpg');
      });
    });
  });
});
