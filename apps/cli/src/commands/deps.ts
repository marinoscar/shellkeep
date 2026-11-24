import type { ApiClient } from '@marinoscar/platform-cli/api-client';

import { createApiClient } from '../credentials.js';

import type { Writer } from './output.js';

/** What a command reaches outside itself for; tests substitute all three. */
export interface CommandDeps {
  /** The API client for the stored login (throws `AuthRequiredError` when not logged in). */
  client(): ApiClient;
  stdout: Writer;
  stderr: Writer;
}

/** The real thing: the stored login and the process's streams. */
export function defaultDeps(): CommandDeps {
  return {
    client: () => createApiClient(),
    stdout: process.stdout,
    stderr: process.stderr,
  };
}

/** The paginated list shape of the API (`{ items, total, page, pageSize, totalPages }`). */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** The largest page the list routes accept. */
export const MAX_PAGE_SIZE = 100;

/**
 * Reads every page of a list route.
 *
 * @param client - the API client.
 * @param path - the list route, relative to `/api`.
 * @param query - the route's own filters.
 */
export async function fetchAllPages<T>(
  client: ApiClient,
  path: string,
  query: Record<string, string | undefined> = {},
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  for (;;) {
    const result = await client.get<Page<T>>(path, { query: { ...query, page, pageSize: MAX_PAGE_SIZE } });
    all.push(...result.items);
    if (page >= result.totalPages || result.items.length === 0) return all;
    page += 1;
  }
}
