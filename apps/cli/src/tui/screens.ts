import type { TuiScreenRegistration } from '@marinoscar/platform-cli/tui';

// The screens ShellKeep adds to the TUI menu (issue #72), loaded lazily so a
// plain subcommand never imports Ink. `order` places them after the platform's
// own entries (see BUILTIN_TUI_SCREENS).

/** Servers: a list with a "test" action. */
export const serversScreen: TuiScreenRegistration = {
  route: 'servers',
  label: 'Servers',
  order: 70,
  load: async () => (await import('./servers.screen.js')).ServersScreen,
};

/** Sessions: a list with an "attach" action. */
export const sessionsScreen: TuiScreenRegistration = {
  route: 'sessions',
  label: 'Sessions',
  order: 71,
  load: async () => (await import('./sessions.screen.js')).SessionsScreen,
};

/** Runs: the latest runbook runs with live status (a polling `DashboardSource`). */
export const runsScreen: TuiScreenRegistration = {
  route: 'runs',
  label: 'Runs',
  order: 72,
  load: async () => (await import('./runs.screen.js')).RunsScreen,
};
