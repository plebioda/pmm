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
  PomServiceRow,
  PomTopologyResponse,
  PomRun,
  PomRunAccepted,
} from './types';

const POM_BASE = '/apps/pom_api';

/** Rows fetched for the run history. The API caps `limit` at 100. */
export const POM_RUNS_LIMIT = 25;

/** Poll interval while a discovery run is in flight (ms). */
const RUN_POLL_MS = 3000;

const topologyKey = ['pom', 'topology'] as const;
const runsKey = ['pom', 'runs'] as const;

/** True while a run has not reached a terminal status. */
export function isRunActive(status: string | undefined): boolean {
  return status === 'running';
}

/**
 * The whole estate from the latest terminal snapshot.
 *
 * One request, one document: the API assembles the tree per run, so there is no
 * per-cluster fetch and nothing to paginate. Keeping the previous page in place stops
 * the table collapsing to a spinner while a refetch is in flight.
 */
export function usePomTopology() {
  return useQuery<PomTopologyResponse>({
    queryKey: topologyKey,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const { data } = await apiClient.get<PomTopologyResponse>(
        `${POM_BASE}/topology`
      );
      return data;
    },
  });
}

/**
 * Flatten the tree into one row per service, carrying its grouping keys.
 *
 * The table sorts and filters across the whole estate, which a nested render cannot
 * do; the nesting survives as the environment and cluster columns.
 */
export function toServiceRows(
  topology: PomTopologyResponse | undefined
): PomServiceRow[] {
  if (!topology) {
    return [];
  }
  return topology.environments.flatMap((environment) =>
    environment.clusters.flatMap((cluster) =>
      cluster.services.map((service) => ({
        ...service,
        env_name: environment.env_name,
        cluster_name: cluster.name,
      }))
    )
  );
}

/**
 * Run history, newest first.
 *
 * Polls while the newest run is still going, which is also what makes the
 * topology refresh after a triggered run lands.
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
export function usePomRun(run_id: string | undefined) {
  return useQuery<PomRun>({
    queryKey: ['pom', 'runs', 'detail', run_id],
    enabled: Boolean(run_id),
    queryFn: async () => {
      const { data } = await apiClient.get<PomRun>(
        `${POM_BASE}/discovery/runs/${run_id}`
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
    queryClient.invalidateQueries({ queryKey: topologyKey });
    queryClient.invalidateQueries({ queryKey: runsKey });
  };
}
