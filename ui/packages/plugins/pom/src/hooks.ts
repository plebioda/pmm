/**
 * Copyright (C) 2026 Percona LLC
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { apiClient } from '@sep/api';
import type {
  PomClusterDetailResponse,
  PomClusterFilters,
  PomClusterListResponse,
  PomRun,
  PomRunAccepted,
} from './types';

const POM_BASE = '/apps/pom_api';

/** Rows fetched for the run history. The API caps `limit` at 100. */
export const POM_RUNS_LIMIT = 25;

/** Poll interval while a discovery run is in flight (ms). */
const RUN_POLL_MS = 3000;

const clustersKey = ['pom', 'clusters'] as const;
const runsKey = ['pom', 'runs'] as const;

/** True while a run has not reached a terminal status. */
export function isRunActive(status: string | undefined): boolean {
  return status === 'running';
}

/**
 * List clusters from the latest terminal snapshot.
 *
 * Filters narrow `clusters` but never `summary` — that asymmetry is deliberate
 * server-side, so the header can say "2 of 4" without a second request. Keeping
 * the previous page in place stops the table collapsing to a spinner whenever a
 * filter changes.
 */
export function usePomClusters(filters: PomClusterFilters = {}) {
  return useQuery<PomClusterListResponse>({
    queryKey: [...clustersKey, filters],
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get<PomClusterListResponse>(
        `${POM_BASE}/clusters`,
        { params: filters }
      );
      return data;
    },
  });
}

/** One cluster's full document, members included. */
export function usePomCluster(clusterId: string | undefined) {
  return useQuery<PomClusterDetailResponse>({
    queryKey: ['pom', 'clusters', clusterId],
    enabled: Boolean(clusterId),
    queryFn: async () => {
      const { data } = await apiClient.get<PomClusterDetailResponse>(
        `${POM_BASE}/clusters/${clusterId}`
      );
      return data;
    },
  });
}

/**
 * Run history, newest first.
 *
 * Polls while the newest run is still going, which is also what makes the
 * clusters list refresh after a triggered run lands.
 */
export function usePomRuns(limit: number = POM_RUNS_LIMIT) {
  return useQuery<PomRun[]>({
    queryKey: [...runsKey, limit],
    queryFn: async () => {
      const { data } = await apiClient.get<PomRun[]>(
        `${POM_BASE}/discovery/runs`,
        { params: { limit } }
      );
      return data;
    },
    refetchInterval: (query) =>
      isRunActive(query.state.data?.[0]?.status) ? RUN_POLL_MS : false,
  });
}

/** One run, with its per-service errors. */
export function usePomRun(runId: string | undefined) {
  return useQuery<PomRun>({
    queryKey: ['pom', 'runs', 'detail', runId],
    enabled: Boolean(runId),
    queryFn: async () => {
      const { data } = await apiClient.get<PomRun>(
        `${POM_BASE}/discovery/runs/${runId}`
      );
      return data;
    },
  });
}

/**
 * Queue a discovery run.
 *
 * Answers `202` with a run id — discovery takes tens of seconds and is never
 * performed synchronously. A `409` means one is already in flight, which is an
 * expected outcome rather than a failure.
 *
 * This is the only write on the page, and it needs the SEP **bearer**:
 * `RequireBearerForUnsafeMethods` guards everything under `/apps`, so a cookie
 * session alone is rejected. `SepAuthGate` in the PMM shell mints that token
 * before this component ever mounts.
 */
export function useTriggerPomRun() {
  const queryClient = useQueryClient();
  return useMutation<PomRunAccepted, Error, void>({
    mutationFn: async () => {
      const { data } = await apiClient.post<PomRunAccepted>(
        `${POM_BASE}/discovery/runs`,
        {}
      );
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKey });
    },
  });
}

/** Refresh everything the snapshot backs, once a run reaches a terminal status. */
export function useInvalidatePomSnapshot() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: clustersKey });
    queryClient.invalidateQueries({ queryKey: runsKey });
  };
}
