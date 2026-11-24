import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OnboardingBlock, OnboardingResponse, OnboardingStep } from '@marinoscar/platform-web/onboarding/headless';
import { render } from '../../utils/test-utils';

const dismissAdmin = vi.fn(async () => undefined);
const dismissChecklist = vi.fn(async () => undefined);
let current: { state: OnboardingResponse | null; isLoading: boolean } = { state: null, isLoading: false };

vi.mock('@marinoscar/platform-web/onboarding/headless', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useOnboarding: () => ({ ...current, dismissAdmin, dismissChecklist }),
}));

import {
  OnboardingBanner,
  chooseBannerAudience,
  requiredProgress,
} from '../../../components/onboarding/OnboardingBanner';

const step = (id: string, tier: OnboardingStep['tier'], status: OnboardingStep['status']): OnboardingStep => ({
  id,
  audience: id.startsWith('admin.') ? 'admin' : 'user',
  tier,
  status,
  title: id,
  description: '',
  actionLabel: 'Go',
  href: '/',
  detail: null,
  blockedReason: null,
  skippable: tier !== 'required',
  skipped: false,
});

const block = (steps: OnboardingStep[]): OnboardingBlock => ({
  steps,
  completed: steps.filter((s) => s.status === 'done').length,
  total: steps.length,
  requiredDone: steps.every((s) => s.tier !== 'required' || s.status === 'done'),
  allResolved: false,
});

const userBlock = block([
  step('shellkeep.add-server', 'required', 'done'),
  step('shellkeep.trust-host-key', 'required', 'todo'),
  step('shellkeep.open-session', 'required', 'todo'),
  step('shellkeep.first-runbook', 'recommended', 'todo'),
]);

const response = (overrides: Partial<OnboardingResponse> = {}): OnboardingResponse => ({
  settings: { welcomeSeenAt: null, checklistDismissedAt: null, adminDismissedAt: null, skipped: [] },
  user: userBlock,
  admin: null,
  ...overrides,
});

describe('OnboardingBanner helpers', () => {
  it('counts only the required steps', () => {
    expect(requiredProgress(userBlock)).toMatchObject({ total: 3, remaining: 2 });
  });

  it("is about the deployment first, then the account, and silent when nothing required is open", () => {
    const admin = block([step('admin.storage', 'required', 'todo')]);
    expect(chooseBannerAudience(response({ admin }))).toBe('admin');
    expect(chooseBannerAudience(response({ admin, settings: { ...response().settings, adminDismissedAt: '2026-01-01T00:00:00.000Z' } }))).toBe('user');
    expect(chooseBannerAudience(response({ user: block([step('shellkeep.add-server', 'required', 'done')]) }))).toBeNull();
    expect(chooseBannerAudience(response({ settings: { ...response().settings, checklistDismissedAt: '2026-01-01T00:00:00.000Z' } }))).toBeNull();
    expect(chooseBannerAudience(null)).toBeNull();
  });
});

describe('OnboardingBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    current = { state: response(), isLoading: false };
  });

  it("states the account's remaining required steps and links to Getting started", () => {
    render(<OnboardingBanner />, { wrapperOptions: { route: '/' } });
    expect(screen.getByRole('heading', { name: '2 of 3 required steps left to finish setting up your account' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Continue' })).toHaveAttribute('href', '/settings/getting-started');
  });

  it('renders nothing while loading and on the checklist page itself', () => {
    current = { state: response(), isLoading: true };
    const { container, unmount } = render(<OnboardingBanner />, { wrapperOptions: { route: '/' } });
    expect(container).toBeEmptyDOMElement();
    unmount();
    current = { state: response(), isLoading: false };
    const second = render(<OnboardingBanner />, { wrapperOptions: { route: '/settings/getting-started' } });
    expect(second.container).toBeEmptyDOMElement();
  });

  it('dismisses the checklist it is about', async () => {
    const user = userEvent.setup();
    render(<OnboardingBanner />, { wrapperOptions: { route: '/' } });
    await user.click(screen.getByRole('button', { name: 'Dismiss the getting started checklist' }));
    expect(dismissChecklist).toHaveBeenCalledTimes(1);
    expect(dismissAdmin).not.toHaveBeenCalled();
  });
});
