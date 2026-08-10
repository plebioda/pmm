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

import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  FormControl,
  InputLabel,
  Link as MuiLink,
  MenuItem,
  Select,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Chip, Table, type MRT_ColumnDef } from '@percona/percona-ui';
import { Link } from 'react-router-dom';
import { usePomClusters } from './hooks';
import { usePomBase } from './usePomBase';
import { HealthBadge } from './components/HealthBadge';
import { SnapshotBar } from './components/SnapshotBar';
import { Unavailable } from './components/Unavailable';
import { PomHeader } from './components/PomHeader';
import { SyncButton } from './components/SyncButton';
import { CLUSTER_TYPE_LABEL, HEALTH_LABEL } from './constants';
import { formatAge, formatDuration } from './format';
import type {
  PomCluster,
  PomClusterFilters,
  PomClusterType,
  PomHealthStatus,
} from './types';

const ANY = 'any';

/** Columns mirror the mockup's list view. */
function useColumns(base: string): MRT_ColumnDef<PomCluster>[] {
  return useMemo(
    () => [
      {
        accessorKey: 'name',
        header: 'Cluster name',
        Cell: ({ row: { original } }) => (
          <MuiLink
            component={Link}
            to={`${base}/clusters/${original.id}`}
            sx={{ fontWeight: 600 }}
          >
            {original.name}
          </MuiLink>
        ),
      },
      {
        accessorKey: 'type',
        header: 'Type',
        Cell: ({ row: { original } }) =>
          CLUSTER_TYPE_LABEL[original.type] ?? original.type,
      },
      {
        accessorFn: (row) => row.health.status,
        id: 'health',
        header: 'Health',
        Cell: ({ row: { original } }) => {
          const { status, reasons } = original.health;
          const badge = <HealthBadge status={status} />;
          if (!reasons.length) {
            return badge;
          }
          // The mockup's alert box, condensed to a hover: the worker already
          // phrases these for a human, so they are shown verbatim.
          return (
            <Tooltip title={reasons.map((r) => r.message).join(' · ')}>
              <Box component="span">{badge}</Box>
            </Tooltip>
          );
        },
      },
      {
        accessorFn: (row) => row.members_observed,
        id: 'members',
        header: 'Members',
        Cell: ({ row: { original } }) => {
          const states = Object.entries(original.members_by_state);
          return (
            <Stack direction="row" alignItems="center" gap={1}>
              <Typography variant="body2">
                {original.members_observed}/{original.members_total}
              </Typography>
              {states.map(([state, count]) => (
                <Chip
                  key={state}
                  size="small"
                  variant="outlined"
                  label={count > 1 ? `${state} ×${count}` : state}
                />
              ))}
            </Stack>
          );
        },
      },
      {
        accessorFn: (row) => row.versions.running.join(', '),
        id: 'version',
        header: 'Version',
        Cell: ({ row: { original } }) => {
          const { running, mixed, restart_pending } = original.versions;
          if (!running.length) {
            return <Unavailable reason={original.unavailable?.versions} />;
          }
          return (
            <Stack direction="row" alignItems="center" gap={1}>
              <Typography variant="body2">{running.join(', ')}</Typography>
              {mixed && (
                <Chip
                  size="small"
                  color="warning"
                  label="mixed"
                  variant="outlined"
                />
              )}
              {restart_pending && (
                <Chip
                  size="small"
                  color="info"
                  label="restart pending"
                  variant="outlined"
                />
              )}
            </Stack>
          );
        },
      },
      {
        accessorKey: 'max_replication_lag_seconds',
        header: 'Max repl. lag',
        Cell: ({ row: { original } }) =>
          original.max_replication_lag_seconds == null ? (
            <Unavailable
              reason={original.unavailable?.max_replication_lag_seconds}
            />
          ) : (
            formatDuration(original.max_replication_lag_seconds)
          ),
      },
      {
        accessorKey: 'oplog_window_seconds',
        header: 'Oplog window',
        Cell: ({ row: { original } }) =>
          original.oplog_window_seconds == null ? (
            <Unavailable reason={original.unavailable?.oplog_window_seconds} />
          ) : (
            formatDuration(original.oplog_window_seconds)
          ),
      },
      {
        accessorKey: 'environment',
        header: 'Environment',
        Cell: ({ row: { original } }) =>
          original.environment ?? <Unavailable />,
      },
      {
        accessorKey: 'last_seen',
        header: 'Last seen',
        Cell: ({ row: { original } }) =>
          original.last_seen == null ? (
            <Unavailable reason={original.unavailable?.last_seen} />
          ) : (
            formatAge(original.last_seen)
          ),
      },
    ],
    [base]
  );
}

