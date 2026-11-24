/**
 * The run matrix at phone width (issue #65): one card per server with its status chip, then a
 * dot per step (an icon with its label for assistive tech), and a tap opens the log as a
 * full-screen sheet on the step that matters (the failed one, else the running one, else the last).
 * Cards are shown 50 at a time.
 */
import { useState } from 'react';
import { Box, Button, Card, CardActionArea, CardContent, Stack, Tooltip, Typography } from '@mui/material';
import type { RunTargetRow } from '../api/types';
import { statusMeta, toneColor } from '../lib/statusMeta';
import { StatusChip } from './StatusChip';

export const CARD_PAGE = 50;

/** The step a tap opens: the first failure, else what is running or waiting, else the last. */
export function focusStep(target: RunTargetRow): number {
  const failed = target.steps.find((s) => s.status === 'failed' || s.status === 'timed_out');
  if (failed) return failed.stepIndex;
  const active = target.steps.find((s) => s.status === 'running' || s.status === 'waiting_approval');
  if (active) return active.stepIndex;
  const started = [...target.steps].reverse().find((s) => s.status !== 'pending');
  return started?.stepIndex ?? 0;
}

export function RunCardList({ targets, onOpen }: { targets: readonly RunTargetRow[]; onOpen: (target: RunTargetRow, stepIndex: number) => void }) {
  const [shown, setShown] = useState(CARD_PAGE);
  return (
    <Stack spacing={1} component="ul" aria-label="Servers in this run" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {targets.slice(0, shown).map((target) => (
        <Card key={target.id} variant="outlined" component="li" data-testid="run-card">
          <CardActionArea onClick={() => onOpen(target, focusStep(target))} aria-label={`${target.serverName}: ${statusMeta(target.status).label}. Open log`}>
            <CardContent sx={{ py: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="subtitle2" component="span" noWrap sx={{ minWidth: 0 }}>
                  {target.serverName}
                </Typography>
                <StatusChip status={target.status} />
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }} role="list" aria-label="Steps">
                {target.steps.map((step) => {
                  const meta = statusMeta(step.status);
                  const { Icon } = meta;
                  return (
                    <Tooltip key={step.stepIndex} title={`${step.name}: ${meta.label}`}>
                      <Box role="listitem" aria-label={`${step.stepIndex + 1}. ${step.name}: ${meta.label}`} sx={{ display: 'inline-flex' }}>
                        <Icon fontSize="small" sx={{ color: toneColor(meta.tone) }} aria-hidden="true" />
                      </Box>
                    </Tooltip>
                  );
                })}
              </Box>
              {target.errorCode && (
                <Typography variant="caption" sx={{ color: 'error.main', display: 'block', mt: 0.5 }}>
                  {target.errorCode}
                </Typography>
              )}
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
      {targets.length > shown && (
        <Box component="li" sx={{ textAlign: 'center' }}>
          <Button onClick={() => setShown((n) => n + CARD_PAGE)}>Show {Math.min(CARD_PAGE, targets.length - shown)} more</Button>
        </Box>
      )}
    </Stack>
  );
}
