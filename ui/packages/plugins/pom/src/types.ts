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
export type PomHealthStatus = 'ok' | 'warning' | 'critical' | 'unknown';

/** Cluster topologies the worker recognises. */
export type PomClusterType = 'replica_set' | 'sharded_cluster' | 'standalone';

/**
 * Why a field is null. The worker exports these as constants precisely because
 * the frontend matches on them — see `projection.py`.
 */
export type PomUnavailableReason =
  | 'service_not_observed'
  | 'metric_not_collected'
  | 'no_version_catalog'
  | 'not_applicable';

/** One reason behind a cluster's health verdict. Rendered verbatim to the user. */
export interface PomHealthReason {
  code: string;
  message: string;
  severity: PomHealthStatus;
}

export interface PomHealth {
  status: PomHealthStatus;
  stale: boolean;
  observed_at: string | null;
  reasons: PomHealthReason[];
}

export interface PomVersions {
  running: string[];
  installed: string[];
  /** True when members disagree on the running version. Null when unobserved. */
  mixed: boolean | null;
  /** Installed differs from running — a restart would change the version. */
  restart_pending: boolean | null;
}

export interface PomUpdate {
  available: boolean | null;
  reason: PomUnavailableReason | null;
}

export interface PomMember {
  service_id: number;
  service_name: string;
  observed: boolean;
  /** Replica-set state, e.g. `PRIMARY`. Null when the node was not observed. */
  state: string | null;
  port: number | null;
  replication_set: string | null;
  running_version: string | null;
  installed_version: string | null;
  os: string | null;
  /** Whether the member's server process is up. Role-neutral: a router runs
   *  `mongos` and never a mongod. */
  server_running: boolean | null;
  /** Which server program was found — `mongod`, `mongos`, or null if neither. */
  server_process: 'mongod' | 'mongos' | null;
  uptime_seconds: number | null;
  executor_host: string | null;
  /** Seconds this member trails the primary. `0` is a real reading on an idle
   *  replica set — never render a falsy check here. Null on a router, a
   *  standalone, or a single-member set, which have no peer to lag behind. */
  replication_lag_seconds: number | null;
  /** Seconds of history the oplog holds. Null on a router or a standalone,
   *  neither of which has an oplog at all. */
  oplog_window_seconds: number | null;
  /** Why any of the above is null, keyed by field name. */
  unavailable?: Partial<Record<string, PomUnavailableReason>>;
}

/**
 * One cluster's status document, as assembled by the worker.
 *
 * `members` is present only on the detail response — the list endpoint omits it
 * so the payload does not scale with the fleet's node count.
 */
export interface PomCluster {
  id: string;
  name: string;
  type: PomClusterType;
  health: PomHealth;
  environment: string | null;
  cluster: string | null;
  replication_set: string | null;
  members_total: number;
  members_observed: number;
  members_by_state: Record<string, number>;
  versions: PomVersions;
  max_replication_lag_seconds: number | null;
  oplog_window_seconds: number | null;
  last_seen: string | null;
  update: PomUpdate;
  /** Maps a null field name to the reason it is null. Never means "zero". */
  unavailable: Partial<Record<string, PomUnavailableReason>>;
  schema_version: number;
  members?: PomMember[];
}

export interface PomSummary {
  clusters: number;
  by_health: Partial<Record<PomHealthStatus, number>>;
  by_type: Partial<Record<PomClusterType, number>>;
  services_total: number;
  services_observed: number;
  /** The honest headline: in inventory, but nothing answered for it. */
  services_unobserved: number;
}

export interface PomGroup {
  key: string;
  label: string;
  count: number;
}

/** Provenance every snapshot-backed response repeats. */
export interface PomSnapshotEnvelope {
  generated_at: string;
  observed_at: string | null;
  stale: boolean;
  schema_version: number;
  run_id: string;
}

export interface PomClusterListResponse extends PomSnapshotEnvelope {
  summary: PomSummary;
  groups: PomGroup[];
  clusters: PomCluster[];
  /** Reserved for pagination; the API always sends null today. */
  next_cursor: string | null;
}

export interface PomClusterDetailResponse extends PomSnapshotEnvelope {
  cluster: PomCluster;
}

/** Server-side filters `GET /clusters` accepts. */
export interface PomClusterFilters {
  health?: PomHealthStatus;
  type?: PomClusterType;
  environment?: string;
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
