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
 * Wire types for POM's read API (`/api/apps/pom_api`).
 *
 * Hand-written rather than generated: `pom_api` is not in the checked-in OpenAPI
 * spec yet, and the API deliberately types `clusters` as `list[dict[str, Any]]`
 * so the document contract lives in one place — the worker's `projection.py`.
 * This file is the frontend's copy of that shape; regenerate from the spec once
 * `make regen-specs` has run in SEP.
 */

/** Health verdicts the worker derives. `unknown` is the common case, not an edge. */
/** Whether the exporter reached the service on this run. */
export type PomServiceStatus = 'UP' | 'DOWN';

/** What the process is in its cluster. */
export type PomProcessRole = 'mongod' | 'mongos' | 'configsvr' | 'shardsvr';

/**
 * Why a field is null. The worker exports these as constants precisely because
 * the frontend matches on them.
 */
export type PomUnavailableReason =
  | 'service_not_observed'
  | 'metric_not_collected'
  | 'no_version_catalog'
  | 'not_applicable';

/**
 * One monitored MongoDB service.
 *
 * Two sentinel conventions the table depends on, and they differ on purpose:
 *
 * - `cpu_usage_percent` / `connections_free_percent` are **-1 when not measured**, never
 *   null and never 0 — zero CPU is a real reading, so the numeric sentinel is what
 *   keeps "idle" and "unknown" apart in a numeric column.
 * - `replication_lag_seconds` / `oplog_window_seconds` are **null when they do not apply**
 *   — a router and a standalone have no replica-set oplog. Null means "not a thing
 *   here", which is not the same as -1's "we could not measure it".
 */
export interface PomService {
  service_name: string;
  host: string | null;
  endpoint: string | null;
  service_id: string | null;
  service_type: string | null;
  version: string | null;
  vendor: string | null;
  edition: string | null;
  replication_set: string | null;
  state: string | null;
  status: PomServiceStatus;
  cpu_usage_percent: number;
  connections_free_percent: number;
  process_role: PomProcessRole;
  replication_lag_seconds: number | null;
  oplog_window_seconds: number | null;
}

/** One cluster or replica set. `name` is null when its services carry no label. */
export interface PomCluster {
  name: string | null;
  services: PomService[];
}

/** One monitoring environment. `env_name` is null when unset. */
export interface PomEnvironment {
  env_name: string | null;
  clusters: PomCluster[];
}

/** Fleet-level counts, computed by the worker so the UI never re-derives them. */
export interface PomTopologySummary {
  environments: number;
  clusters: number;
  services_total: number;
  services_up: number;
  services_down: number;
  by_process_role: Partial<Record<PomProcessRole, number>>;
}

/** Provenance every snapshot-backed response repeats. */
export interface PomSnapshotEnvelope {
  generated_at: string;
  observed_at: string | null;
  stale: boolean;
  schema_version: number;
  run_id: string;
}

/** The whole estate, as one document. */
export interface PomTopologyResponse {
  snapshot: PomSnapshotEnvelope;
  origin_node: string | null;
  source_queries: string[];
  summary: PomTopologySummary;
  environments: PomEnvironment[];
}

/**
 * One service flattened out of the tree, carrying the two grouping keys.
 *
 * The table renders a flat list so it can sort and filter across the whole estate;
 * the nesting is preserved as columns rather than as rows.
 */
export interface PomServiceRow extends PomService {
  env_name: string | null;
  cluster_name: string | null;
}

export type PomRunStatus = 'running' | 'success' | 'partial' | 'failed';

/**
 * What one run mapped and probed.
 *
 * `services_resolved` versus `probes_ok` is the diagnostic pair: resolved says
 * the executor mapping worked, probes_ok says the node answered.
 */
export interface PomRunCounts {
  services_total: number;
  services_resolved: number;
  services_orphaned: number;
  probes_ok: number;
}

export interface PomRunError {
  scope: string;
  service_name: string | null;
  code: string;
  message: string;
}

export interface PomRun {
  run_id: string;
  status: PomRunStatus;
  started_at: string;
  finished_at: string | null;
  counts: PomRunCounts;
  errors: PomRunError[];
}

export interface PomRunAccepted {
  run_id: string;
  status: PomRunStatus;
  started_at: string;
}
