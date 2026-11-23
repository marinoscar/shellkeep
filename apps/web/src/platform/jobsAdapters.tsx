/**
 * What the packaged Jobs, Job Insights and Worker Nodes pages take from this
 * app (issue #49), handed in once through {@link JobsNodesProviders}:
 *
 *   - `Spinner`: the app's `LoadingSpinner`, so loading states look like the
 *     rest of the app.
 *   - `api`: the package's own jobs and nodes clients over the app's one HTTP
 *     client (`platformApi`, `services/api.ts`), so every call carries the
 *     bearer token, the refresh and the maintenance handling.
 *
 * The lists use the package's plain MUI table until the app adopts the
 * packaged `DataTable` with the shell (#76), like the identity pages.
 */

import type { ReactNode } from 'react';
import {
  JobsWebAdaptersProvider,
  createJobsApi,
} from '@marinoscar/platform-web/jobs/headless';
import type { JobsWebAdapters } from '@marinoscar/platform-web/jobs/headless';
import {
  NodesWebAdaptersProvider,
  createNodesApi,
} from '@marinoscar/platform-web/nodes/headless';
import type { NodesWebAdapters } from '@marinoscar/platform-web/nodes/headless';
import { LoadingSpinner } from '../components/common/LoadingSpinner';
import { platformApi } from '../services/api';

/** The adapters the jobs pages take. A module constant. */
export const appJobsAdapters: JobsWebAdapters = Object.freeze<JobsWebAdapters>({
  Spinner: LoadingSpinner,
  api: createJobsApi(platformApi),
});

/** The adapters the Worker Nodes page takes. A module constant. */
export const appNodesAdapters: NodesWebAdapters = Object.freeze<NodesWebAdapters>({
  Spinner: LoadingSpinner,
  api: createNodesApi(platformApi),
});

/**
 * Mounts both adapter providers. The nodes provider is OUTSIDE the jobs one:
 * the jobs provider bridges its own adapters to the Worker Nodes page, and an
 * outer nodes provider wins.
 */
export function JobsNodesProviders({ children }: { children: ReactNode }) {
  return (
    <NodesWebAdaptersProvider adapters={appNodesAdapters}>
      <JobsWebAdaptersProvider adapters={appJobsAdapters}>{children}</JobsWebAdaptersProvider>
    </NodesWebAdaptersProvider>
  );
}
