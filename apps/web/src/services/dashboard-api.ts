import { api } from './api';
import type { DashboardSummary } from '../types/dashboard';

/** The Home page's one read (#78): counts plus the five most recent rows, over what the caller may see. */
export async function getDashboardSummary(): Promise<DashboardSummary> {
  return api.get<DashboardSummary>('/dashboard/summary');
}
