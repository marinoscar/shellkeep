// The SSH slice's app metrics (issue #60). Label `outcome` only; never a host.

import type { AppMetricDef } from '@marinoscar/platform-api/otel-core';

export const SSH_HOST_KEY_CHECKS_METRIC = 'sshHostKeyChecks';

export const SSH_APP_METRICS: readonly AppMetricDef[] = [
  {
    key: SSH_HOST_KEY_CHECKS_METRIC,
    name: 'app.ssh.host_key_checks',
    kind: 'counter',
    unit: '{check}',
    description: 'SSH host-key verifications by outcome (match, unknown, mismatch, auto_trusted).',
    attributes: { outcome: { kind: 'enum', values: ['match', 'unknown', 'mismatch', 'auto_trusted'] } },
  },
];
