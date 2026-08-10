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

import { useMemo } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Breadcrumbs,
  CircularProgress,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { Chip, Table, type MRT_ColumnDef } from '@percona/percona-ui';
import { Link, useParams } from 'react-router-dom';
import { usePomCluster } from './hooks';
import { usePomBase } from './usePomBase';
import { HealthBadge } from './components/HealthBadge';
import { SnapshotBar } from './components/SnapshotBar';
import { Unavailable } from './components/Unavailable';
import { CLUSTER_TYPE_LABEL } from './constants';
import { formatDuration } from './format';
import type { PomCluster, PomHealthStatus, PomMember } from './types';

const MEMBER_COLUMNS: MRT_ColumnDef<PomMember>[] = [
  {
    accessorKey: 'service_name',
    header: 'Service',
    Cell: ({ row: { original } }) => (
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {original.service_name}
      </Typography>
    ),
  },
  {
    accessorKey: 'state',
    header: 'State',
    Cell: ({ row: { original } }) =>
      original.state ? (
        <Chip
          size="small"
          variant="outlined"
          color={original.state === 'PRIMARY' ? 'success' : 'default'}
          label={original.state}
        />
      ) : (
        <Unavailable reason="service_not_observed" />
      ),
  },
  {
    accessorKey: 'running_version',
    header: 'Running version',
    Cell: ({ row: { original } }) =>
      original.running_version ?? <Unavailable reason="service_not_observed" />,
  },
  {
    accessorKey: 'installed_version',
    header: 'Installed',
    Cell: ({ row: { original } }) =>
      original.installed_version ?? (
        <Unavailable reason="service_not_observed" />
      ),
  },
  {
    accessorKey: 'port',
    header: 'Port',
    Cell: ({ row: { original } }) => original.port ?? <Unavailable />,
  },
  {
    accessorKey: 'os',
    header: 'OS',
    Cell: ({ row: { original } }) =>
      original.os ?? <Unavailable reason="service_not_observed" />,
  },
  {
    accessorKey: 'uptime_seconds',
    header: 'Uptime',
    Cell: ({ row: { original } }) =>
      original.uptime_seconds == null ? (
        <Unavailable reason="service_not_observed" />
      ) : (
        formatDuration(original.uptime_seconds)
      ),
  },
  {
    accessorKey: 'replication_lag_seconds',
    header: 'Repl. lag',
    Cell: ({ row: { original } }) =>
      // `== null`, never a falsy check: 0 is a real reading on an idle replica
      // set, and rendering it as unavailable would report a healthy member as
      // unobservable. The reason comes from the member's own map, so a router
      // says "not applicable" rather than "not observed".
      original.replication_lag_seconds == null ? (
        <Unavailable reason={original.unavailable?.replication_lag_seconds} />
      ) : (
        formatDuration(original.replication_lag_seconds) || '0s'
      ),
  },
  {
    accessorKey: 'oplog_window_seconds',
    header: 'Oplog window',
    Cell: ({ row: { original } }) =>
      original.oplog_window_seconds == null ? (
        <Unavailable reason={original.unavailable?.oplog_window_seconds} />
      ) : (
        formatDuration(original.oplog_window_seconds) || '0s'
      ),
  },
  {
    accessorKey: 'executor_host',
    header: 'Executor host',
    Cell: ({ row: { original } }) =>
      original.executor_host ?? (
        // No executor is why a service goes unobserved, so name it rather than
        // leaving the cell blank.
        <Unavailable reason="service_not_observed" />
      ),
  },
];

/** The mockup's alert box: the worker's own phrasing for the health verdict. */
function HealthReasons({ cluster }: { cluster: PomCluster }) {
  if (!cluster.health.reasons.length) {
    return null;
  }
  const worst: PomHealthStatus = cluster.health.status;
  const severity =
    worst === 'critical' ? 'error' : worst === 'warning' ? 'warning' : 'info';
  return (
    <Alert severity={severity} variant="outlined">
      <AlertTitle>Why this cluster is {cluster.health.status}</AlertTitle>
      <Stack component="ul" sx={{ m: 0, pl: 2 }}>
        {cluster.health.reasons.map((reason) => (
          <li key={reason.code}>{reason.message}</li>
        ))}
      </Stack>
    </Alert>
  );
}

/** One cluster, with the member list the overview endpoint deliberately omits. */
export function ClusterDetailPage() {
  const { clusterId } = useParams<{ clusterId: string }>();
  const base = usePomBase();
  const { data, isLoading, error } = usePomCluster(clusterId);
  const cluster = data?.cluster;
  const members = useMemo(() => cluster?.members ?? [], [cluster]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !cluster) {
    return (
      <Alert severity="error">
        Could not load this cluster
        {error ? `: ${(error as Error).message}` : ''}
      </Alert>
    );
  }

  return (
    <Stack gap={2}>
      <Breadcrumbs>
        <MuiLink component={Link} to={base}>
          PSMDB OpenManager
        </MuiLink>
        <Typography color="text.primary">{cluster.name}</Typography>
      </Breadcrumbs>

      <Stack direction="row" alignItems="center" gap={2} flexWrap="wrap">
        <Typography variant="h4" component="h1">
          {cluster.name}
        </Typography>
        <HealthBadge status={cluster.health.status} />
        <Chip
          size="small"
          variant="outlined"
          label={CLUSTER_TYPE_LABEL[cluster.type] ?? cluster.type}
        />
        {cluster.environment && (
          <Chip size="small" variant="outlined" label={cluster.environment} />
        )}
        <Chip
          size="small"
          variant="outlined"
          label={`${cluster.members_observed}/${cluster.members_total} observed`}
        />
      </Stack>

      {data && <SnapshotBar envelope={data} />}

      <HealthReasons cluster={cluster} />

      <Typography variant="h6" component="h2">
        Members
      </Typography>
      <Table
        tableName="pom-cluster-members"
        columns={MEMBER_COLUMNS}
        data={members}
        getRowId={(row) => String(row.service_id)}
        enableGlobalFilter={false}
        enableColumnFilters={false}
        enableHiding={false}
        enablePagination={false}
        enableStickyHeader
      />
    </Stack>
  );
}
