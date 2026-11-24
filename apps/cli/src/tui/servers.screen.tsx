import { type TuiScreenProps, textColor, useTuiTheme } from '@marinoscar/platform-cli/tui';
import { Box, Text, useInput } from 'ink';
import { type ComponentType, type ReactNode, useEffect, useState } from 'react';

import { defaultDeps } from '../commands/deps.js';
import { type ServerRow, listServers } from '../commands/servers-list.js';
import { type ServerTestReport, testServer } from '../commands/servers-test.js';

// =============================================================================
// The Servers screen  (issue #72)
// =============================================================================
//
// A list of the caller's server profiles with a "test" action: up/down move,
// `t` tests the selected profile (the same call as `servers test`), esc or q
// returns to the menu. The data comes through two seams so a test can drive the
// screen without a server.
// =============================================================================

/** Where the screen gets its data. */
export interface ServersScreenSource {
  list(): Promise<ServerRow[]>;
  test(id: string): Promise<ServerTestReport>;
}

/** The real source: the stored login. */
export function defaultServersSource(): ServersScreenSource {
  return {
    list: () => listServers(defaultDeps(), undefined),
    test: (id) => testServer(defaultDeps(), id),
  };
}

function describeReport(report: ServerTestReport): string {
  const head = `${report.success ? 'OK' : 'FAILED'} in ${report.latencyMs} ms, host key ${report.hostKey.status}`;
  return report.error !== null ? `${head}: ${report.error}` : head;
}

/** Builds the screen over a data source. */
export function createServersScreen(source: () => ServersScreenSource = defaultServersSource): ComponentType<TuiScreenProps> {
  return function ServersScreen({ onDone }: TuiScreenProps): ReactNode {
    const [data] = useState<ServersScreenSource>(() => source());
    const theme = useTuiTheme();
    const [rows, setRows] = useState<ServerRow[] | undefined>(undefined);
    const [error, setError] = useState<string | undefined>(undefined);
    const [cursor, setCursor] = useState(0);
    const [results, setResults] = useState<Record<string, string>>({});

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
      if (input === 't') {
        const row = rows[cursor];
        if (row === undefined) return;
        setResults((current) => ({ ...current, [row.id]: 'testing...' }));
        data.test(row.id).then(
          (report) => setResults((current) => ({ ...current, [row.id]: describeReport(report) })),
          (failure: unknown) =>
            setResults((current) => ({ ...current, [row.id]: `FAILED: ${failure instanceof Error ? failure.message : String(failure)}` })),
        );
      }
    });

    if (error !== undefined) {
      return (
        <Box flexDirection="column">
          <Text {...textColor(theme.error)}>{error}</Text>
          <Text dimColor>esc back</Text>
        </Box>
      );
    }
    if (rows === undefined) return <Text dimColor>Loading servers...</Text>;
    if (rows.length === 0) {
      return (
        <Box flexDirection="column">
          <Text>No server profiles.</Text>
          <Text dimColor>esc back</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column">
        <Text bold>Servers</Text>
        {rows.map((row, index) => (
          <Box key={row.id} flexDirection="column">
            <Text inverse={index === cursor}>
              {index === cursor ? '> ' : '  '}
              {row.name}  {row.username}@{row.hostname}:{row.port}  {row.hostKeyTrusted ? 'trusted' : 'not trusted'}
            </Text>
            {results[row.id] !== undefined ? <Text dimColor>    {results[row.id]}</Text> : null}
          </Box>
        ))}
        <Text dimColor>up/down select  t test  esc back</Text>
      </Box>
    );
  };
}

/** The screen the TUI menu loads. */
export const ServersScreen = createServersScreen();
