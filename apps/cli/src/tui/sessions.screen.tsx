import type { TuiScreenProps } from '@marinoscar/platform-cli/tui';
import { Box, Text, useApp, useInput } from 'ink';
import { type ComponentType, type ReactNode, useEffect, useState } from 'react';

import { defaultDeps } from '../commands/deps.js';
import { type SessionRow, listSessions } from '../commands/sessions-list.js';

import { requestAttach } from './pending-attach.js';

// =============================================================================
// The Sessions screen  (issue #72)
// =============================================================================
//
// A list of the caller's sessions with an "attach" action: up/down move, enter
// or `a` attaches to the selected one, esc or q returns to the menu. Ink cannot
// share the terminal with the raw-mode bridge, so "attach" records the session
// (pending-attach.ts) and ends the menu; `runApp` then runs the bridge in the
// released terminal. A terminated session cannot be attached and is refused here.
// =============================================================================

/** Where the screen gets its data. */
export interface SessionsScreenSource {
  list(): Promise<SessionRow[]>;
}

/** The real source: the stored login. */
export function defaultSessionsSource(): SessionsScreenSource {
  return { list: () => listSessions(defaultDeps(), undefined) };
}

/** Builds the screen over a data source and an attach hand-off. */
export function createSessionsScreen(
  source: () => SessionsScreenSource = defaultSessionsSource,
  attach: (sessionId: string) => void = requestAttach,
): ComponentType<TuiScreenProps> {
  return function SessionsScreen({ onDone }: TuiScreenProps): ReactNode {
    const { exit } = useApp();
    const [data] = useState<SessionsScreenSource>(() => source());
    const [rows, setRows] = useState<SessionRow[] | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [cursor, setCursor] = useState(0);
    const [notice, setNotice] = useState<string | undefined>(undefined);

    useEffect(() => {
      let live = true;
      data.list().then(
        (loaded) => live && setRows(loaded),
        (failure: unknown) => live && setError(failure instanceof Error ? failure.message : String(failure)),
      );
      return () => {
        live = false;
      };
    }, [data]);

    useInput((input, key) => {
      if (key.escape || input === 'q') {
        onDone();
        return;
      }
      if (rows === undefined || rows.length === 0) return;
      if (key.upArrow) setCursor((current) => Math.max(0, current - 1));
      if (key.downArrow) setCursor((current) => Math.min(rows.length - 1, current + 1));
      if (key.return || input === 'a') {
        const row = rows[cursor];
        if (row === undefined) return;
        if (row.status === 'terminated') {
          setNotice('That session is terminated.');
          return;
        }
        attach(row.id);
        exit();
      }
    });

    if (error !== undefined) {
      return (
        <Box flexDirection="column">
          <Text color="red">{error}</Text>
          <Text dimColor>esc back</Text>
        </Box>
      );
    }
    if (rows === undefined) return <Text dimColor>Loading sessions...</Text>;
    if (rows.length === 0) {
      return (
        <Box flexDirection="column">
          <Text>No sessions.</Text>
          <Text dimColor>esc back</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column">
        <Text bold>Sessions</Text>
        {rows.map((row, index) => (
          <Text key={row.id} inverse={index === cursor}>
            {index === cursor ? '> ' : '  '}
            {row.name}  {row.status}  {row.server?.name ?? row.serverProfileId}
          </Text>
        ))}
        {notice !== undefined ? <Text color="yellow">{notice}</Text> : null}
        <Text dimColor>up/down select  enter attach (Ctrl-] d detaches)  esc back</Text>
      </Box>
    );
  };
}

/** The screen the TUI menu loads. */
export const SessionsScreen = createSessionsScreen();
