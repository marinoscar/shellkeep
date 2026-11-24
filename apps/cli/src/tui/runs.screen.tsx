import { type TuiScreenProps, textColor, useDashboard, useTuiTheme } from '@marinoscar/platform-cli/tui';
import { Box, Text, useInput } from 'ink';
import { type ComponentType, type ReactNode, useEffect, useState } from 'react';

import { type RunRow, renderRunMatrix, summarizeRun } from '../commands/runbook-model.js';

import { type RunsScreenSource, defaultRunsSource } from './runs.feed.js';

// =============================================================================
// The Runs screen  (issue #72)
// =============================================================================
//
// The latest runbook runs with live status, from a `DashboardSource` polling
// GET /api/runbook-runs (runs.feed.ts). Up/down move; enter opens the selected
// run's servers x steps matrix (re-read every few seconds while it is open); `r`
// refreshes the list now; esc closes the matrix, then leaves for the menu.
// =============================================================================

const DETAIL_REFRESH_MS = 3000;

function when(value: string | null): string {
  return value === null ? '-' : value.replace('T', ' ').slice(0, 19);
}

/** Builds the screen over a data source. */
export function createRunsScreen(source: () => RunsScreenSource = defaultRunsSource): ComponentType<TuiScreenProps> {
  return function RunsScreen({ onDone }: TuiScreenProps): ReactNode {
    const [data] = useState<RunsScreenSource>(() => source());
    const theme = useTuiTheme();
    const state = useDashboard(data.dashboard);
    const [cursor, setCursor] = useState(0);
    const [openId, setOpenId] = useState<string | undefined>(undefined);
    const [detail, setDetail] = useState<RunRow | undefined>(undefined);
    const [detailError, setDetailError] = useState<string | undefined>(undefined);

    useEffect(() => {
      if (openId === undefined) return undefined;
      let live = true;
      const load = (): void => {
        data.detail(openId).then(
          (run) => live && (setDetail(run), setDetailError(undefined)),
          (failure: unknown) => live && setDetailError(failure instanceof Error ? failure.message : String(failure)),
        );
      };
      load();
      const timer = setInterval(load, DETAIL_REFRESH_MS);
      return () => {
        live = false;
        clearInterval(timer);
      };
    }, [data, openId]);

    const runs = state?.runs ?? [];

    useInput((input, key) => {
      if (key.escape || input === 'q') {
        if (openId !== undefined) {
          setOpenId(undefined);
          setDetail(undefined);
          return;
        }
        onDone();
        return;
      }
      if (openId !== undefined) return;
      if (input === 'r') data.dashboard.refresh();
      if (runs.length === 0) return;
      if (key.upArrow) setCursor((current) => Math.max(0, current - 1));
      if (key.downArrow) setCursor((current) => Math.min(runs.length - 1, current + 1));
      if (key.return) {
        const run = runs[cursor];
        if (run !== undefined) setOpenId(run.id);
      }
    });

    if (openId !== undefined) {
      return (
        <Box flexDirection="column">
          {detail === undefined && detailError === undefined ? <Text dimColor>Loading run...</Text> : null}
          {detailError !== undefined ? <Text {...textColor(theme.error)}>{detailError}</Text> : null}
          {detail !== undefined ? (
            <>
              <Text bold>{summarizeRun(detail)}</Text>
              <Text>{renderRunMatrix(detail)}</Text>
            </>
          ) : null}
          <Text dimColor>esc back to the list</Text>
        </Box>
      );
    }
    if (state === undefined || state.runs === undefined) {
      return (
        <Box flexDirection="column">
          {state?.forbidden !== undefined ? <Text {...textColor(theme.error)}>{state.forbidden}</Text> : null}
          {state?.error !== undefined ? <Text {...textColor(theme.error)}>{state.error}</Text> : <Text dimColor>Loading runs...</Text>}
          <Text dimColor>esc back</Text>
        </Box>
      );
    }
    if (runs.length === 0) {
      return (
        <Box flexDirection="column">
          <Text>No runs yet.</Text>
          <Text dimColor>esc back</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Text bold>Runs</Text>
        {runs.map((run, index) => (
          <Text key={run.id} inverse={index === cursor}>
            {index === cursor ? '> ' : '  '}
            {run.runbook}  {run.status}  {when(run.createdAt)}
          </Text>
        ))}
        {state.error !== undefined ? <Text {...textColor(theme.warning)}>Not reachable: {state.error}</Text> : null}
        <Text dimColor>up/down select  enter open  r refresh  esc back</Text>
      </Box>
    );
  };
}

/** The screen the TUI menu loads. */
export const RunsScreen = createRunsScreen();