/**
 * The clusters overview: POM's snapshot as a table.
 *
 * The subtitle deliberately leads with the observation ratio rather than a
 * severity count. In a real fleet most services are unobserved — 16 of 18 in the
 * dev sandbox — and "4 clusters · 2 critical" would hide that.
 */
export function ClustersOverviewPage() {
  const [health, setHealth] = useState<PomHealthStatus | typeof ANY>(ANY);
  const [type, setType] = useState<PomClusterType | typeof ANY>(ANY);
  const [environment, setEnvironment] = useState<string>(ANY);

  const filters: PomClusterFilters = {
    ...(health !== ANY && { health }),
    ...(type !== ANY && { type }),
    ...(environment !== ANY && { environment }),
  };
  const { data, isLoading, error } = usePomClusters(filters);
  const base = usePomBase();
  const columns = useColumns(base);

  // Memoized, not a fresh literal per render: it feeds both a useMemo and the
  // table's `data`, and a new array identity each render re-evaluates both.
  const clusters = useMemo(() => data?.clusters ?? [], [data]);
  const environments = useMemo(() => {
    const seen = new Set(
      clusters.map((c) => c.environment).filter((e): e is string => Boolean(e))
    );
    if (environment !== ANY) {
      seen.add(environment);
    }
    return [...seen].sort();
  }, [clusters, environment]);

  const subtitle = data && (
    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
      <Typography variant="body1" color="text.secondary">
        {data.summary.clusters} clusters · {data.summary.services_observed}{' '}
        observed of {data.summary.services_total} services
      </Typography>
      <Typography variant="body2" color="text.secondary">
        ·
      </Typography>
      <SnapshotBar envelope={data} />
    </Stack>
  );

  return (
    <Stack gap={2}>
      <PomHeader
        title="PSMDB OpenManager"
        subtitle={subtitle}
        actions={<SyncButton />}
      />

      {data && (
        <Stack direction="row" gap={1} flexWrap="wrap">
          {data.groups.map((group) => (
            <Chip
              key={group.key}
              size="small"
              variant={health === group.key ? 'filled' : 'outlined'}
              label={`${group.label} ${group.count}`}
              onClick={() =>
                setHealth(
                  health === group.key ? ANY : (group.key as PomHealthStatus)
                )
              }
            />
          ))}
        </Stack>
      )}

      <Stack direction="row" gap={2} flexWrap="wrap">
        <FormControl size="small" sx={{ width: 180 }}>
          <InputLabel id="pom-health">Health</InputLabel>
          <Select
            labelId="pom-health"
            label="Health"
            value={health}
            onChange={(e) =>
              setHealth(e.target.value as PomHealthStatus | typeof ANY)
            }
          >
            <MenuItem value={ANY}>Any</MenuItem>
            {Object.entries(HEALTH_LABEL).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ width: 180 }}>
          <InputLabel id="pom-type">Type</InputLabel>
          <Select
            labelId="pom-type"
            label="Type"
            value={type}
            onChange={(e) =>
              setType(e.target.value as PomClusterType | typeof ANY)
            }
          >
            <MenuItem value={ANY}>Any</MenuItem>
            {Object.entries(CLUSTER_TYPE_LABEL).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl size="small" sx={{ width: 180 }}>
          <InputLabel id="pom-environment">Environment</InputLabel>
          <Select
            labelId="pom-environment"
            label="Environment"
            value={environment}
            onChange={(e) => setEnvironment(e.target.value)}
          >
            <MenuItem value={ANY}>Any</MenuItem>
            {environments.map((env) => (
              <MenuItem key={env} value={env}>
                {env}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Stack>

      {error && (
        <Alert severity="error">
          Could not load clusters: {(error as Error).message}
        </Alert>
      )}

      {isLoading && !data ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Table
          tableName="pom-clusters"
          columns={columns}
          data={clusters}
          getRowId={(row) => row.id}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableHiding={false}
          enablePagination={false}
          enableStickyHeader
        />
      )}
    </Stack>
  );
}
