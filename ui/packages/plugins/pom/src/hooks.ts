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

/**
 * POM's read API, served by **pmm-managed** at `/v1/pom`.
 *
 * Previously this called SEP's `pom_api` at `/api/apps/pom_api` through `@sep/api`.
 * Nothing below the transport changed: pmm-managed derives the same document from the
 * same two sources — PMM's inventory and VictoriaMetrics — and gRPC-Gateway is
 * configured with `UseProtoNames` + `EmitUnpopulated`, so the JSON is snake_case with
 * explicit nulls, exactly as `types.ts` already describes it.
 *
 * Two consequences of the move, both simplifications:
 *
 * - **No bearer.** `/v1` is PMM's own origin and authorises on the Grafana session
 *   cookie, so there is no token to mint and no `SepAuthGate` to wait for. `fetch` with
 *   `credentials: 'same-origin'` is the whole auth story.
 * - **The trigger is synchronous.** pmm-managed has no remote fan-out to wait on, so it
 *   rebuilds the document in the request and answers with a terminal status rather than
 *   a `202` to poll. The polling below is kept because it costs nothing and keeps the
 *   page honest if the endpoint ever goes back to being asynchronous.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  PomServiceRow,
  PomTopologyResponse,
  PomRun,
  PomRunAccepted,
} from './types';

const POM_BASE = '/v1/pom';

/** Rows fetched for the run history. The API caps `limit` at 100. */
export const POM_RUNS_LIMIT = 25;

/** Poll interval while a discovery run is in flight (ms). */
const RUN_POLL_MS = 3000;

const topologyKey = ['pom', 'topology'] as const;
const runsKey = ['pom', 'runs'] as const;

/**
 * One request against pmm-managed.
 *
 * Deliberately `fetch` rather than an axios instance: PMM's own axios client runs
 * `axios-case-converter` and would camelCase the response out from under `types.ts`,
 * and `@sep/api`'s client points at SEP. A bare same-origin fetch is both smaller and
 * the only one that leaves the wire shape alone.
 */
export class PomApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PomApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${POM_BASE}${path}`, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    // The gateway reports failures as {code, message, details}; the message is the only
    // part worth showing, and its absence should not mask the status.
    const body = (await response.json().catch(() => null)) as {
      message?: string;
    } | null;
    // The status has to survive onto the error: a 409 from the trigger is an expected
    // outcome the button renders differently, not a failure.
    throw new PomApiError(
      response.status,
      body?.message ?? `Request failed with ${response.status}`
    );
  }
  return (await response.json()) as T;
}

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
    queryFn: () => request<PomTopologyResponse>('/topology'),
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
      const { runs } = await request<{ runs: PomRun[] }>(
        `/discovery/runs?limit=${limit}`
      );
      // gRPC-Gateway always answers with an object, so the list arrives wrapped.
      return runs ?? [];
    },
    refetchInterval: (query) =>
      isRunActive(query.state.data?.[0]?.status) ? RUN_POLL_MS : false,
  });
}

/**
 * One run, with its per-service errors.
 *
 * Read out of the history rather than fetched: a run is small, the list is already in
 * the cache, and pmm-managed keeps the history in memory anyway — a per-run endpoint
 * would be a second way to say the same thing.
 */
export function usePomRun(run_id: string | undefined) {
  const { data, ...rest } = usePomRuns();
  return {
    ...rest,
    data: run_id ? data?.find((run) => run.run_id === run_id) : undefined,
  };
}

/**
 * Rebuild the topology document now.
 *
 * pmm-managed does this in the request — inventory is a local database read and
 * VictoriaMetrics is on localhost — so the response already carries a terminal status
 * rather than a `202` to poll.
 */
export function useTriggerPomRun() {
  const queryClient = useQueryClient();
  return useMutation<PomRunAccepted, Error, void>({
    mutationFn: () =>
      request<PomRunAccepted>('/discovery/runs', {
        method: 'POST',
        body: '{}',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: runsKey });
      queryClient.invalidateQueries({ queryKey: topologyKey });
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
