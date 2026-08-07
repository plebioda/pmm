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
  Box,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Table, type MRT_ColumnDef } from '@percona/percona-ui';
import { usePomRuns } from './hooks';
import { RunStatusBadge } from './components/HealthBadge';
import { PomHeader } from './components/PomHeader';
import { SyncButton } from './components/SyncButton';
import { formatRunDuration, formatTimestamp } from './format';
import type { PomRun } from './types';

const RUN_COLUMNS: MRT_ColumnDef<PomRun>[] = [
  {
    accessorKey: 'status',
    header: 'Status',
    Cell: ({ row: { original } }) => (
      <RunStatusBadge status={original.status} />
    ),
  },
  {
    accessorKey: 'started_at',
    header: 'Started',
    Cell: ({ row: { original } }) => formatTimestamp(original.started_at),
  },
  {
    accessorFn: (row) => formatRunDuration(row.started_at, row.finished_at),
    id: 'duration',
    header: 'Duration',
    Cell: ({ row: { original } }) =>
      formatRunDuration(original.started_at, original.finished_at) || '—',
  },
  {
    accessorFn: (row) => row.counts.services_total,
    id: 'services',
    header: 'Services',
    Cell: ({ row: { original } }) => original.counts.services_total,
  },
  {
    accessorFn: (row) => row.counts.services_resolved,
    id: 'resolved',
    header: 'Resolved',
    Cell: ({ row: { original } }) => (
      <Tooltip title="Services that mapped to a live executor host">
        <Box component="span">{original.counts.services_resolved}</Box>
      </Tooltip>
    ),
  },
  {
    accessorFn: (row) => row.counts.probes_ok,
    id: 'probes_ok',
    header: 'Probed',
    Cell: ({ row: { original } }) => (
      // The diagnostic pair: resolved says the mapping worked, probed says the
      // node answered. resolved=9 / probed=0 is a healthy mapping and broken
      // executors — a distinction a single "failed" count would hide.
      <Tooltip title="Services that returned a usable probe">
        <Box component="span">{original.counts.probes_ok}</Box>
      </Tooltip>
    ),
  },
  {
    accessorFn: (row) => row.counts.services_orphaned,
    id: 'orphaned',
    header: 'Orphaned',
    Cell: ({ row: { original } }) => (
      <Tooltip title="Services with no live executor host — not an error">
        <Box component="span">{original.counts.services_orphaned}</Box>
      </Tooltip>
    ),
  },
  {
    accessorFn: (row) => row.errors.length,
    id: 'errors',
    header: 'Errors',
    Cell: ({ row: { original } }) => original.errors.length || '—',
  },
];

/** Per-run errors, shown when a run row is expanded. */
function RunErrors({ run }: { run: PomRun }) {
  if (!run.errors.length) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
        No errors recorded for this run.
      </Typography>
    );
  }
  return (
    <Stack gap={1} sx={{ p: 2 }}>
      {run.errors.map((error, index) => (
        <Alert
          key={`${error.code}-${error.service_name ?? index}`}
          severity="warning"
          variant="outlined"
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {error.service_name ?? error.scope} · {error.code}
          </Typography>
          <Typography variant="body2">{error.message}</Typography>
        </Alert>
      ))}
    </Stack>
  );
}

/**
 * Discovery run history.
 *
 * The list polls itself while the newest run is active (see `usePomRuns`), which
 * is what makes the Sync button's progress visible here without extra wiring.
 */
export function RunsPage() {
  const { data: runs, isLoading, error } = usePomRuns();
  const rows = useMemo(() => runs ?? [], [runs]);

  return (
    <Stack gap={2}>
      <PomHeader
        title="Discovery"
        subtitle={
          <Typography variant="body2" color="text.secondary">
            Every run probes each MongoDB service and rebuilds the snapshot the
            overview reads.
          </Typography>
        }
        actions={<SyncButton />}
      />

      {error && (
        <Alert severity="error">
          Could not load runs: {(error as Error).message}
        </Alert>
      )}

      {isLoading && !runs ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        <Table
          tableName="pom-runs"
          columns={RUN_COLUMNS}
          data={rows}
          getRowId={(row) => row.run_id}
          enableGlobalFilter={false}
          enableColumnFilters={false}
          enableHiding={false}
          enablePagination={false}
          enableStickyHeader
          enableExpanding
          renderDetailPanel={({ row }) => <RunErrors run={row.original} />}
        />
      )}
    </Stack>
  );
}
